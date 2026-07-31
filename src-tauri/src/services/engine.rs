use crate::error::{StudioError, StudioResult};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    env,
    ffi::{OsStr, OsString},
    fs,
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    sync::Arc,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::sync::Mutex as TokioMutex;
use uuid::Uuid;

const ENGINE_MANIFEST: &str = "ENGINE-SOURCE.json";
const WATCHER_HEARTBEAT_STALE_AFTER: Duration = Duration::from_secs(30);
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
struct EngineSourceManifest {
    files: Vec<EngineSourceFile>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
struct EngineSourceFile {
    path: String,
    sha256: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EngineInstallReport {
    pub installed: bool,
    pub file_count: usize,
    pub install_root: PathBuf,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentStatus {
    pub windows_version: Option<String>,
    pub node_path: Option<PathBuf>,
    pub node_version: Option<String>,
    pub node_source: Option<NodeRuntimeSource>,
    pub codex_present: bool,
    pub codex_version: Option<String>,
    pub engine_installed: bool,
    pub skin_runtime_ready: bool,
    pub error_codes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NodeRuntimeSource {
    Bundled,
    External,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedNodeRuntime {
    pub path: PathBuf,
    pub version: String,
    pub source: NodeRuntimeSource,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LegacyTrayReport {
    pub stopped_processes: Vec<u32>,
    pub removed_shortcuts: Vec<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub codex_running: bool,
    pub skin_active: bool,
    pub starting: bool,
    pub paused: bool,
    pub port: Option<u16>,
    pub active_theme_id: Option<String>,
    pub active_theme_name: Option<String>,
    pub requires_restart_confirmation: bool,
    pub last_error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WatcherHeartbeat {
    process_id: u32,
    updated_at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessOutput {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

impl ProcessOutput {
    pub fn success(stdout: impl Into<String>) -> Self {
        Self {
            exit_code: 0,
            stdout: stdout.into(),
            stderr: String::new(),
        }
    }
}

pub trait ProcessRunner: Send + Sync {
    fn run(
        &self,
        program: &Path,
        arguments: &[OsString],
        timeout: Duration,
    ) -> StudioResult<ProcessOutput>;
}

#[derive(Debug, Default)]
pub struct SystemProcessRunner;

struct ProcessCapture {
    stdout: PathBuf,
    stderr: PathBuf,
}

impl ProcessCapture {
    fn new() -> StudioResult<(Self, fs::File, fs::File)> {
        let nonce = Uuid::new_v4();
        let root = std::env::temp_dir();
        let capture = Self {
            stdout: root.join(format!("codex-dream-skin-studio-{nonce}.stdout")),
            stderr: root.join(format!("codex-dream-skin-studio-{nonce}.stderr")),
        };
        let stdout = fs::File::create(&capture.stdout)
            .map_err(|error| StudioError::io("Failed to create command stdout capture", error))?;
        let stderr = fs::File::create(&capture.stderr)
            .map_err(|error| StudioError::io("Failed to create command stderr capture", error))?;
        Ok((capture, stdout, stderr))
    }

    fn finish(&self, exit_code: i32) -> StudioResult<ProcessOutput> {
        let stdout = fs::read(&self.stdout)
            .map_err(|error| StudioError::io("Failed to read command stdout capture", error))?;
        let stderr = fs::read(&self.stderr)
            .map_err(|error| StudioError::io("Failed to read command stderr capture", error))?;
        Ok(ProcessOutput {
            exit_code,
            stdout: String::from_utf8_lossy(&stdout).trim().to_string(),
            stderr: String::from_utf8_lossy(&stderr).trim().to_string(),
        })
    }
}

impl Drop for ProcessCapture {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.stdout);
        let _ = fs::remove_file(&self.stderr);
    }
}

fn process_timeout_error(timeout: Duration, cleanup_error: Option<StudioError>) -> StudioError {
    let error = StudioError::new(
        "PROCESS_TIMEOUT",
        format!("Engine command exceeded {} seconds", timeout.as_secs()),
    );
    match cleanup_error {
        Some(cleanup_error) => StudioError::new(
            "PROCESS_TIMEOUT_CLEANUP_FAILED",
            format!(
                "Engine command exceeded {} seconds and its process tree could not be reaped",
                timeout.as_secs()
            ),
        )
        .with_detail(format!("Timed-out process cleanup failed: {cleanup_error}")),
        None => error,
    }
}

fn hidden_command(program: impl AsRef<OsStr>) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

impl ProcessRunner for SystemProcessRunner {
    fn run(
        &self,
        program: &Path,
        arguments: &[OsString],
        timeout: Duration,
    ) -> StudioResult<ProcessOutput> {
        let (capture, stdout, stderr) = ProcessCapture::new()?;
        let mut command = hidden_command(program);
        command
            .args(arguments)
            .stdin(Stdio::null())
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr));
        let mut child = command
            .spawn()
            .map_err(|error| StudioError::io("Failed to launch engine command", error))?;
        let started = Instant::now();
        loop {
            if let Some(status) = child
                .try_wait()
                .map_err(|error| StudioError::io("Failed to poll engine command", error))?
            {
                return capture.finish(status.code().unwrap_or(-1));
            }
            if started.elapsed() >= timeout {
                let cleanup_error = terminate_spawned_process_tree(&mut child).err();
                return Err(process_timeout_error(timeout, cleanup_error));
            }
            thread::sleep(Duration::from_millis(25));
        }
    }
}

#[cfg(windows)]
fn terminate_spawned_process_tree(child: &mut std::process::Child) -> StudioResult<()> {
    // `std::process::Child` keeps a HANDLE to the exact direct child, so the fallback
    // `kill`/`try_wait` operations below cannot target a different process. `taskkill /PID`
    // still has a very small Windows PID-reuse race between our last `try_wait` and
    // taskkill's snapshot. A CIM identity check would add another TOCTOU boundary rather
    // than remove it, so this remains a documented limitation of the taskkill-based tree
    // cleanup; a Job Object would be required to eliminate it completely.
    let pid = child.id().to_string();
    let mut taskkill = hidden_command("taskkill.exe");
    taskkill.args(["/PID", pid.as_str(), "/T", "/F"]);
    terminate_spawned_process_tree_with_command(
        child,
        taskkill,
        Duration::from_secs(2),
        Duration::from_secs(2),
    )
}

#[cfg(windows)]
fn terminate_spawned_process_tree_with_command(
    child: &mut std::process::Child,
    taskkill: Command,
    taskkill_timeout: Duration,
    reap_timeout: Duration,
) -> StudioResult<()> {
    let taskkill = run_cleanup_command_bounded(taskkill, taskkill_timeout, reap_timeout);
    match taskkill {
        Ok(output) if output.exit_code == 0 => match reap_child_until(child, reap_timeout) {
            Ok(true) => Ok(()),
            reap_result => {
                let fallback = terminate_direct_child_and_reap(child, reap_timeout);
                Err(process_tree_termination_error(format!(
                    "taskkill reported success but the direct child was not reaped ({reap_result:?}); direct-child fallback: {fallback:?}"
                )))
            }
        },
        Ok(output) => {
            let fallback = terminate_direct_child_and_reap(child, reap_timeout);
            let detail = if !output.stderr.trim().is_empty() {
                output.stderr.trim()
            } else {
                output.stdout.trim()
            };
            Err(process_tree_termination_error(format!(
                "taskkill exited with code {}: {}; direct-child fallback: {fallback:?}",
                output.exit_code, detail
            )))
        }
        Err(error) => {
            let fallback = terminate_direct_child_and_reap(child, reap_timeout);
            Err(process_tree_termination_error(format!(
                "taskkill could not be launched: {error}; direct-child fallback: {fallback:?}"
            )))
        }
    }
}

#[cfg(windows)]
fn run_cleanup_command_bounded(
    mut command: Command,
    timeout: Duration,
    reap_timeout: Duration,
) -> StudioResult<ProcessOutput> {
    let (capture, stdout, stderr) = ProcessCapture::new()?;
    command
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));
    let mut cleanup = command
        .spawn()
        .map_err(|error| StudioError::io("Failed to launch process-tree terminator", error))?;
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(status) = cleanup
            .try_wait()
            .map_err(|error| StudioError::io("Failed to poll process-tree terminator", error))?
        {
            return capture.finish(status.code().unwrap_or(-1));
        }
        if Instant::now() >= deadline {
            let kill_error = cleanup.kill().err();
            let reaped = reap_child_until(&mut cleanup, reap_timeout);
            let mut detail =
                format!("Process-tree terminator exceeded {timeout:?}; reaped: {reaped:?}");
            if let Some(kill_error) = kill_error {
                detail.push_str(&format!("; kill failed: {kill_error}"));
            }
            return Err(StudioError::new(
                "PROCESS_TREE_TERMINATOR_TIMEOUT",
                "Process-tree terminator exceeded its deadline",
            )
            .with_detail(detail));
        }
        thread::sleep(Duration::from_millis(25));
    }
}

#[cfg(not(windows))]
fn terminate_spawned_process_tree(child: &mut std::process::Child) -> StudioResult<()> {
    terminate_direct_child_and_reap(child, Duration::from_secs(2))
}

fn terminate_direct_child_and_reap(
    child: &mut std::process::Child,
    reap_timeout: Duration,
) -> StudioResult<()> {
    if reap_child_until(child, Duration::ZERO)? {
        return Ok(());
    }
    let kill_error = child.kill().err();
    if reap_child_until(child, reap_timeout)? {
        return Ok(());
    }
    let error = process_tree_termination_error(
        "Timed-out direct child did not exit before the reap deadline",
    );
    Err(match kill_error {
        Some(kill_error) => error.with_detail(format!("Direct-child kill failed: {kill_error}")),
        None => error,
    })
}

fn reap_child_until(child: &mut std::process::Child, timeout: Duration) -> StudioResult<bool> {
    let deadline = Instant::now() + timeout;
    loop {
        if child
            .try_wait()
            .map_err(|error| StudioError::io("Failed to reap timed-out command", error))?
            .is_some()
        {
            return Ok(true);
        }
        if Instant::now() >= deadline {
            return Ok(false);
        }
        thread::sleep(Duration::from_millis(25));
    }
}

fn process_tree_termination_error(detail: impl Into<String>) -> StudioError {
    StudioError::new(
        "PROCESS_TREE_TERMINATION_FAILED",
        "Timed-out engine command tree could not be terminated cleanly",
    )
    .with_detail(detail)
}

#[derive(Debug, Clone, Default)]
struct RuntimeEvidence {
    codex_running: bool,
    verification_succeeded: bool,
    verification_pending: bool,
    runtime_upgrade_available: bool,
    verification_error: Option<String>,
    state_present: bool,
    pause_marker_present: bool,
    port: Option<u16>,
    active_theme_id: Option<String>,
    active_theme_name: Option<String>,
}

pub struct EngineRuntime {
    engine_root: PathBuf,
    state_root: PathBuf,
    runner: Arc<dyn ProcessRunner>,
    timeout: Duration,
    mutation_lock: Arc<TokioMutex<()>>,
    inject_node_path: bool,
}

impl EngineRuntime {
    pub fn new(engine_root: PathBuf, state_root: PathBuf) -> Self {
        Self::with_runner(
            engine_root,
            state_root,
            Arc::new(SystemProcessRunner),
            Duration::from_secs(120),
        )
        .with_node_path_injection()
    }

    pub fn with_runner(
        engine_root: PathBuf,
        state_root: PathBuf,
        runner: Arc<dyn ProcessRunner>,
        timeout: Duration,
    ) -> Self {
        Self {
            engine_root,
            state_root,
            runner,
            timeout,
            mutation_lock: Arc::new(TokioMutex::new(())),
            inject_node_path: false,
        }
    }

    fn with_node_path_injection(mut self) -> Self {
        self.inject_node_path = true;
        self
    }

    pub fn get_environment_status(&self) -> EnvironmentStatus {
        EngineService::environment_status_with(
            &SystemEnvironmentProbe,
            &SystemNodeCandidateValidator,
            &self.engine_root,
        )
    }

    pub fn get_runtime_status(&self) -> StudioResult<RuntimeStatus> {
        let tasklist = self.runner.run(
            Path::new("tasklist.exe"),
            &[
                OsString::from("/FI"),
                OsString::from("IMAGENAME eq ChatGPT.exe"),
                OsString::from("/FO"),
                OsString::from("CSV"),
                OsString::from("/NH"),
            ],
            Duration::from_secs(5),
        )?;
        ensure_process_success("Codex process inspection", tasklist.clone())?;
        let codex_running = tasklist.stdout.to_ascii_lowercase().contains("chatgpt.exe");
        let state_path = self.state_root.join("state.json");
        let (active_theme_id, active_theme_name) = read_active_theme_identity(&self.state_root);
        let mut evidence = RuntimeEvidence {
            codex_running,
            pause_marker_present: self.state_root.join("paused").is_file(),
            active_theme_id,
            active_theme_name,
            ..RuntimeEvidence::default()
        };
        if state_path.is_file() {
            evidence.state_present = true;
            match read_state_port(&state_path) {
                Ok(port) => {
                    evidence.port = port;
                    if codex_running {
                        let mut arguments = vec![
                            OsString::from("-TimeoutMilliseconds"),
                            OsString::from("1500"),
                        ];
                        if evidence.pause_marker_present {
                            arguments.push(OsString::from("-SessionOnly"));
                        }
                        let output =
                            self.run_powershell_script("verify-dream-skin.ps1", &arguments)?;
                        evidence.verification_succeeded = output.exit_code == 0;
                        if output.exit_code != 0 {
                            evidence.verification_pending =
                                verification_is_waiting_for_renderer(&output);
                            evidence.runtime_upgrade_available = !evidence.verification_pending
                                && verification_requires_runtime_upgrade(&output);
                            if !evidence.verification_pending
                                && !evidence.runtime_upgrade_available
                                && !is_expected_inactive_verification(&output)
                            {
                                evidence.verification_error = Some(process_failure_detail(&output));
                            }
                        }
                    }
                }
                Err(error) => evidence.verification_error = Some(error.to_string()),
            }
        }
        Ok(parse_runtime_status(evidence))
    }

    pub async fn start_skin(&self, confirm_restart: bool) -> StudioResult<RuntimeStatus> {
        let _guard = self.mutation_lock.lock().await;
        let current = self.get_runtime_status()?;
        if current.requires_restart_confirmation && !confirm_restart {
            return Err(StudioError::new(
                "RESTART_CONFIRMATION_REQUIRED",
                "Codex is open without a verified Dream Skin session; restarting may discard unsent input",
            ));
        }
        let extra = confirm_restart.then(|| OsString::from("-RestartExisting"));
        let args: Vec<OsString> = extra.into_iter().collect();
        let result = self
            .run_powershell_script("start-dream-skin.ps1", &args)
            .and_then(|output| ensure_process_success("Start Dream Skin", output));
        self.resolve_runtime_transition(result, start_target_reached, "Start Dream Skin")
    }

    pub async fn reconcile_runtime(&self) -> StudioResult<RuntimeStatus> {
        let _guard = self.mutation_lock.lock().await;
        self.reconcile_runtime_locked()
    }

    fn reconcile_runtime_locked(&self) -> StudioResult<RuntimeStatus> {
        let current = self.get_runtime_status()?;
        if !self.state_root.join("state.json").is_file() || !self.watcher_heartbeat_is_stale_now() {
            return Ok(current);
        }
        let output = self.run_powershell_script(
            "start-dream-skin.ps1",
            &[OsString::from("-RecoverWatcherOnly")],
        )?;
        if output.exit_code == 4 {
            return Ok(current);
        }
        ensure_process_success("Recover Dream Skin watcher", output)?;
        self.get_runtime_status()
    }

    fn watcher_heartbeat_is_stale_now(&self) -> bool {
        let Ok(elapsed) = SystemTime::now().duration_since(UNIX_EPOCH) else {
            return true;
        };
        watcher_heartbeat_is_stale(
            &self.state_root.join("watcher-heartbeat.json"),
            elapsed.as_millis() as u64,
            WATCHER_HEARTBEAT_STALE_AFTER.as_millis() as u64,
        )
    }

    pub async fn pause_skin(&self) -> StudioResult<RuntimeStatus> {
        let _guard = self.mutation_lock.lock().await;
        self.reconcile_runtime_locked()?;
        fs::create_dir_all(&self.state_root).map_err(|error| {
            StudioError::io("Failed to create Dream Skin state directory", error)
        })?;
        let temporary = self
            .state_root
            .join(format!(".paused-{}.tmp", Uuid::new_v4()));
        fs::write(&temporary, b"paused\r\n")
            .map_err(|error| StudioError::io("Failed to stage the pause marker", error))?;
        fs::rename(&temporary, self.state_root.join("paused"))
            .map_err(|error| StudioError::io("Failed to activate the pause marker", error))?;
        self.get_runtime_status()
    }

    pub async fn resume_skin(&self) -> StudioResult<RuntimeStatus> {
        let _guard = self.mutation_lock.lock().await;
        let marker = self.state_root.join("paused");
        let current = self.reconcile_runtime_locked()?;
        if !marker.exists() {
            return Ok(current);
        }
        if !current.paused {
            fs::remove_file(marker).map_err(|error| {
                StudioError::io("Failed to remove the stale pause marker", error)
            })?;
            return Ok(current);
        }

        let output = self.run_powershell_script("start-dream-skin.ps1", &[])?;
        ensure_process_success("Resume Dream Skin", output)?;
        if marker.exists() {
            fs::remove_file(&marker).map_err(|error| {
                StudioError::io("Failed to finalize the resumed skin state", error)
            })?;
        }
        self.get_runtime_status()
    }

    pub async fn stop_skin(&self) -> StudioResult<RuntimeStatus> {
        let _guard = self.mutation_lock.lock().await;
        let codex_was_running = self.get_runtime_status()?.codex_running;
        let state_path = self.state_root.join("state.json");
        let result = self
            .run_powershell_script("restore-dream-skin.ps1", &[OsString::from("-ForceRestart")])
            .and_then(|output| ensure_process_success("Stop Dream Skin", output));
        self.resolve_runtime_transition(
            result,
            |status| restore_target_reached(status, codex_was_running, state_path.is_file()),
            "Stop Dream Skin",
        )
    }

    pub async fn restore_official_appearance(
        &self,
        confirmed: bool,
    ) -> StudioResult<RuntimeStatus> {
        if !confirmed {
            return Err(StudioError::new(
                "RESTORE_CONFIRMATION_REQUIRED",
                "Restoring the official appearance requires explicit confirmation",
            ));
        }
        let _guard = self.mutation_lock.lock().await;
        let codex_was_running = self.get_runtime_status()?.codex_running;
        let state_path = self.state_root.join("state.json");
        let result = self
            .run_powershell_script(
                "restore-dream-skin.ps1",
                &[
                    OsString::from("-RestoreBaseTheme"),
                    OsString::from("-ForceRestart"),
                ],
            )
            .and_then(|output| ensure_process_success("Restore official appearance", output));
        self.resolve_runtime_transition(
            result,
            |status| restore_target_reached(status, codex_was_running, state_path.is_file()),
            "Restore official appearance",
        )
    }

    pub fn open_log_directory(&self) -> StudioResult<()> {
        fs::create_dir_all(&self.state_root)
            .map_err(|error| StudioError::io("Failed to create the log directory", error))?;
        let output = self.runner.run(
            Path::new("explorer.exe"),
            &[self.state_root.as_os_str().to_os_string()],
            Duration::from_secs(10),
        )?;
        ensure_process_success("Open log directory", output).map(|_| ())
    }

    fn run_powershell_script(
        &self,
        script_name: &str,
        extra_arguments: &[OsString],
    ) -> StudioResult<ProcessOutput> {
        let script = self.engine_root.join("scripts").join(script_name);
        let mut arguments = extra_arguments.to_vec();
        if self.inject_node_path
            && matches!(
                script_name,
                "start-dream-skin.ps1" | "verify-dream-skin.ps1"
            )
        {
            let runtime = resolve_node_runtime(
                &self.engine_root,
                &SystemEnvironmentProbe,
                &SystemNodeCandidateValidator,
            )
            .ok_or_else(|| {
                StudioError::new(
                    "NODE_NOT_FOUND",
                    "Node.js 22 or newer is unavailable in the bundled runtime and external fallback locations",
                )
            })?;
            arguments.push(OsString::from("-NodePath"));
            arguments.push(runtime.path.into_os_string());
        }
        self.runner.run(
            Path::new("powershell.exe"),
            &powershell_script_arguments(&script, &arguments),
            self.timeout,
        )
    }

    fn resolve_runtime_transition(
        &self,
        command_result: StudioResult<ProcessOutput>,
        target_reached: impl Fn(&RuntimeStatus) -> bool,
        operation: &str,
    ) -> StudioResult<RuntimeStatus> {
        match command_result {
            Ok(_) => {
                let status = self.get_runtime_status().map_err(|error| {
                    StudioError::new(
                        "RUNTIME_TARGET_NOT_REACHED",
                        format!(
                            "{operation} completed but the runtime state could not be confirmed"
                        ),
                    )
                    .with_detail(error.to_string())
                })?;
                if target_reached(&status) {
                    Ok(status)
                } else {
                    Err(StudioError::new(
                        "RUNTIME_TARGET_NOT_REACHED",
                        format!(
                            "{operation} completed but the requested runtime state was not reached"
                        ),
                    ))
                }
            }
            Err(original) if original.code() == "PROCESS_TIMEOUT" => {
                resolve_reconciled_runtime(original, self.get_runtime_status(), target_reached)
            }
            Err(original) => Err(original),
        }
    }
}

fn powershell_script_arguments(script: &Path, extra_arguments: &[OsString]) -> Vec<OsString> {
    let mut arguments = vec![
        OsString::from("-NoProfile"),
        OsString::from("-ExecutionPolicy"),
        OsString::from("RemoteSigned"),
        OsString::from("-File"),
        script.as_os_str().to_os_string(),
    ];
    arguments.extend_from_slice(extra_arguments);
    arguments
}

fn parse_runtime_status(evidence: RuntimeEvidence) -> RuntimeStatus {
    let skin_active =
        evidence.codex_running && evidence.state_present && evidence.verification_succeeded;
    let starting = evidence.codex_running
        && evidence.state_present
        && evidence.verification_pending
        && !skin_active;
    RuntimeStatus {
        codex_running: evidence.codex_running,
        skin_active,
        starting,
        paused: skin_active && evidence.pause_marker_present,
        port: skin_active.then_some(evidence.port).flatten(),
        active_theme_id: evidence.active_theme_id,
        active_theme_name: evidence.active_theme_name,
        requires_restart_confirmation: evidence.codex_running
            && !skin_active
            && !starting
            && !evidence.runtime_upgrade_available,
        last_error: evidence.verification_error,
    }
}

fn ensure_process_success(operation: &str, output: ProcessOutput) -> StudioResult<ProcessOutput> {
    if output.exit_code == 0 {
        Ok(output)
    } else {
        Err(StudioError::new(
            "ENGINE_COMMAND_FAILED",
            format!("{operation} failed with exit code {}", output.exit_code),
        )
        .with_detail(process_failure_detail(&output)))
    }
}

fn process_failure_detail(output: &ProcessOutput) -> String {
    if !output.stderr.trim().is_empty() {
        output.stderr.trim().to_string()
    } else if !output.stdout.trim().is_empty() {
        output.stdout.trim().to_string()
    } else {
        format!("Process exited with code {}", output.exit_code)
    }
}

#[derive(Debug, Deserialize)]
struct VerificationEnvelope {
    mode: String,
    targets: Vec<VerificationTarget>,
}

#[derive(Debug, Deserialize)]
struct VerificationTarget {
    result: VerificationResult,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VerificationResult {
    installed: bool,
    version: Option<String>,
    expected_version: Option<String>,
    pass: bool,
}

fn verification_requires_runtime_upgrade(output: &ProcessOutput) -> bool {
    let Ok(envelope) = serde_json::from_str::<VerificationEnvelope>(&output.stdout) else {
        return false;
    };
    envelope.mode == "verify"
        && !envelope.targets.is_empty()
        && envelope.targets.iter().all(|target| {
            let live = target
                .result
                .version
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let expected = target
                .result
                .expected_version
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty());
            target.result.installed
                && live
                    .zip(expected)
                    .is_some_and(|(live, expected)| live != expected)
        })
}

fn is_expected_inactive_verification(output: &ProcessOutput) -> bool {
    let detail = process_failure_detail(output);
    detail.contains("No verified Codex CDP endpoint is active")
        || detail.contains("active CDP browser does not match the saved Dream Skin session")
}

fn verification_is_waiting_for_renderer(output: &ProcessOutput) -> bool {
    let detail = process_failure_detail(output);
    detail.contains("No verified Codex renderer on 127.0.0.1:")
        || verification_has_unskinned_renderer(output)
}

fn verification_has_unskinned_renderer(output: &ProcessOutput) -> bool {
    let Ok(envelope) = serde_json::from_str::<VerificationEnvelope>(&output.stdout) else {
        return false;
    };
    let is_transient = |target: &VerificationTarget| {
        !target.result.installed
            && target
                .result
                .expected_version
                .as_deref()
                .map(str::trim)
                .is_some_and(|value| !value.is_empty())
    };
    envelope.mode == "verify"
        && envelope.targets.iter().any(is_transient)
        && envelope
            .targets
            .iter()
            .all(|target| target.result.pass || is_transient(target))
}

fn start_target_reached(status: &RuntimeStatus) -> bool {
    status.skin_active || status.starting
}

fn restore_target_reached(
    status: &RuntimeStatus,
    codex_was_running: bool,
    state_file_present: bool,
) -> bool {
    !state_file_present
        && !status.skin_active
        && !status.starting
        && (!codex_was_running || status.codex_running)
}

fn resolve_reconciled_runtime(
    original: StudioError,
    reconciled: StudioResult<RuntimeStatus>,
    target_reached: impl FnOnce(&RuntimeStatus) -> bool,
) -> StudioResult<RuntimeStatus> {
    match reconciled {
        Ok(status) if target_reached(&status) => Ok(status),
        _ => Err(original),
    }
}

fn read_state_port(path: &Path) -> StudioResult<Option<u16>> {
    let bytes = fs::read(path)
        .map_err(|error| StudioError::io("Failed to read Dream Skin runtime state", error))?;
    let state: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|error| StudioError::json("Failed to parse Dream Skin runtime state", error))?;
    match state.get("port") {
        None | Some(serde_json::Value::Null) => Ok(Some(9335)),
        Some(value) => {
            let port = value.as_u64().and_then(|value| u16::try_from(value).ok());
            port.filter(|port| *port > 0).map(Some).ok_or_else(|| {
                StudioError::new(
                    "RUNTIME_STATE_INVALID",
                    "Dream Skin state contains an invalid port",
                )
            })
        }
    }
}

fn watcher_heartbeat_is_stale(path: &Path, now_ms: u64, stale_after_ms: u64) -> bool {
    let heartbeat = fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<WatcherHeartbeat>(&bytes).ok());
    let Some(heartbeat) = heartbeat else {
        return true;
    };
    heartbeat.process_id == 0
        || heartbeat.updated_at > now_ms
        || now_ms - heartbeat.updated_at > stale_after_ms
}

fn read_active_theme_identity(state_root: &Path) -> (Option<String>, Option<String>) {
    let Ok(bytes) = fs::read(state_root.join("active-theme").join("theme.json")) else {
        return (None, None);
    };
    let Ok(theme) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return (None, None);
    };
    let string_field = |field: &str| {
        theme
            .get(field)
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    (string_field("id"), string_field("name"))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessSnapshot {
    pub pid: u32,
    pub executable: String,
    pub command_line: String,
}

impl ProcessSnapshot {
    pub fn new(pid: u32, executable: impl Into<String>, command_line: impl Into<String>) -> Self {
        Self {
            pid,
            executable: executable.into(),
            command_line: command_line.into(),
        }
    }
}

pub trait EnvironmentProbe {
    fn windows_version(&self) -> Option<String>;
    fn node_candidates(&self) -> Vec<PathBuf>;
    fn official_codex_version(&self) -> Option<String>;
}

pub trait NodeCandidateValidator {
    fn validate(&self, path: &Path) -> NodeCandidateValidation;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NodeCandidateValidation {
    Valid(PathBuf, String),
    Unsupported(PathBuf, String),
    Invalid,
}

#[derive(Debug, Default)]
struct NodeRuntimeResolution {
    selected: Option<ResolvedNodeRuntime>,
    first_unsupported: Option<ResolvedNodeRuntime>,
}

pub fn resolve_node_runtime(
    managed_engine: &Path,
    probe: &impl EnvironmentProbe,
    validator: &impl NodeCandidateValidator,
) -> Option<ResolvedNodeRuntime> {
    resolve_node_runtime_diagnostic(managed_engine, probe, validator).selected
}

fn resolve_node_runtime_diagnostic(
    managed_engine: &Path,
    probe: &impl EnvironmentProbe,
    validator: &impl NodeCandidateValidator,
) -> NodeRuntimeResolution {
    let mut resolution = NodeRuntimeResolution::default();
    let bundled = managed_engine.join("runtime").join("node.exe");
    if bundled.is_file() {
        match validator.validate(&bundled) {
            NodeCandidateValidation::Valid(path, version) => {
                resolution.selected = Some(ResolvedNodeRuntime {
                    path,
                    version,
                    source: NodeRuntimeSource::Bundled,
                });
                return resolution;
            }
            NodeCandidateValidation::Unsupported(path, version) => {
                resolution.first_unsupported = Some(ResolvedNodeRuntime {
                    path,
                    version,
                    source: NodeRuntimeSource::Bundled,
                });
            }
            NodeCandidateValidation::Invalid => {}
        }
    }

    let mut seen = HashSet::new();
    for candidate in probe.node_candidates().into_iter().filter_map(|candidate| {
        let candidate = fs::canonicalize(&candidate).unwrap_or(candidate);
        let key = candidate.to_string_lossy().to_lowercase();
        seen.insert(key).then_some(candidate)
    }) {
        match validator.validate(&candidate) {
            NodeCandidateValidation::Valid(path, version) => {
                resolution.selected = Some(ResolvedNodeRuntime {
                    path,
                    version,
                    source: NodeRuntimeSource::External,
                });
                return resolution;
            }
            NodeCandidateValidation::Unsupported(path, version) => {
                resolution
                    .first_unsupported
                    .get_or_insert(ResolvedNodeRuntime {
                        path,
                        version,
                        source: NodeRuntimeSource::External,
                    });
            }
            NodeCandidateValidation::Invalid => {}
        }
    }
    resolution
}

pub trait LegacyProcessControl {
    fn list_processes(&self) -> Vec<ProcessSnapshot>;
    fn stop_process(&self, pid: u32) -> std::io::Result<()>;
}

pub trait EngineDirectoryCleanup {
    fn remove_dir_all(&self, path: &Path) -> std::io::Result<()>;
}

#[derive(Debug, Default)]
struct SystemEngineDirectoryCleanup;

impl EngineDirectoryCleanup for SystemEngineDirectoryCleanup {
    fn remove_dir_all(&self, path: &Path) -> std::io::Result<()> {
        fs::remove_dir_all(path)
    }
}

pub struct EngineService;

impl EngineService {
    pub fn synchronize(
        resource_root: &Path,
        managed_engine: &Path,
    ) -> StudioResult<EngineInstallReport> {
        Self::synchronize_with_cleanup(resource_root, managed_engine, &SystemEngineDirectoryCleanup)
    }

    pub fn synchronize_with_cleanup(
        resource_root: &Path,
        managed_engine: &Path,
        cleanup: &impl EngineDirectoryCleanup,
    ) -> StudioResult<EngineInstallReport> {
        let manifest = verify_engine(resource_root)?;
        let parent = managed_engine.parent().ok_or_else(|| {
            StudioError::new("ENGINE_PATH_INVALID", "Managed engine path has no parent")
        })?;
        fs::create_dir_all(parent)
            .map_err(|error| StudioError::io("Failed to create managed engine parent", error))?;
        cleanup_stale_engine_directories(parent, cleanup);

        if verified_engine_matches(&manifest, managed_engine) {
            return Ok(EngineInstallReport {
                installed: false,
                file_count: manifest.files.len(),
                install_root: managed_engine.to_path_buf(),
            });
        }

        let nonce = Uuid::new_v4();
        let staging = parent.join(format!(".engine-stage-{nonce}"));
        let backup = parent.join(format!(".engine-backup-{nonce}"));
        let result = (|| {
            fs::create_dir(&staging).map_err(|error| {
                StudioError::io("Failed to create engine staging directory", error)
            })?;
            copy_engine(resource_root, &staging, &manifest)?;
            verify_engine(&staging)?;

            let had_existing = managed_engine.exists();
            if had_existing {
                fs::rename(managed_engine, &backup).map_err(|error| {
                    StudioError::io("Failed to stage the previous managed engine", error)
                })?;
            }
            if let Err(error) = fs::rename(&staging, managed_engine) {
                if had_existing {
                    let _ = fs::rename(&backup, managed_engine);
                }
                return Err(StudioError::io(
                    "Failed to activate the staged engine",
                    error,
                ));
            }
            if backup.exists() {
                let _ = cleanup.remove_dir_all(&backup);
            }
            Ok(EngineInstallReport {
                installed: true,
                file_count: manifest.files.len(),
                install_root: managed_engine.to_path_buf(),
            })
        })();
        if staging.exists() {
            let _ = cleanup.remove_dir_all(&staging);
        }
        result
    }

    pub fn environment_status() -> EnvironmentStatus {
        let probe = SystemEnvironmentProbe;
        let validator = SystemNodeCandidateValidator;
        let engine = dirs::data_local_dir()
            .map(|root| root.join("CodexDreamSkin").join("engine"))
            .unwrap_or_default();
        Self::environment_status_with(&probe, &validator, &engine)
    }

    pub fn environment_status_with(
        probe: &impl EnvironmentProbe,
        validator: &impl NodeCandidateValidator,
        managed_engine: &Path,
    ) -> EnvironmentStatus {
        let windows_version = probe.windows_version();
        let resolution = resolve_node_runtime_diagnostic(managed_engine, probe, validator);
        let node_supported = resolution.selected.is_some();
        let node = resolution.selected.or(resolution.first_unsupported);
        let codex_version = probe.official_codex_version();
        let engine_installed = verify_engine(managed_engine).is_ok();
        let mut error_codes = Vec::new();
        if windows_version.is_none() {
            error_codes.push("WINDOWS_VERSION_UNAVAILABLE".to_string());
        }
        match &node {
            None => {
                error_codes.push("NODE_NOT_FOUND".to_string());
            }
            Some(_) if !node_supported => {
                error_codes.push("NODE_VERSION_UNSUPPORTED".to_string());
            }
            Some(_) => {}
        }
        if codex_version.is_none() {
            error_codes.push("CODEX_NOT_FOUND".to_string());
        }
        if !engine_installed {
            error_codes.push("ENGINE_NOT_INSTALLED".to_string());
        }
        let skin_runtime_ready = windows_version.is_some()
            && node_supported
            && codex_version.is_some()
            && engine_installed;
        EnvironmentStatus {
            windows_version,
            node_path: node.as_ref().map(|runtime| runtime.path.clone()),
            node_version: node.as_ref().map(|runtime| runtime.version.clone()),
            node_source: node.map(|runtime| runtime.source),
            codex_present: codex_version.is_some(),
            codex_version,
            engine_installed,
            skin_runtime_ready,
            error_codes,
        }
    }

    pub fn retire_legacy_tray() -> StudioResult<LegacyTrayReport> {
        let local_data = dirs::data_local_dir().ok_or_else(|| {
            StudioError::new(
                "LOCAL_APP_DATA_UNAVAILABLE",
                "Windows local application data directory is unavailable",
            )
        })?;
        let canonical_script = local_data
            .join("CodexDreamSkin")
            .join("engine")
            .join("scripts")
            .join("tray-dream-skin.ps1");
        let mut shortcuts = Vec::new();
        if let Some(desktop) = dirs::desktop_dir() {
            shortcuts.push(desktop.join("Codex Dream Skin - Tray.lnk"));
        }
        if let Some(roaming) = dirs::config_dir() {
            shortcuts.push(
                roaming
                    .join("Microsoft")
                    .join("Windows")
                    .join("Start Menu")
                    .join("Programs")
                    .join("Codex Dream Skin - Tray.lnk"),
            );
        }
        Self::retire_legacy_tray_with(&PowerShellProcessControl, &canonical_script, &shortcuts)
    }

    pub fn retire_legacy_tray_with(
        control: &impl LegacyProcessControl,
        canonical_script: &Path,
        shortcut_paths: &[PathBuf],
    ) -> StudioResult<LegacyTrayReport> {
        let canonical = normalized_path(canonical_script);
        let mut stopped_processes = Vec::new();
        for process in control.list_processes() {
            if is_legacy_tray_process(&process, &canonical) {
                control.stop_process(process.pid).map_err(|error| {
                    StudioError::io("Failed to stop the legacy Dream Skin tray", error)
                })?;
                stopped_processes.push(process.pid);
            }
        }
        let mut removed_shortcuts = Vec::new();
        for shortcut in shortcut_paths {
            if shortcut.is_file() {
                fs::remove_file(shortcut).map_err(|error| {
                    StudioError::io("Failed to remove a legacy Dream Skin tray shortcut", error)
                })?;
                removed_shortcuts.push(shortcut.clone());
            }
        }
        Ok(LegacyTrayReport {
            stopped_processes,
            removed_shortcuts,
        })
    }
}

fn verified_engine_matches(source: &EngineSourceManifest, managed_engine: &Path) -> bool {
    let Ok(mut managed) = verify_engine(managed_engine) else {
        return false;
    };
    let mut source_files = source.files.clone();
    source_files.sort_by(|left, right| left.path.cmp(&right.path));
    managed
        .files
        .sort_by(|left, right| left.path.cmp(&right.path));
    source_files == managed.files
}

fn cleanup_stale_engine_directories(parent: &Path, cleanup: &impl EngineDirectoryCleanup) {
    let Ok(entries) = fs::read_dir(parent) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !name.starts_with(".engine-backup-") && !name.starts_with(".engine-stage-") {
            continue;
        }
        if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            let _ = cleanup.remove_dir_all(&path);
        }
    }
}

fn load_manifest(root: &Path) -> StudioResult<EngineSourceManifest> {
    let bytes = fs::read(root.join(ENGINE_MANIFEST))
        .map_err(|error| StudioError::io("Failed to read the engine source manifest", error))?;
    serde_json::from_slice(&bytes)
        .map_err(|error| StudioError::json("Failed to parse the engine source manifest", error))
}

fn verify_engine(root: &Path) -> StudioResult<EngineSourceManifest> {
    let manifest = load_manifest(root)?;
    for entry in &manifest.files {
        let relative = safe_relative_path(&entry.path)?;
        let bytes = fs::read(root.join(relative)).map_err(|error| {
            StudioError::io(&format!("Missing engine resource {}", entry.path), error)
        })?;
        let actual = format!("{:x}", Sha256::digest(bytes));
        if !actual.eq_ignore_ascii_case(&entry.sha256) {
            return Err(StudioError::new(
                "ENGINE_HASH_MISMATCH",
                format!(
                    "Bundled engine resource failed verification: {}",
                    entry.path
                ),
            ));
        }
    }
    Ok(manifest)
}

fn copy_engine(
    source: &Path,
    destination: &Path,
    manifest: &EngineSourceManifest,
) -> StudioResult<()> {
    fs::copy(
        source.join(ENGINE_MANIFEST),
        destination.join(ENGINE_MANIFEST),
    )
    .map_err(|error| StudioError::io("Failed to stage the engine source manifest", error))?;
    for entry in &manifest.files {
        let relative = safe_relative_path(&entry.path)?;
        let target = destination.join(&relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                StudioError::io("Failed to create staged engine directory", error)
            })?;
        }
        fs::copy(source.join(&relative), target)
            .map_err(|error| StudioError::io("Failed to stage an engine resource", error))?;
    }
    Ok(())
}

fn safe_relative_path(path: &str) -> StudioResult<PathBuf> {
    let path = Path::new(path);
    if path
        .components()
        .all(|component| matches!(component, Component::Normal(_)))
    {
        Ok(path.to_path_buf())
    } else {
        Err(StudioError::new(
            "ENGINE_MANIFEST_PATH_INVALID",
            "Engine manifest contains an unsafe resource path",
        ))
    }
}

fn node_major_version(version: &str) -> Option<u32> {
    version
        .trim()
        .trim_start_matches(['v', 'V'])
        .split('.')
        .next()?
        .parse()
        .ok()
}

fn normalized_path(path: &Path) -> String {
    let resolved = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let normalized = resolved.to_string_lossy().replace('\\', "/").to_lowercase();
    normalized
        .strip_prefix("//?/")
        .unwrap_or(&normalized)
        .to_string()
}

fn is_legacy_tray_process(process: &ProcessSnapshot, canonical_script: &str) -> bool {
    let executable = process.executable.to_lowercase();
    let is_powershell = executable == "powershell.exe"
        || executable == "powershell"
        || executable == "pwsh.exe"
        || executable == "pwsh";
    is_powershell
        && process
            .command_line
            .replace('\\', "/")
            .to_lowercase()
            .contains(canonical_script)
}

struct SystemEnvironmentProbe;

#[derive(Debug, Default)]
pub struct SystemNodeCandidateValidator;

impl NodeCandidateValidator for SystemNodeCandidateValidator {
    fn validate(&self, path: &Path) -> NodeCandidateValidation {
        if !path.is_file() {
            return NodeCandidateValidation::Invalid;
        }
        let Some(version) = command_stdout_path(path, &["-p", "process.versions.node"]) else {
            return NodeCandidateValidation::Invalid;
        };
        let Some(executable) = command_stdout_path(path, &["-p", "process.execPath"]) else {
            return NodeCandidateValidation::Invalid;
        };
        let executable = PathBuf::from(executable);
        if !executable.is_file() {
            return NodeCandidateValidation::Invalid;
        }
        let executable = fs::canonicalize(&executable).unwrap_or(executable);
        match node_major_version(&version) {
            Some(major) if major >= 22 => NodeCandidateValidation::Valid(executable, version),
            Some(_) => NodeCandidateValidation::Unsupported(executable, version),
            None => NodeCandidateValidation::Invalid,
        }
    }
}

impl EnvironmentProbe for SystemEnvironmentProbe {
    fn windows_version(&self) -> Option<String> {
        command_stdout("cmd.exe", &["/C", "ver"])
    }

    fn node_candidates(&self) -> Vec<PathBuf> {
        system_node_candidates()
    }

    fn official_codex_version(&self) -> Option<String> {
        command_stdout(
            "powershell.exe",
            &[
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "(Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1 -ExpandProperty Version).ToString()",
            ],
        )
    }
}

fn command_stdout(program: &str, args: &[&str]) -> Option<String> {
    command_stdout_path(program, args)
}

fn command_stdout_path(program: impl AsRef<OsStr>, args: &[&str]) -> Option<String> {
    let output = hidden_command(program).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!value.is_empty()).then_some(value)
}

fn system_node_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = env::var_os("PATH") {
        candidates.extend(env::split_paths(&path).map(|root| root.join("node.exe")));
    }
    if let Some(paths) = command_stdout("where.exe", &["node.exe"]) {
        candidates.extend(
            paths
                .lines()
                .map(str::trim)
                .filter(|path| !path.is_empty())
                .map(PathBuf::from),
        );
    }

    for registry_path in registry_values("Path") {
        candidates.extend(
            env::split_paths(&OsString::from(expand_environment_variables(
                &registry_path,
            )))
            .map(|root| root.join("node.exe")),
        );
    }

    for key in [
        "NODE_BINARY",
        "NVM_HOME",
        "NVM_SYMLINK",
        "FNM_DIR",
        "FNM_MULTISHELL_PATH",
        "NODE_HOME",
        "NODEJS_HOME",
        "VOLTA_HOME",
    ] {
        let mut values = env::var_os(key)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_string_lossy().to_string())
            .into_iter()
            .collect::<Vec<_>>();
        values.extend(registry_values(key));
        for value in values {
            add_node_variable_candidates(&mut candidates, key, &value);
        }
    }
    if let Some(value) = env::var_os("ChocolateyInstall").filter(|value| !value.is_empty()) {
        candidates.push(PathBuf::from(value).join("bin").join("node.exe"));
    }
    if let Some(value) = env::var_os("ProgramFiles").filter(|value| !value.is_empty()) {
        candidates.push(PathBuf::from(value).join("nodejs").join("node.exe"));
    }
    if let Some(value) = env::var_os("ProgramFiles(x86)").filter(|value| !value.is_empty()) {
        candidates.push(PathBuf::from(value).join("nodejs").join("node.exe"));
    }
    if let Some(value) = env::var_os("LOCALAPPDATA").filter(|value| !value.is_empty()) {
        let root = PathBuf::from(value);
        candidates.push(root.join("Programs").join("nodejs").join("node.exe"));
        candidates.push(root.join("Volta").join("bin").join("node.exe"));
        add_version_manager_candidates(&mut candidates, &root.join("fnm"));
        add_version_manager_candidates(&mut candidates, &root.join("nvm"));
    }
    if let Some(value) = env::var_os("USERPROFILE").filter(|value| !value.is_empty()) {
        let root = PathBuf::from(value);
        candidates.push(root.join(".volta").join("bin").join("node.exe"));
        candidates.push(
            root.join("scoop")
                .join("apps")
                .join("nodejs")
                .join("current")
                .join("node.exe"),
        );
        candidates.push(
            root.join("scoop")
                .join("apps")
                .join("nodejs-lts")
                .join("current")
                .join("node.exe"),
        );
        add_version_manager_candidates(&mut candidates, &root.join(".fnm"));
        add_version_manager_candidates(&mut candidates, &root.join("AppData/Roaming/nvm"));
    }

    let mut seen = HashSet::new();
    candidates
        .into_iter()
        .filter(|path| seen.insert(path.to_string_lossy().to_lowercase()))
        .collect()
}

fn add_node_variable_candidates(candidates: &mut Vec<PathBuf>, key: &str, value: &str) {
    let path = PathBuf::from(expand_environment_variables(value));
    match key {
        "NODE_BINARY" => candidates.push(path),
        "NVM_HOME" | "FNM_DIR" => {
            candidates.push(path.join("node.exe"));
            add_version_manager_candidates(candidates, &path);
        }
        "NVM_SYMLINK" | "FNM_MULTISHELL_PATH" | "NODE_HOME" | "NODEJS_HOME" => {
            candidates.push(path.join("node.exe"));
        }
        "VOLTA_HOME" => candidates.push(path.join("bin").join("node.exe")),
        _ => {}
    }
}

fn add_version_manager_candidates(candidates: &mut Vec<PathBuf>, root: &Path) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten().filter(|entry| entry.path().is_dir()) {
        let version = entry.path();
        candidates.push(version.join("node.exe"));
        candidates.push(version.join("installation").join("node.exe"));
    }
    let node_versions = root.join("node-versions");
    let Ok(entries) = fs::read_dir(node_versions) else {
        return;
    };
    for entry in entries.flatten().filter(|entry| entry.path().is_dir()) {
        candidates.push(entry.path().join("installation").join("node.exe"));
    }
}

fn registry_values(name: &str) -> Vec<String> {
    [
        r"HKCU\Environment",
        r"HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment",
    ]
    .into_iter()
    .filter_map(|key| registry_value(key, name))
    .collect()
}

fn registry_value(key: &str, name: &str) -> Option<String> {
    let output = command_stdout("reg.exe", &["query", key, "/v", name])?;
    output.lines().find_map(|line| {
        let line = line.trim();
        for marker in ["REG_EXPAND_SZ", "REG_SZ"] {
            if let Some((_, value)) = line.split_once(marker) {
                let value = value.trim();
                if !value.is_empty() {
                    return Some(value.to_string());
                }
            }
        }
        None
    })
}

fn expand_environment_variables(value: &str) -> String {
    let mut expanded = value.to_string();
    for (name, replacement) in env::vars() {
        expanded = expanded.replace(&format!("%{name}%"), &replacement);
    }
    expanded
}

#[cfg(test)]
fn select_node_installation(
    installations: impl IntoIterator<Item = (PathBuf, String)>,
) -> Option<(PathBuf, String)> {
    let mut fallback = None;
    for installation in installations {
        if node_major_version(&installation.1).is_some_and(|major| major >= 22) {
            return Some(installation);
        }
        fallback.get_or_insert(installation);
    }
    fallback
}

struct PowerShellProcessControl;

impl LegacyProcessControl for PowerShellProcessControl {
    fn list_processes(&self) -> Vec<ProcessSnapshot> {
        let script = "Get-CimInstance Win32_Process | ForEach-Object { [Console]::WriteLine(($_.ProcessId.ToString() + \"`t\" + $_.Name + \"`t\" + $_.CommandLine)) }";
        command_stdout(
            "powershell.exe",
            &["-NoProfile", "-NonInteractive", "-Command", script],
        )
        .map(|output| {
            output
                .lines()
                .filter_map(|line| {
                    let mut fields = line.splitn(3, '\t');
                    Some(ProcessSnapshot::new(
                        fields.next()?.parse().ok()?,
                        fields.next()?,
                        fields.next().unwrap_or_default(),
                    ))
                })
                .collect()
        })
        .unwrap_or_default()
    }

    fn stop_process(&self, pid: u32) -> std::io::Result<()> {
        let status = hidden_command("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                &format!("Stop-Process -Id {pid} -Force -ErrorAction Stop"),
            ])
            .status()?;
        if status.success() {
            Ok(())
        } else {
            Err(std::io::Error::other(format!(
                "PowerShell exited with {status}"
            )))
        }
    }
}

#[cfg(test)]
mod runtime_lifecycle_tests {
    use super::*;
    use std::{
        collections::VecDeque,
        ffi::OsString,
        path::Path,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc, Mutex,
        },
        time::Duration,
    };
    use tempfile::tempdir;

    #[test]
    fn watcher_heartbeat_is_stale_when_missing_malformed_or_expired() {
        let root = tempdir().unwrap();
        let path = root.path().join("watcher-heartbeat.json");
        let now_ms = 100_000;

        assert!(watcher_heartbeat_is_stale(&path, now_ms, 30_000));
        fs::write(&path, b"not-json").unwrap();
        assert!(watcher_heartbeat_is_stale(&path, now_ms, 30_000));
        fs::write(&path, br#"{"processId":7,"updatedAt":69999}"#).unwrap();
        assert!(watcher_heartbeat_is_stale(&path, now_ms, 30_000));
        fs::write(&path, br#"{"processId":7,"updatedAt":70000}"#).unwrap();
        assert!(!watcher_heartbeat_is_stale(&path, now_ms, 30_000));
    }

    fn write_fresh_watcher_heartbeat(state_root: &Path) {
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        fs::write(
            state_root.join("watcher-heartbeat.json"),
            format!(r#"{{"processId":7,"updatedAt":{now_ms}}}"#),
        )
        .unwrap();
    }

    #[tokio::test]
    async fn stale_watcher_is_restarted_without_codex_restart_permission() {
        let root = tempdir().unwrap();
        let engine = root.path().join("engine");
        fs::create_dir_all(engine.join("scripts")).unwrap();
        let state = root.path().join("state");
        fs::create_dir_all(&state).unwrap();
        fs::write(state.join("state.json"), br#"{"port":9335}"#).unwrap();
        fs::write(
            state.join("watcher-heartbeat.json"),
            br#"{"processId":7,"updatedAt":1}"#,
        )
        .unwrap();
        let inactive = ProcessOutput {
            exit_code: 1,
            stdout: String::new(),
            stderr: "No verified Codex CDP endpoint is active on loopback port 9335.".into(),
        };
        let runner = Arc::new(RecordingRunner::new(vec![
            ProcessOutput::success("ChatGPT.exe,1234"),
            inactive,
            ProcessOutput::success("watcher recovered"),
            ProcessOutput::success("ChatGPT.exe,1234"),
            ProcessOutput::success("skin verified"),
        ]));
        let runtime =
            EngineRuntime::with_runner(engine, state, runner.clone(), Duration::from_secs(2));

        let status = runtime.reconcile_runtime().await.unwrap();

        assert!(status.skin_active);
        let calls = runner.calls();
        assert!(calls
            .iter()
            .any(|call| call.1.contains(&OsString::from("-RecoverWatcherOnly"))));
        assert!(!calls
            .iter()
            .any(|call| call.1.contains(&OsString::from("-RestartExisting"))));
    }

    #[tokio::test]
    async fn unavailable_cdp_skips_watcher_recovery_without_surface_error() {
        let root = tempdir().unwrap();
        let engine = root.path().join("engine");
        fs::create_dir_all(engine.join("scripts")).unwrap();
        let state = root.path().join("state");
        fs::create_dir_all(&state).unwrap();
        fs::write(state.join("state.json"), br#"{"port":9335}"#).unwrap();
        let inactive = ProcessOutput {
            exit_code: 1,
            stdout: String::new(),
            stderr: "No verified Codex CDP endpoint is active on loopback port 9335.".into(),
        };
        let runner = Arc::new(RecordingRunner::new(vec![
            ProcessOutput::success("ChatGPT.exe,1234"),
            inactive,
            ProcessOutput {
                exit_code: 4,
                stdout: String::new(),
                stderr: "saved Codex CDP identity is unavailable".into(),
            },
        ]));
        let runtime = EngineRuntime::with_runner(engine, state, runner, Duration::from_secs(2));

        let status = runtime.reconcile_runtime().await.unwrap();

        assert!(status.requires_restart_confirmation);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn queued_reconciliation_rechecks_heartbeat_inside_the_lock() {
        let root = tempdir().unwrap();
        let engine = root.path().join("engine");
        fs::create_dir_all(engine.join("scripts")).unwrap();
        let state = root.path().join("state");
        fs::create_dir_all(&state).unwrap();
        fs::write(state.join("state.json"), br#"{"port":9335}"#).unwrap();
        let runner = Arc::new(HeartbeatRecoveryRunner::new(state.clone()));
        let runtime = Arc::new(EngineRuntime::with_runner(
            engine,
            state,
            runner.clone(),
            Duration::from_secs(2),
        ));

        let first_runtime = runtime.clone();
        let first = tokio::spawn(async move { first_runtime.reconcile_runtime().await });
        tokio::time::sleep(Duration::from_millis(10)).await;
        let second_runtime = runtime.clone();
        let second = tokio::spawn(async move { second_runtime.reconcile_runtime().await });

        assert!(first.await.unwrap().unwrap().skin_active);
        assert!(second.await.unwrap().unwrap().skin_active);
        assert_eq!(runner.recoveries.load(Ordering::SeqCst), 1);
    }

    fn version_mismatch_output() -> ProcessOutput {
        ProcessOutput {
            exit_code: 2,
            stdout: r#"{
              "mode":"verify","port":9335,"targets":[
                {"targetId":"page-1","result":{
                  "installed":true,"version":"1.5.1","expectedVersion":"1.6.0","pass":false
                }}
              ]
            }"#
            .into(),
            stderr: String::new(),
        }
    }

    #[test]
    fn structured_version_mismatch_is_upgradeable_without_runtime_error() {
        let output = version_mismatch_output();
        assert!(verification_requires_runtime_upgrade(&output));
        let status = parse_runtime_status(RuntimeEvidence {
            codex_running: true,
            state_present: true,
            runtime_upgrade_available: true,
            port: Some(9335),
            active_theme_id: Some("yingying".into()),
            active_theme_name: Some("萦萦".into()),
            ..RuntimeEvidence::default()
        });
        assert!(!status.skin_active);
        assert!(!status.requires_restart_confirmation);
        assert_eq!(status.last_error, None);
    }

    #[test]
    fn renderer_readiness_is_starting_not_a_restart_or_runtime_failure() {
        let output = ProcessOutput {
            exit_code: 2,
            stdout: String::new(),
            stderr: "No verified Codex renderer on 127.0.0.1:9335: No page matched the expected Codex shell markers".into(),
        };
        assert!(verification_is_waiting_for_renderer(&output));

        let status = parse_runtime_status(RuntimeEvidence {
            codex_running: true,
            state_present: true,
            verification_pending: true,
            port: Some(9335),
            ..RuntimeEvidence::default()
        });
        assert!(status.starting);
        assert!(!status.skin_active);
        assert!(!status.requires_restart_confirmation);
        assert_eq!(status.last_error, None);
    }

    #[test]
    fn structured_unskinned_renderer_is_starting_without_restart_confirmation() {
        let root = tempdir().unwrap();
        let engine = root.path().join("engine");
        fs::create_dir_all(engine.join("scripts")).unwrap();
        let state = root.path().join("state");
        fs::create_dir_all(&state).unwrap();
        fs::write(state.join("state.json"), br#"{"port":9335}"#).unwrap();
        let verify = ProcessOutput {
            exit_code: 2,
            stdout: r#"{
              "mode":"verify","port":9335,"targets":[
                {"targetId":"page-1","result":{
                  "installed":false,"version":null,"expectedVersion":"1.6.0","pass":false
                }}
              ]
            }"#
            .into(),
            stderr: String::new(),
        };
        let runner = Arc::new(RecordingRunner::new(vec![
            ProcessOutput::success("ChatGPT.exe,1234"),
            verify,
        ]));
        let runtime = EngineRuntime::with_runner(engine, state, runner, Duration::from_secs(2));

        let status = runtime.get_runtime_status().unwrap();

        assert!(status.codex_running);
        assert!(status.starting);
        assert!(!status.skin_active);
        assert!(!status.requires_restart_confirmation);
        assert_eq!(status.last_error, None);
    }

    #[test]
    fn mixed_target_failure_is_not_renderer_pending() {
        let passing_companion = ProcessOutput {
            exit_code: 2,
            stdout: r#"{
              "mode":"verify","port":9335,"targets":[
                {"targetId":"loading","result":{
                  "installed":false,"version":null,"expectedVersion":"1.6.0","pass":false
                }},
                {"targetId":"ready","result":{
                  "installed":true,"version":"1.6.0","expectedVersion":"1.6.0","pass":true
                }}
              ]
            }"#
            .into(),
            stderr: String::new(),
        };
        let output = ProcessOutput {
            exit_code: 2,
            stdout: r#"{
              "mode":"verify","port":9335,"targets":[
                {"targetId":"loading","result":{
                  "installed":false,"version":null,"expectedVersion":"1.6.0","pass":false
                }},
                {"targetId":"failed","result":{
                  "installed":true,"version":"1.5.1","expectedVersion":"1.6.0","pass":false
                }}
              ]
            }"#
            .into(),
            stderr: String::new(),
        };

        assert!(verification_is_waiting_for_renderer(&passing_companion));
        assert!(!verification_is_waiting_for_renderer(&output));
    }

    #[test]
    fn a_bounded_no_renderer_result_is_starting_not_an_error() {
        let output = ProcessOutput {
            exit_code: 2,
            stdout: String::new(),
            stderr: "No verified Codex renderer on 127.0.0.1:9335: CDP operation deadline exceeded"
                .into(),
        };

        assert!(verification_is_waiting_for_renderer(&output));
    }

    #[test]
    fn default_runtime_timeout_covers_launch_and_injector_verification_windows() {
        let runtime = EngineRuntime::new(PathBuf::from("engine"), PathBuf::from("state"));
        assert_eq!(runtime.timeout, Duration::from_secs(120));
    }

    #[test]
    fn timeout_error_distinguishes_unreaped_process_cleanup() {
        let timeout = Duration::from_secs(120);
        let clean = process_timeout_error(timeout, None);
        assert_eq!(clean.code(), "PROCESS_TIMEOUT");
        assert_eq!(clean.detail, None);

        let cleanup_failure = StudioError::new(
            "PROCESS_TREE_TERMINATION_FAILED",
            "Timed-out process tree could not be terminated cleanly",
        )
        .with_detail("direct child remained alive");
        let unreaped = process_timeout_error(timeout, Some(cleanup_failure));
        assert_eq!(unreaped.code(), "PROCESS_TIMEOUT_CLEANUP_FAILED");
        assert!(unreaped
            .detail
            .as_deref()
            .is_some_and(|detail| detail.contains("direct child remained alive")));
    }

    #[test]
    fn node_selection_prefers_a_supported_runtime_over_an_older_path_entry() {
        let selected = select_node_installation([
            (PathBuf::from(r"C:\old-node\node.exe"), "20.18.0".into()),
            (
                PathBuf::from(r"C:\Program Files\nodejs\node.exe"),
                "22.20.0".into(),
            ),
        ])
        .unwrap();

        assert_eq!(
            selected.0,
            PathBuf::from(r"C:\Program Files\nodejs\node.exe")
        );
        assert_eq!(selected.1, "22.20.0");
    }

    #[test]
    fn malformed_or_unrelated_verifier_failures_are_not_pending_or_upgradeable() {
        for output in [
            ProcessOutput {
                exit_code: 2,
                stdout: "{bad-json".into(),
                stderr: String::new(),
            },
            ProcessOutput {
                exit_code: 2,
                stdout: r#"{"targets":[{"result":{"installed":false,"version":"1.5.1","expectedVersion":"1.6.0"}}]}"#.into(),
                stderr: String::new(),
            },
            ProcessOutput {
                exit_code: 2,
                stdout: r#"{"targets":[{"result":{"installed":true,"version":"1.6.0","expectedVersion":"1.6.0"}}]}"#.into(),
                stderr: String::new(),
            },
        ] {
            assert!(!verification_is_waiting_for_renderer(&output));
            assert!(!verification_requires_runtime_upgrade(&output));
        }
    }

    #[cfg(windows)]
    #[test]
    fn direct_child_output_returns_before_inherited_handle_grandchild_exits() {
        let root = tempdir().unwrap();
        let script = root.path().join("spawn-grandchild.ps1");
        fs::write(
            &script,
            r#"
              $child = Start-Process powershell.exe -ArgumentList @(
                '-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 4'
              ) -WindowStyle Hidden -PassThru
              [Console]::Out.WriteLine("direct child complete:$($child.Id)")
              [Console]::Error.WriteLine('direct child diagnostic')
              exit 0
            "#,
        )
        .unwrap();
        let runner = SystemProcessRunner;
        let started = Instant::now();

        let output = runner
            .run(
                Path::new("powershell.exe"),
                &powershell_script_arguments(&script, &[]),
                Duration::from_secs(2),
            )
            .unwrap();

        assert!(started.elapsed() < Duration::from_secs(2));
        assert!(output.stdout.contains("direct child complete"));
        assert!(output.stderr.contains("direct child diagnostic"));
    }

    #[cfg(windows)]
    #[test]
    fn missing_taskkill_still_terminates_and_reaps_the_direct_child_within_a_deadline() {
        let root = tempdir().unwrap();
        let mut child = hidden_command("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Start-Sleep -Seconds 60",
            ])
            .spawn()
            .unwrap();
        let started = Instant::now();
        let missing_taskkill = hidden_command(root.path().join("missing-taskkill.exe"));

        let error = terminate_spawned_process_tree_with_command(
            &mut child,
            missing_taskkill,
            Duration::from_millis(500),
            Duration::from_millis(500),
        )
        .unwrap_err();

        assert_eq!(error.code(), "PROCESS_TREE_TERMINATION_FAILED");
        assert!(started.elapsed() < Duration::from_secs(2));
        assert!(child.try_wait().unwrap().is_some());
    }

    #[cfg(windows)]
    #[test]
    fn nonzero_taskkill_falls_back_without_an_unbounded_child_wait() {
        let failing_taskkill = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("dream-skin-engine")
            .join("runtime")
            .join("node.exe");
        let mut child = hidden_command("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Start-Sleep -Seconds 60",
            ])
            .spawn()
            .unwrap();
        let started = Instant::now();
        let mut nonzero_taskkill = hidden_command(failing_taskkill);
        nonzero_taskkill.args(["-e", "process.exit(7)"]);

        let error = terminate_spawned_process_tree_with_command(
            &mut child,
            nonzero_taskkill,
            Duration::from_millis(500),
            Duration::from_millis(500),
        )
        .unwrap_err();

        assert_eq!(error.code(), "PROCESS_TREE_TERMINATION_FAILED");
        assert!(started.elapsed() < Duration::from_secs(2));
        assert!(child.try_wait().unwrap().is_some());
    }

    #[cfg(windows)]
    #[test]
    fn hanging_taskkill_is_terminated_before_falling_back_to_the_direct_child() {
        let mut child = hidden_command("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Start-Sleep -Seconds 60",
            ])
            .spawn()
            .unwrap();
        let mut hanging_taskkill = hidden_command("powershell.exe");
        hanging_taskkill.args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Start-Sleep -Seconds 60",
        ]);
        let started = Instant::now();

        let error = terminate_spawned_process_tree_with_command(
            &mut child,
            hanging_taskkill,
            Duration::from_millis(200),
            Duration::from_millis(500),
        )
        .unwrap_err();

        assert_eq!(error.code(), "PROCESS_TREE_TERMINATION_FAILED");
        assert!(error
            .detail
            .as_deref()
            .is_some_and(|detail| detail.contains("PROCESS_TREE_TERMINATOR_TIMEOUT")));
        assert!(started.elapsed() < Duration::from_secs(2));
        assert!(child.try_wait().unwrap().is_some());
    }

    #[cfg(windows)]
    #[test]
    fn timed_out_command_terminates_only_its_spawned_process_tree() {
        let root = tempdir().unwrap();
        let script = root.path().join("spawn-node-child.ps1");
        let node_script = root.path().join("hold-open.mjs");
        let ready_file = root.path().join("node-ready.txt");
        let identity_file = root.path().join("process-tree-identities.json");
        let sentinel_script = root.path().join("sentinel.mjs");
        let sentinel_ready = root.path().join("sentinel-ready.txt");
        let node = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("dream-skin-engine")
            .join("runtime")
            .join("node.exe");
        assert!(node.is_file(), "bundled Node test runtime is missing");
        let node_source = "import { writeFileSync } from 'node:fs';\nwriteFileSync(process.argv[2], 'ready');\nsetInterval(() => {}, 60000);\n";
        fs::write(&node_script, node_source).unwrap();
        fs::write(&sentinel_script, node_source).unwrap();
        fs::write(
            &script,
            format!(
                r#"
                  $child = Start-Process -FilePath '{}' -ArgumentList @('{}', '{}') -WindowStyle Hidden -PassThru
                  while (-not (Test-Path -LiteralPath '{}')) {{ Start-Sleep -Milliseconds 10 }}
                  $identities = @(
                    Get-CimInstance Win32_Process -Filter "ProcessId = $PID"
                    Get-CimInstance Win32_Process -Filter "ProcessId = $($child.Id)"
                  ) | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CreationDate,CommandLine
                  $identities | ConvertTo-Json -Compress | Set-Content -LiteralPath '{}' -Encoding utf8
                  Wait-Process -Id $child.Id
                "#,
                node.display(),
                node_script.display(),
                ready_file.display(),
                ready_file.display(),
                identity_file.display()
            ),
        )
        .unwrap();

        let sentinel_child = hidden_command(&node)
            .args([&sentinel_script, &sentinel_ready])
            .spawn()
            .unwrap();
        wait_for_file(&sentinel_ready, Duration::from_secs(2)).unwrap();
        let sentinel_identity =
            wait_for_process_identity(sentinel_child.id(), Duration::from_secs(2)).unwrap();
        assert!(sentinel_identity
            .command_line
            .as_deref()
            .is_some_and(|line| line.contains(&sentinel_script.to_string_lossy().to_string())));
        let mut sentinel = ExactTestProcess::new(sentinel_child, sentinel_identity.clone());

        let _ = hidden_command("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", "exit 0"])
            .output()
            .unwrap();

        let runner = SystemProcessRunner;
        let error = runner
            .run(
                Path::new("powershell.exe"),
                &powershell_script_arguments(&script, &[]),
                Duration::from_secs(3),
            )
            .unwrap_err();
        assert_eq!(error.code(), "PROCESS_TIMEOUT");

        let identities: Vec<TestProcessIdentity> = serde_json::from_str(
            fs::read_to_string(&identity_file)
                .unwrap()
                .trim_start_matches('\u{feff}'),
        )
        .unwrap();
        assert_eq!(identities.len(), 2);
        let survivors: Vec<_> = identities
            .iter()
            .filter(|identity| !wait_for_identity_to_disappear(identity, Duration::from_secs(5)))
            .cloned()
            .collect();
        for identity in &survivors {
            terminate_exact_test_identity(identity).unwrap();
        }
        assert!(
            survivors.is_empty(),
            "timed-out process tree survived: {survivors:?}"
        );
        assert_eq!(
            query_process_identity(sentinel_identity.process_id),
            Some(sentinel_identity)
        );
        sentinel.terminate().unwrap();
    }

    #[cfg(windows)]
    #[derive(Debug, Clone, Deserialize, PartialEq)]
    #[serde(rename_all = "PascalCase")]
    struct TestProcessIdentity {
        process_id: u32,
        parent_process_id: u32,
        name: String,
        executable_path: Option<String>,
        creation_date: serde_json::Value,
        command_line: Option<String>,
    }

    #[cfg(windows)]
    struct ExactTestProcess {
        child: Option<std::process::Child>,
        identity: TestProcessIdentity,
    }

    #[cfg(windows)]
    impl ExactTestProcess {
        fn new(child: std::process::Child, identity: TestProcessIdentity) -> Self {
            Self {
                child: Some(child),
                identity,
            }
        }

        fn terminate(&mut self) -> StudioResult<()> {
            if query_process_identity(self.identity.process_id).as_ref() != Some(&self.identity) {
                self.child.take();
                return Ok(());
            }
            let mut child = self.child.take().ok_or_else(|| {
                StudioError::new("TEST_PROCESS_MISSING", "Test process handle is unavailable")
            })?;
            terminate_spawned_process_tree(&mut child)
        }
    }

    #[cfg(windows)]
    impl Drop for ExactTestProcess {
        fn drop(&mut self) {
            let _ = self.terminate();
        }
    }

    #[cfg(windows)]
    fn query_process_identity(pid: u32) -> Option<TestProcessIdentity> {
        let query = format!(
            "$process = Get-CimInstance Win32_Process -Filter 'ProcessId = {pid}'; if ($null -ne $process) {{ $process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CreationDate,CommandLine | ConvertTo-Json -Compress }}"
        );
        let output = hidden_command("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &query])
            .output()
            .ok()?;
        if !output.status.success() || output.stdout.is_empty() {
            return None;
        }
        serde_json::from_slice(&output.stdout).ok()
    }

    #[cfg(windows)]
    fn wait_for_process_identity(pid: u32, timeout: Duration) -> Option<TestProcessIdentity> {
        let deadline = Instant::now() + timeout;
        loop {
            if let Some(identity) = query_process_identity(pid) {
                return Some(identity);
            }
            if Instant::now() >= deadline {
                return None;
            }
            thread::sleep(Duration::from_millis(25));
        }
    }

    #[cfg(windows)]
    fn wait_for_identity_to_disappear(identity: &TestProcessIdentity, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        loop {
            if query_process_identity(identity.process_id).as_ref() != Some(identity) {
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
            thread::sleep(Duration::from_millis(50));
        }
    }

    #[cfg(windows)]
    fn terminate_exact_test_identity(identity: &TestProcessIdentity) -> StudioResult<()> {
        if query_process_identity(identity.process_id).as_ref() != Some(identity) {
            return Err(StudioError::new(
                "TEST_PROCESS_IDENTITY_CHANGED",
                "Refusing to terminate a reused or unrelated test PID",
            ));
        }
        let pid = identity.process_id.to_string();
        let mut taskkill = hidden_command("taskkill.exe");
        taskkill.args(["/PID", pid.as_str(), "/T", "/F"]);
        let output =
            run_cleanup_command_bounded(taskkill, Duration::from_secs(2), Duration::from_secs(2))?;
        if output.exit_code != 0 {
            return Err(process_tree_termination_error(output.stderr.trim()));
        }
        if wait_for_identity_to_disappear(identity, Duration::from_secs(2)) {
            Ok(())
        } else {
            Err(process_tree_termination_error(
                "Exact test process survived cleanup deadline",
            ))
        }
    }

    #[cfg(windows)]
    fn wait_for_file(path: &Path, timeout: Duration) -> StudioResult<()> {
        let deadline = Instant::now() + timeout;
        while !path.is_file() {
            if Instant::now() >= deadline {
                return Err(StudioError::new(
                    "TEST_READY_TIMEOUT",
                    format!("Test readiness file was not created: {}", path.display()),
                ));
            }
            thread::sleep(Duration::from_millis(25));
        }
        Ok(())
    }

    #[test]
    fn powershell_scripts_use_structured_argument_arrays() {
        let args = powershell_script_arguments(
            Path::new(r"C:\Program Files\Dream Skin\start-dream-skin.ps1"),
            &[OsString::from("-RestartExisting")],
        );

        assert_eq!(
            args,
            vec![
                OsString::from("-NoProfile"),
                OsString::from("-ExecutionPolicy"),
                OsString::from("RemoteSigned"),
                OsString::from("-File"),
                OsString::from(r"C:\Program Files\Dream Skin\start-dream-skin.ps1"),
                OsString::from("-RestartExisting"),
            ]
        );
        assert!(!args.iter().any(|argument| argument
            .to_string_lossy()
            .contains("powershell.exe -NoProfile")));
    }

    #[test]
    fn lifecycle_states_are_parsed_without_trusting_stale_state() {
        let closed = RuntimeEvidence::default();
        assert_eq!(parse_runtime_status(closed), RuntimeStatus::default());

        let normal = RuntimeEvidence {
            codex_running: true,
            ..RuntimeEvidence::default()
        };
        let normal = parse_runtime_status(normal);
        assert!(normal.codex_running);
        assert!(!normal.skin_active);
        assert!(normal.requires_restart_confirmation);

        let active = RuntimeEvidence {
            codex_running: true,
            verification_succeeded: true,
            state_present: true,
            port: Some(9335),
            active_theme_id: Some("yingying".into()),
            active_theme_name: Some("萦萦".into()),
            ..RuntimeEvidence::default()
        };
        let active = parse_runtime_status(active);
        assert!(active.skin_active);
        assert_eq!(active.port, Some(9335));
        assert_eq!(active.active_theme_id.as_deref(), Some("yingying"));
        assert_eq!(active.active_theme_name.as_deref(), Some("萦萦"));
        assert!(!active.requires_restart_confirmation);

        let paused = RuntimeEvidence {
            codex_running: true,
            verification_succeeded: true,
            state_present: true,
            pause_marker_present: true,
            ..RuntimeEvidence::default()
        };
        assert!(parse_runtime_status(paused).paused);

        let stale = RuntimeEvidence {
            state_present: true,
            verification_error: Some("No verified endpoint".into()),
            ..RuntimeEvidence::default()
        };
        let stale = parse_runtime_status(stale);
        assert!(!stale.skin_active);
        assert_eq!(stale.last_error.as_deref(), Some("No verified endpoint"));
    }

    #[test]
    fn stale_state_without_a_running_codex_is_inactive_without_probing_cdp() {
        let root = tempdir().unwrap();
        let engine = root.path().join("engine");
        fs::create_dir_all(engine.join("scripts")).unwrap();
        let state = root.path().join("state");
        fs::create_dir_all(&state).unwrap();
        fs::write(state.join("state.json"), br#"{"port":9335}"#).unwrap();
        let runner = Arc::new(RecordingRunner::new(vec![ProcessOutput::success(
            "INFO: No tasks are running which match the specified criteria.",
        )]));
        let runtime =
            EngineRuntime::with_runner(engine, state, runner.clone(), Duration::from_secs(2));

        let status = runtime.get_runtime_status().unwrap();

        assert!(!status.codex_running);
        assert!(!status.skin_active);
        assert!(!status.requires_restart_confirmation);
        assert_eq!(status.last_error, None);
        assert_eq!(runner.calls().len(), 1);
    }

    #[test]
    fn missing_cdp_endpoint_is_an_expected_inactive_state_not_a_runtime_error() {
        let root = tempdir().unwrap();
        let engine = root.path().join("engine");
        fs::create_dir_all(engine.join("scripts")).unwrap();
        let state = root.path().join("state");
        fs::create_dir_all(&state).unwrap();
        fs::write(state.join("state.json"), br#"{"port":9335}"#).unwrap();
        let runner = Arc::new(RecordingRunner::new(vec![
            ProcessOutput::success("ChatGPT.exe,1234"),
            ProcessOutput {
                exit_code: 1,
                stdout: String::new(),
                stderr: "No verified Codex CDP endpoint is active on loopback port 9335.".into(),
            },
        ]));
        let runtime = EngineRuntime::with_runner(engine, state, runner, Duration::from_secs(2));

        let status = runtime.get_runtime_status().unwrap();

        assert!(status.codex_running);
        assert!(!status.skin_active);
        assert!(status.requires_restart_confirmation);
        assert_eq!(status.last_error, None);
    }

    #[test]
    fn every_direct_child_process_uses_the_hidden_command_boundary() {
        let source = include_str!("engine.rs");
        let raw_constructor = ["Command", "::new("].concat();

        assert!(source.contains("fn hidden_command("));
        assert_eq!(source.matches(&raw_constructor).count(), 1);
    }

    #[test]
    fn restore_result_requires_a_successful_exit_code() {
        let failed = ProcessOutput {
            exit_code: 1,
            stdout: "".into(),
            stderr: "restore failed".into(),
        };
        let error = ensure_process_success("restore", failed).unwrap_err();
        assert_eq!(error.code(), "ENGINE_COMMAND_FAILED");
    }

    #[test]
    fn paused_status_uses_session_only_verification() {
        let root = tempdir().unwrap();
        let engine = root.path().join("engine");
        fs::create_dir_all(engine.join("scripts")).unwrap();
        let state = root.path().join("state");
        fs::create_dir_all(&state).unwrap();
        fs::write(state.join("state.json"), br#"{"port":9335}"#).unwrap();
        fs::write(state.join("paused"), b"paused\r\n").unwrap();
        let runner = Arc::new(RecordingRunner::new(vec![
            ProcessOutput::success("ChatGPT.exe,1234"),
            ProcessOutput::success("session verified"),
        ]));
        let runtime = EngineRuntime::with_runner(
            engine.clone(),
            state,
            runner.clone(),
            Duration::from_secs(2),
        );

        let status = runtime.get_runtime_status().unwrap();

        assert!(status.skin_active);
        assert!(status.paused);
        let calls = runner.calls();
        assert_eq!(
            calls[1].1,
            powershell_script_arguments(
                &engine.join("scripts").join("verify-dream-skin.ps1"),
                &[
                    OsString::from("-TimeoutMilliseconds"),
                    OsString::from("1500"),
                    OsString::from("-SessionOnly")
                ]
            )
        );
    }

    #[test]
    fn runtime_status_uses_the_quick_verification_budget() {
        let root = tempdir().unwrap();
        let engine = root.path().join("engine");
        fs::create_dir_all(engine.join("scripts")).unwrap();
        let state = root.path().join("state");
        fs::create_dir_all(&state).unwrap();
        fs::write(state.join("state.json"), br#"{"port":9335}"#).unwrap();
        let runner = Arc::new(RecordingRunner::new(vec![
            ProcessOutput::success("ChatGPT.exe,1234"),
            ProcessOutput {
                exit_code: 2,
                stdout: String::new(),
                stderr:
                    "No verified Codex renderer on 127.0.0.1:9335: CDP operation deadline exceeded"
                        .into(),
            },
        ]));
        let runtime =
            EngineRuntime::with_runner(engine, state, runner.clone(), Duration::from_secs(2));

        let status = runtime.get_runtime_status().unwrap();
        assert!(status.starting);
        let calls = runner.calls();
        assert!(calls[1]
            .1
            .windows(2)
            .any(|pair| { pair[0] == "-TimeoutMilliseconds" && pair[1] == "1500" }));
    }

    #[tokio::test]
    async fn lifecycle_commands_preserve_confirmation_and_exact_arguments() {
        let root = tempdir().unwrap();
        let engine = root.path().join("engine");
        fs::create_dir_all(engine.join("scripts")).unwrap();
        let runner = Arc::new(RecordingRunner::new(vec![ProcessOutput::success(
            "ChatGPT.exe,1234",
        )]));
        let runtime = EngineRuntime::with_runner(
            engine.clone(),
            root.path().join("state"),
            runner.clone(),
            Duration::from_secs(2),
        );

        let error = runtime.start_skin(false).await.unwrap_err();
        assert_eq!(error.code(), "RESTART_CONFIRMATION_REQUIRED");
        assert_eq!(runner.calls().len(), 1);

        let state = root.path().join("state");
        fs::create_dir_all(&state).unwrap();
        fs::write(state.join("state.json"), br#"{"port":9335}"#).unwrap();
        let runner = Arc::new(RecordingRunner::new(vec![
            ProcessOutput::success("ChatGPT.exe,1234"),
            ProcessOutput {
                exit_code: 1,
                stdout: String::new(),
                stderr: "No verified Codex CDP endpoint is active on loopback port 9335.".into(),
            },
            ProcessOutput::success("started"),
            ProcessOutput::success("ChatGPT.exe,1234"),
            ProcessOutput::success("session verified"),
        ]));
        let runtime = EngineRuntime::with_runner(
            engine.clone(),
            state,
            runner.clone(),
            Duration::from_secs(2),
        );
        runtime.start_skin(true).await.unwrap();
        let calls = runner.calls();
        assert_eq!(calls[2].0, PathBuf::from("powershell.exe"));
        assert_eq!(
            calls[2].1,
            powershell_script_arguments(
                &engine.join("scripts").join("start-dream-skin.ps1"),
                &[OsString::from("-RestartExisting")]
            )
        );
    }

    #[tokio::test]
    async fn stale_watcher_starts_without_restarting_codex() {
        let root = tempdir().unwrap();
        let engine = root.path().join("engine");
        fs::create_dir_all(engine.join("scripts")).unwrap();
        let state = root.path().join("state");
        fs::create_dir_all(&state).unwrap();
        fs::write(state.join("state.json"), br#"{"port":9335}"#).unwrap();
        let runner = Arc::new(RecordingRunner::new(vec![
            ProcessOutput::success("ChatGPT.exe,1234"),
            version_mismatch_output(),
            ProcessOutput::success("started"),
            ProcessOutput::success("ChatGPT.exe,1234"),
            ProcessOutput::success("session verified"),
        ]));
        let runtime = EngineRuntime::with_runner(
            engine.clone(),
            state,
            runner.clone(),
            Duration::from_secs(2),
        );

        let status = runtime.start_skin(false).await.unwrap();

        assert!(status.skin_active);
        let calls = runner.calls();
        let start_call = calls
            .iter()
            .find(|call| {
                call.1
                    .iter()
                    .any(|argument| argument.to_string_lossy().contains("start-dream-skin.ps1"))
            })
            .unwrap();
        assert!(!start_call
            .1
            .iter()
            .any(|argument| argument.to_string_lossy() == "-RestartExisting"));
    }

    #[tokio::test]
    async fn start_timeout_reconciles_to_an_active_runtime() {
        let root = tempdir().unwrap();
        let engine = root.path().join("engine");
        fs::create_dir_all(engine.join("scripts")).unwrap();
        let state = root.path().join("state");
        fs::create_dir_all(&state).unwrap();
        fs::write(state.join("state.json"), br#"{"port":9335}"#).unwrap();
        let runner = Arc::new(RecordingRunner::new_results(vec![
            Ok(ProcessOutput::success("ChatGPT.exe,1234")),
            Ok(ProcessOutput {
                exit_code: 1,
                stdout: String::new(),
                stderr: "No verified Codex CDP endpoint is active on loopback port 9335.".into(),
            }),
            Err(StudioError::new(
                "PROCESS_TIMEOUT",
                "Engine command exceeded 120 seconds",
            )),
            Ok(ProcessOutput::success("ChatGPT.exe,1234")),
            Ok(ProcessOutput::success("session verified")),
        ]));
        let runtime = EngineRuntime::with_runner(engine, state, runner, Duration::from_secs(2));

        let status = runtime.start_skin(true).await.unwrap();

        assert!(status.skin_active);
        assert_eq!(status.last_error, None);
    }

    #[tokio::test]
    async fn start_nonzero_preserves_the_original_error_when_target_is_not_reached() {
        let root = tempdir().unwrap();
        let engine = root.path().join("engine");
        fs::create_dir_all(engine.join("scripts")).unwrap();
        let state = root.path().join("state");
        fs::create_dir_all(&state).unwrap();
        let runner = Arc::new(RecordingRunner::new(vec![
            ProcessOutput::success("ChatGPT.exe,1234"),
            ProcessOutput {
                exit_code: 7,
                stdout: String::new(),
                stderr: "start failed for a real reason".into(),
            },
        ]));
        let runtime =
            EngineRuntime::with_runner(engine, state, runner.clone(), Duration::from_secs(2));

        let error = runtime.start_skin(true).await.unwrap_err();

        assert_eq!(error.code(), "ENGINE_COMMAND_FAILED");
        assert_eq!(
            error.detail.as_deref(),
            Some("start failed for a real reason")
        );
        assert_eq!(runner.calls().len(), 2);
    }

    #[tokio::test]
    async fn start_non_timeout_runner_errors_do_not_probe_runtime() {
        for code in [
            "IO",
            "RUNTIME_TARGET_NOT_REACHED",
            "PROCESS_TIMEOUT_CLEANUP_FAILED",
        ] {
            let root = tempdir().unwrap();
            let engine = root.path().join("engine");
            fs::create_dir_all(engine.join("scripts")).unwrap();
            let state = root.path().join("state");
            fs::create_dir_all(&state).unwrap();
            let runner = Arc::new(RecordingRunner::new_results(vec![
                Ok(ProcessOutput::success("ChatGPT.exe,1234")),
                Err(StudioError::new(code, "original transition failure")),
            ]));
            let runtime =
                EngineRuntime::with_runner(engine, state, runner.clone(), Duration::from_secs(2));

            let error = runtime.start_skin(true).await.unwrap_err();

            assert_eq!(error.code(), code);
            assert_eq!(runner.calls().len(), 2, "{code} triggered a status probe");
        }
    }

    #[tokio::test]
    async fn restore_non_timeout_runner_errors_do_not_probe_runtime() {
        for code in ["IO", "PROCESS_TIMEOUT_CLEANUP_FAILED"] {
            let root = tempdir().unwrap();
            let engine = root.path().join("engine");
            fs::create_dir_all(engine.join("scripts")).unwrap();
            let state = root.path().join("state");
            fs::create_dir_all(&state).unwrap();
            let runner = Arc::new(RecordingRunner::new_results(vec![
                Ok(ProcessOutput::success("ChatGPT.exe,1234")),
                Err(StudioError::new(code, "original transition failure")),
            ]));
            let runtime =
                EngineRuntime::with_runner(engine, state, runner.clone(), Duration::from_secs(2));

            let error = runtime.restore_official_appearance(true).await.unwrap_err();

            assert_eq!(error.code(), code);
            assert_eq!(runner.calls().len(), 2, "{code} triggered a status probe");
        }
    }

    #[tokio::test]
    async fn successful_start_requires_the_requested_runtime_target() {
        let root = tempdir().unwrap();
        let engine = root.path().join("engine");
        fs::create_dir_all(engine.join("scripts")).unwrap();
        let state = root.path().join("state");
        fs::create_dir_all(&state).unwrap();
        let runner = Arc::new(RecordingRunner::new(vec![
            ProcessOutput::success("ChatGPT.exe,1234"),
            ProcessOutput::success("started"),
            ProcessOutput::success("ChatGPT.exe,1234"),
        ]));
        let runtime = EngineRuntime::with_runner(engine, state, runner, Duration::from_secs(2));

        let error = runtime.start_skin(true).await.unwrap_err();

        assert_eq!(error.code(), "RUNTIME_TARGET_NOT_REACHED");
    }

    #[tokio::test]
    async fn official_restore_runs_when_no_runtime_or_config_artifacts_remain() {
        let root = tempdir().unwrap();
        let engine = root.path().join("engine");
        fs::create_dir_all(engine.join("scripts")).unwrap();
        let state = root.path().join("state");
        fs::create_dir_all(&state).unwrap();
        let runner = Arc::new(RecordingRunner::new(vec![
            ProcessOutput::success("ChatGPT.exe,1234"),
            ProcessOutput::success("restored"),
            ProcessOutput::success("ChatGPT.exe,1234"),
        ]));
        let runtime = EngineRuntime::with_runner(
            engine.clone(),
            state,
            runner.clone(),
            Duration::from_secs(2),
        );

        let status = runtime.restore_official_appearance(true).await.unwrap();

        assert!(status.codex_running);
        assert!(!status.skin_active);
        assert!(!status.starting);
        assert!(runner.calls().iter().any(|call| {
            call.0 == Path::new("powershell.exe")
                && call.1
                    == powershell_script_arguments(
                        &engine.join("scripts").join("restore-dream-skin.ps1"),
                        &[
                            OsString::from("-RestoreBaseTheme"),
                            OsString::from("-ForceRestart"),
                        ],
                    )
        }));
    }

    #[tokio::test]
    async fn official_restore_runs_when_the_active_config_backup_remains() {
        let root = tempdir().unwrap();
        let engine = root.path().join("engine");
        fs::create_dir_all(engine.join("scripts")).unwrap();
        let state = root.path().join("state");
        fs::create_dir_all(&state).unwrap();
        fs::write(
            state.join("config.before-dream-skin.toml"),
            b"model = 'test'\r\n",
        )
        .unwrap();
        let runner = Arc::new(RecordingRunner::new(vec![
            ProcessOutput::success("ChatGPT.exe,1234"),
            ProcessOutput::success("restored"),
            ProcessOutput::success("ChatGPT.exe,1234"),
        ]));
        let runtime = EngineRuntime::with_runner(
            engine.clone(),
            state,
            runner.clone(),
            Duration::from_secs(2),
        );

        let status = runtime.restore_official_appearance(true).await.unwrap();

        assert!(status.codex_running);
        assert!(!status.skin_active);
        assert!(!status.starting);
        assert!(runner.calls().iter().any(|call| {
            call.0 == Path::new("powershell.exe")
                && call.1
                    == powershell_script_arguments(
                        &engine.join("scripts").join("restore-dream-skin.ps1"),
                        &[
                            OsString::from("-RestoreBaseTheme"),
                            OsString::from("-ForceRestart"),
                        ],
                    )
        }));
    }

    #[tokio::test]
    async fn restore_timeout_reconciles_when_state_is_absent_and_runtime_is_official() {
        let root = tempdir().unwrap();
        let engine = root.path().join("engine");
        fs::create_dir_all(engine.join("scripts")).unwrap();
        let state = root.path().join("state");
        fs::create_dir_all(&state).unwrap();
        let runner = Arc::new(RecordingRunner::new_results(vec![
            Ok(ProcessOutput::success("ChatGPT.exe,1234")),
            Err(StudioError::new(
                "PROCESS_TIMEOUT",
                "Engine command exceeded 120 seconds",
            )),
            Ok(ProcessOutput::success("ChatGPT.exe,1234")),
        ]));
        let runtime = EngineRuntime::with_runner(engine, state, runner, Duration::from_secs(2));

        let status = runtime.restore_official_appearance(true).await.unwrap();

        assert!(status.codex_running);
        assert!(!status.skin_active);
        assert!(!status.starting);
    }

    #[tokio::test]
    async fn restore_timeout_is_preserved_while_state_file_remains() {
        let root = tempdir().unwrap();
        let engine = root.path().join("engine");
        fs::create_dir_all(engine.join("scripts")).unwrap();
        let state = root.path().join("state");
        fs::create_dir_all(&state).unwrap();
        fs::write(state.join("state.json"), br#"{"port":9335}"#).unwrap();
        let inactive = ProcessOutput {
            exit_code: 1,
            stdout: String::new(),
            stderr: "No verified Codex CDP endpoint is active on loopback port 9335.".into(),
        };
        let runner = Arc::new(RecordingRunner::new_results(vec![
            Ok(ProcessOutput::success("ChatGPT.exe,1234")),
            Ok(inactive.clone()),
            Err(StudioError::new(
                "PROCESS_TIMEOUT",
                "Engine command exceeded 120 seconds",
            )),
            Ok(ProcessOutput::success("ChatGPT.exe,1234")),
            Ok(inactive),
        ]));
        let runtime = EngineRuntime::with_runner(engine, state, runner, Duration::from_secs(2));

        let error = runtime.restore_official_appearance(true).await.unwrap_err();

        assert_eq!(error.code(), "PROCESS_TIMEOUT");
    }

    #[tokio::test]
    async fn successful_restore_requires_state_file_removal() {
        let root = tempdir().unwrap();
        let engine = root.path().join("engine");
        fs::create_dir_all(engine.join("scripts")).unwrap();
        let state = root.path().join("state");
        fs::create_dir_all(&state).unwrap();
        fs::write(state.join("state.json"), br#"{"port":9335}"#).unwrap();
        let inactive = ProcessOutput {
            exit_code: 1,
            stdout: String::new(),
            stderr: "No verified Codex CDP endpoint is active on loopback port 9335.".into(),
        };
        let runner = Arc::new(RecordingRunner::new(vec![
            ProcessOutput::success("ChatGPT.exe,1234"),
            inactive.clone(),
            ProcessOutput::success("restored"),
            ProcessOutput::success("ChatGPT.exe,1234"),
            inactive,
        ]));
        let runtime = EngineRuntime::with_runner(engine, state, runner, Duration::from_secs(2));

        let error = runtime.restore_official_appearance(true).await.unwrap_err();

        assert_eq!(error.code(), "RUNTIME_TARGET_NOT_REACHED");
    }

    #[tokio::test]
    async fn stop_timeout_reconciles_to_an_official_closed_runtime() {
        let root = tempdir().unwrap();
        let engine = root.path().join("engine");
        fs::create_dir_all(engine.join("scripts")).unwrap();
        let state = root.path().join("state");
        fs::create_dir_all(&state).unwrap();
        let runner = Arc::new(RecordingRunner::new_results(vec![
            Ok(ProcessOutput::success("INFO: No tasks are running")),
            Err(StudioError::new(
                "PROCESS_TIMEOUT",
                "Engine command exceeded 120 seconds",
            )),
            Ok(ProcessOutput::success("INFO: No tasks are running")),
        ]));
        let runtime = EngineRuntime::with_runner(engine, state, runner, Duration::from_secs(2));

        let status = runtime.stop_skin().await.unwrap();

        assert!(!status.codex_running);
        assert!(!status.skin_active);
        assert!(!status.starting);
    }

    #[tokio::test]
    async fn restore_nonzero_preserves_the_original_error_when_skin_remains_active() {
        let root = tempdir().unwrap();
        let engine = root.path().join("engine");
        fs::create_dir_all(engine.join("scripts")).unwrap();
        let state = root.path().join("state");
        fs::create_dir_all(&state).unwrap();
        fs::write(state.join("state.json"), br#"{"port":9335}"#).unwrap();
        let runner = Arc::new(RecordingRunner::new(vec![
            ProcessOutput::success("ChatGPT.exe,1234"),
            ProcessOutput::success("session verified"),
            ProcessOutput {
                exit_code: 9,
                stdout: String::new(),
                stderr: "restore failed for a real reason".into(),
            },
            ProcessOutput::success("ChatGPT.exe,1234"),
            ProcessOutput::success("session verified"),
        ]));
        let runtime = EngineRuntime::with_runner(engine, state, runner, Duration::from_secs(2));

        let error = runtime.restore_official_appearance(true).await.unwrap_err();

        assert_eq!(error.code(), "ENGINE_COMMAND_FAILED");
        assert_eq!(
            error.detail.as_deref(),
            Some("restore failed for a real reason")
        );
    }

    #[tokio::test]
    async fn resuming_a_paused_skin_restarts_and_verifies_the_watcher_transactionally() {
        let root = tempdir().unwrap();
        let engine = root.path().join("engine");
        fs::create_dir_all(engine.join("scripts")).unwrap();
        let state = root.path().join("state");
        fs::create_dir_all(state.join("active-theme")).unwrap();
        fs::write(state.join("state.json"), br#"{"port":9335}"#).unwrap();
        fs::write(state.join("paused"), b"paused\r\n").unwrap();
        write_fresh_watcher_heartbeat(&state);
        fs::write(
            state.join("active-theme").join("theme.json"),
            br#"{"id":"yingying","name":"Yingying"}"#,
        )
        .unwrap();
        let runner = Arc::new(RecordingRunner::new(vec![
            ProcessOutput::success("ChatGPT.exe,1234"),
            ProcessOutput::success("session verified"),
            ProcessOutput::success("watcher restarted"),
            ProcessOutput::success("ChatGPT.exe,1234"),
            ProcessOutput::success("skin verified"),
        ]));
        let runtime = EngineRuntime::with_runner(
            engine.clone(),
            state.clone(),
            runner.clone(),
            Duration::from_secs(2),
        );

        let status = runtime.resume_skin().await.unwrap();

        assert!(status.skin_active);
        assert!(!status.paused);
        assert_eq!(status.active_theme_id.as_deref(), Some("yingying"));
        assert!(!state.join("paused").exists());
        let calls = runner.calls();
        assert_eq!(
            calls[2].1,
            powershell_script_arguments(&engine.join("scripts").join("start-dream-skin.ps1"), &[])
        );
    }

    #[tokio::test]
    async fn pause_resume_stop_and_restore_have_distinct_effects() {
        let root = tempdir().unwrap();
        let engine = root.path().join("engine");
        fs::create_dir_all(engine.join("scripts")).unwrap();
        let state = root.path().join("state");
        fs::create_dir_all(&state).unwrap();
        let runner = Arc::new(RecordingRunner::new(vec![
            ProcessOutput::success("INFO: No tasks are running"),
            ProcessOutput::success("INFO: No tasks are running"),
            ProcessOutput::success("INFO: No tasks are running"),
            ProcessOutput::success("INFO: No tasks are running"),
            ProcessOutput::success("stopped"),
            ProcessOutput::success("INFO: No tasks are running"),
            ProcessOutput::success("INFO: No tasks are running"),
            ProcessOutput::success("restored"),
            ProcessOutput::success("INFO: No tasks are running"),
        ]));
        let runtime = EngineRuntime::with_runner(
            engine.clone(),
            state.clone(),
            runner.clone(),
            Duration::from_secs(2),
        );

        runtime.pause_skin().await.unwrap();
        assert!(state.join("paused").is_file());
        runtime.resume_skin().await.unwrap();
        assert!(!state.join("paused").exists());

        runtime.stop_skin().await.unwrap();
        let denied = runtime
            .restore_official_appearance(false)
            .await
            .unwrap_err();
        assert_eq!(denied.code(), "RESTORE_CONFIRMATION_REQUIRED");
        runtime.restore_official_appearance(true).await.unwrap();

        let calls: Vec<_> = runner
            .calls()
            .into_iter()
            .filter(|call| call.0 == Path::new("powershell.exe"))
            .collect();
        assert_eq!(
            calls[0].1,
            powershell_script_arguments(
                &engine.join("scripts").join("restore-dream-skin.ps1"),
                &[OsString::from("-ForceRestart")]
            )
        );
        assert_eq!(
            calls[1].1,
            powershell_script_arguments(
                &engine.join("scripts").join("restore-dream-skin.ps1"),
                &[
                    OsString::from("-RestoreBaseTheme"),
                    OsString::from("-ForceRestart")
                ]
            )
        );
    }

    #[tokio::test]
    async fn pausing_an_already_paused_runtime_is_idempotent() {
        let root = tempdir().unwrap();
        let state = root.path().join("state");
        fs::create_dir_all(&state).unwrap();
        let runner = Arc::new(RecordingRunner::new(vec![
            ProcessOutput::success("INFO: No tasks are running"),
            ProcessOutput::success("INFO: No tasks are running"),
            ProcessOutput::success("INFO: No tasks are running"),
            ProcessOutput::success("INFO: No tasks are running"),
        ]));
        let runtime = EngineRuntime::with_runner(
            root.path().join("engine"),
            state,
            runner,
            Duration::from_secs(2),
        );

        runtime.pause_skin().await.unwrap();
        runtime.pause_skin().await.unwrap();
    }

    #[test]
    #[ignore = "read-only diagnostic against the locally installed Codex session"]
    fn real_environment_and_runtime_status_are_read_only() {
        let local_data = dirs::data_local_dir().unwrap();
        let state_root = local_data.join("CodexDreamSkin");
        let runtime = EngineRuntime::new(state_root.join("engine"), state_root);
        println!("environment={:?}", EngineService::environment_status());
        println!("runtime={:?}", runtime.get_runtime_status().unwrap());
    }

    struct HeartbeatRecoveryRunner {
        state_root: PathBuf,
        recoveries: AtomicUsize,
    }

    impl HeartbeatRecoveryRunner {
        fn new(state_root: PathBuf) -> Self {
            Self {
                state_root,
                recoveries: AtomicUsize::new(0),
            }
        }
    }

    impl ProcessRunner for HeartbeatRecoveryRunner {
        fn run(
            &self,
            program: &Path,
            arguments: &[OsString],
            _timeout: Duration,
        ) -> StudioResult<ProcessOutput> {
            if program == Path::new("tasklist.exe") {
                return Ok(ProcessOutput::success("ChatGPT.exe,1234"));
            }
            if arguments.contains(&OsString::from("-RecoverWatcherOnly")) {
                thread::sleep(Duration::from_millis(50));
                let now_ms = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_millis() as u64;
                fs::write(
                    self.state_root.join("watcher-heartbeat.json"),
                    format!(r#"{{"processId":77,"updatedAt":{now_ms}}}"#),
                )
                .unwrap();
                self.recoveries.fetch_add(1, Ordering::SeqCst);
                return Ok(ProcessOutput::success("watcher recovered"));
            }
            if arguments
                .iter()
                .any(|argument| argument.to_string_lossy().contains("verify-dream-skin.ps1"))
            {
                if self.recoveries.load(Ordering::SeqCst) == 0 {
                    return Ok(ProcessOutput {
                        exit_code: 1,
                        stdout: String::new(),
                        stderr: "No verified Codex CDP endpoint is active on loopback port 9335."
                            .into(),
                    });
                }
                return Ok(ProcessOutput::success("skin verified"));
            }
            Err(StudioError::new(
                "UNEXPECTED_FAKE_COMMAND",
                "Unexpected fake process invocation",
            ))
        }
    }

    struct RecordingRunner {
        outputs: Mutex<VecDeque<StudioResult<ProcessOutput>>>,
        calls: Mutex<Vec<(PathBuf, Vec<OsString>, Duration)>>,
    }

    impl RecordingRunner {
        fn new(outputs: Vec<ProcessOutput>) -> Self {
            Self::new_results(outputs.into_iter().map(Ok).collect())
        }

        fn new_results(outputs: Vec<StudioResult<ProcessOutput>>) -> Self {
            Self {
                outputs: Mutex::new(outputs.into()),
                calls: Mutex::new(Vec::new()),
            }
        }

        fn calls(&self) -> Vec<(PathBuf, Vec<OsString>, Duration)> {
            self.calls.lock().unwrap().clone()
        }
    }

    impl ProcessRunner for RecordingRunner {
        fn run(
            &self,
            program: &Path,
            arguments: &[OsString],
            timeout: Duration,
        ) -> StudioResult<ProcessOutput> {
            self.calls
                .lock()
                .unwrap()
                .push((program.to_path_buf(), arguments.to_vec(), timeout));
            self.outputs.lock().unwrap().pop_front().unwrap_or_else(|| {
                Err(StudioError::new(
                    "FAKE_OUTPUT_MISSING",
                    "No fake process output remains",
                ))
            })
        }
    }
}
