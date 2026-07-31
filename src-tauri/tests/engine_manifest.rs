use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    net::TcpListener,
    path::PathBuf,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

#[derive(Debug, Deserialize)]
struct EngineSourceManifest {
    repository: String,
    commit: String,
    files: Vec<EngineSourceFile>,
}

#[derive(Debug, Deserialize)]
struct EngineSourceFile {
    path: String,
    sha256: String,
}

#[test]
fn engine_manifest_matches_every_bundled_resource() {
    let engine_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("dream-skin-engine");
    let manifest_path = engine_root.join("ENGINE-SOURCE.json");
    let manifest_bytes = fs::read(&manifest_path).expect("bundled engine manifest must exist");
    let manifest: EngineSourceManifest =
        serde_json::from_slice(&manifest_bytes).expect("engine manifest must be valid JSON");

    assert_eq!(
        manifest.repository,
        "https://github.com/Fei-Away/Codex-Dream-Skin"
    );
    assert_eq!(manifest.commit, "3af1d6d62f3a0388cc640d2f497ac3100998938e");
    assert_eq!(manifest.files.len(), 17);
    assert!(
        manifest
            .files
            .iter()
            .all(|entry| !entry.path.starts_with("tests/")),
        "engine test fixtures must not be included in the installed runtime"
    );

    for removed in [
        "assets/codex-region-contract.json",
        "assets/region-contract.js",
    ] {
        assert!(
            manifest.files.iter().all(|entry| entry.path != removed),
            "removed resource retained in manifest: {removed}"
        );
        assert!(
            !engine_root.join(removed).exists(),
            "removed resource retained in bundle: {removed}"
        );
    }

    for entry in manifest.files {
        let resource = engine_root.join(&entry.path);
        let bytes = fs::read(&resource)
            .unwrap_or_else(|error| panic!("missing declared resource {}: {error}", entry.path));
        let actual = format!("{:x}", Sha256::digest(&bytes));
        assert_eq!(actual, entry.sha256, "hash mismatch for {}", entry.path);
    }
}

#[test]
fn packaged_private_node_has_verified_source_and_license() {
    let runtime =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/dream-skin-engine/runtime");
    assert!(runtime.join("node.exe").is_file());
    assert!(runtime.join("LICENSE").is_file());
    let source: serde_json::Value =
        serde_json::from_slice(&fs::read(runtime.join("NODE-SOURCE.json")).unwrap()).unwrap();
    assert_eq!(source["version"], "24.18.0");
    assert_eq!(source["platform"], "win");
    assert_eq!(source["arch"], "x64");
    assert_eq!(source["archiveSha256"].as_str().unwrap().len(), 64);
    assert_eq!(source["nodeExeSha256"].as_str().unwrap().len(), 64);
    let actual_node_hash = format!(
        "{:X}",
        Sha256::digest(fs::read(runtime.join("node.exe")).unwrap())
    );
    assert_eq!(source["nodeExeSha256"], actual_node_hash);
}

#[test]
fn standalone_installer_copies_the_private_runtime_and_engine_manifest() {
    let common_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources/dream-skin-engine/scripts/common-windows.ps1");
    let script = fs::read_to_string(&common_path)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", common_path.display()));

    for required in [
        "ENGINE-SOURCE.json",
        r"runtime\node.exe",
        r"runtime\LICENSE",
        r"runtime\NODE-SOURCE.json",
    ] {
        assert!(
            script.contains(required),
            "standalone runtime installer omits {required}"
        );
    }
    assert!(script.contains("@('assets', 'runtime', 'scripts')"));
}

#[test]
fn recorded_injector_identity_calls_supply_process_evidence() {
    let scripts_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("dream-skin-engine")
        .join("scripts");

    for script_name in ["common-windows.ps1", "verify-dream-skin.ps1"] {
        let script = fs::read_to_string(scripts_root.join(script_name))
            .unwrap_or_else(|error| panic!("failed to read {script_name}: {error}"));
        for (index, line) in script.lines().enumerate() {
            if line.contains("Test-DreamSkinRecordedInjectorIdentity")
                && !line.trim_start().starts_with("function ")
            {
                assert!(
                    line.contains("-Process"),
                    "{script_name}:{} omits required process evidence: {line}",
                    index + 1
                );
            }
        }
    }
}

#[test]
fn verification_exposes_separate_quick_and_startup_budgets() {
    let scripts = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("dream-skin-engine")
        .join("scripts");
    let verify = fs::read_to_string(scripts.join("verify-dream-skin.ps1")).unwrap();
    let start = fs::read_to_string(scripts.join("start-dream-skin.ps1")).unwrap();
    let mut violations = Vec::new();

    if !verify.contains("[ValidateRange(250, 120000)]")
        || !verify.contains("[int]$TimeoutMilliseconds = 30000")
    {
        violations
            .push("verify-dream-skin.ps1 must expose a validated TimeoutMilliseconds parameter");
    }
    if !verify.contains("'--timeout-ms', \"$TimeoutMilliseconds\"") {
        violations.push("verify-dream-skin.ps1 must pass TimeoutMilliseconds to Node");
    }
    if !start.contains("'--timeout-ms', '6000'") {
        violations.push(
            "start-dream-skin.ps1 must use a 6000 ms initial verify budget instead of 30000 ms",
        );
    }

    assert!(
        violations.is_empty(),
        "verification budget contract violations:\n{}",
        violations.join("\n")
    );
}

#[test]
fn restore_can_reuse_the_latest_completed_config_backup() {
    let restore_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("dream-skin-engine")
        .join("scripts")
        .join("restore-dream-skin.ps1");
    let script = fs::read_to_string(&restore_path)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", restore_path.display()));

    assert!(script.contains("config.restored-*.toml"));
    assert!(script.contains("$restoreBackupPath"));
    assert!(script.contains("Using archived pre-install config backup"));
}

#[test]
fn restore_waits_for_delayed_cdp_port_release_without_a_fixed_sleep() {
    let scripts = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("dream-skin-engine")
        .join("scripts");
    let restore_path = scripts.join("restore-dream-skin.ps1");
    let restore = fs::read_to_string(&restore_path)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", restore_path.display()));

    assert!(
        restore.contains(
            "if ($portOwnedByCodex -and -not (Wait-DreamSkinPortAvailable -Port $Port -TimeoutSeconds 15))"
        ),
        "restore must keep the verified-owner guard and allow Windows up to 15 seconds to release Codex's CDP listener"
    );
    assert!(
        !restore.contains("Start-Sleep"),
        "restore must rely on condition polling instead of a fixed sleep"
    );
    assert!(
        restore.contains(
            "Port $Port did not become available within 15 seconds after Codex closed; state and configuration were preserved."
        ),
        "restore timeout must describe the bounded wait and preservation behavior accurately"
    );

    let listener = TcpListener::bind("127.0.0.1:0").expect("test listener must bind");
    let port = listener.local_addr().unwrap().port();
    let handshake = tempfile::tempdir().expect("handshake directory must exist");
    let ready_path = handshake.path().join("wait-ready");
    let common = scripts.join("common-windows.ps1");
    let escaped_common = common.display().to_string().replace('\'', "''");
    let escaped_ready = ready_path.display().to_string().replace('\'', "''");
    let command = format!(
        concat!(
        "$ErrorActionPreference = 'Stop'; . '{escaped_common}'; ",
        "$timer = [System.Diagnostics.Stopwatch]::StartNew(); ",
        "[System.IO.File]::WriteAllText('{escaped_ready}', 'ready'); ",
        "$released = Wait-DreamSkinPortAvailable -Port {port} -TimeoutSeconds 15; ",
        "$timer.Stop(); [pscustomobject]@{{ released = $released; elapsedMs = $timer.ElapsedMilliseconds }} | ConvertTo-Json -Compress"
        ),
        escaped_common = escaped_common,
        escaped_ready = escaped_ready,
        port = port,
    );
    let mut child = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &command,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("PowerShell port-release probe must start");
    let handshake_deadline = Instant::now() + Duration::from_secs(15);
    while !ready_path.exists() {
        if child
            .try_wait()
            .expect("PowerShell probe status must be readable")
            .is_some()
        {
            let output = child
                .wait_with_output()
                .expect("finished PowerShell output must be readable");
            panic!(
                "PowerShell probe exited before entering the wait: {}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
        }
        if Instant::now() >= handshake_deadline {
            let _ = child.kill();
            let output = child
                .wait_with_output()
                .expect("timed-out PowerShell output must be readable");
            panic!(
                "PowerShell probe did not enter the wait: {}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
        }
        thread::sleep(Duration::from_millis(25));
    }

    thread::sleep(Duration::from_millis(1_200));
    drop(listener);
    let output = child
        .wait_with_output()
        .expect("PowerShell port-release probe must finish");

    assert!(
        output.status.success(),
        "PowerShell port-release probe failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let result: serde_json::Value = serde_json::from_slice(&output.stdout)
        .unwrap_or_else(|error| panic!("invalid probe output: {error}: {:?}", output.stdout));
    assert_eq!(result["released"], true);
    assert!(
        result["elapsedMs"].as_u64().unwrap() >= 1_000,
        "the listener was released before PowerShell entered the condition wait: {result}"
    );
    assert!(
        result["elapsedMs"].as_u64().unwrap() < 14_000,
        "condition polling waited close to the full timeout: {result}"
    );
}
