use codex_dream_skin_studio_lib::services::engine::{
    resolve_node_runtime, EngineDirectoryCleanup, EngineService, EnvironmentProbe,
    LegacyProcessControl, NodeCandidateValidation, NodeCandidateValidator, NodeRuntimeSource,
    ProcessSnapshot,
};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    fs, io,
    path::{Path, PathBuf},
};
use tempfile::tempdir;

fn write_engine(root: &Path, files: &[(&str, &[u8])]) {
    let entries = files
        .iter()
        .map(|(path, bytes)| {
            let destination = root.join(path);
            fs::create_dir_all(destination.parent().unwrap()).unwrap();
            fs::write(&destination, bytes).unwrap();
            json!({ "path": path, "sha256": format!("{:x}", Sha256::digest(bytes)) })
        })
        .collect::<Vec<_>>();
    fs::write(
        root.join("ENGINE-SOURCE.json"),
        serde_json::to_vec_pretty(&json!({
            "repository": "https://example.invalid/engine",
            "commit": "test-commit",
            "files": entries
        }))
        .unwrap(),
    )
    .unwrap();
}

#[test]
fn engine_synchronization_replaces_only_the_managed_engine_directory() {
    let temp = tempdir().unwrap();
    let resource_root = temp.path().join("resources");
    let dream_skin_root = temp.path().join("CodexDreamSkin");
    let managed_engine = dream_skin_root.join("engine");
    write_engine(
        &resource_root,
        &[
            ("assets/theme.json", b"new-theme"),
            ("scripts/injector.mjs", b"new-injector"),
        ],
    );
    fs::create_dir_all(&managed_engine).unwrap();
    fs::write(managed_engine.join("stale.txt"), b"stale").unwrap();
    fs::create_dir_all(dream_skin_root.join("themes/yingying")).unwrap();
    fs::write(
        dream_skin_root.join("themes/yingying/theme.json"),
        b"user-theme",
    )
    .unwrap();

    let report = EngineService::synchronize(&resource_root, &managed_engine).unwrap();

    assert!(report.installed);
    assert_eq!(report.file_count, 2);
    assert_eq!(
        fs::read(managed_engine.join("assets/theme.json")).unwrap(),
        b"new-theme"
    );
    assert!(!managed_engine.join("stale.txt").exists());
    assert_eq!(
        fs::read(dream_skin_root.join("themes/yingying/theme.json")).unwrap(),
        b"user-theme"
    );
}

#[test]
fn identical_verified_engine_is_left_in_place() {
    let temp = tempdir().unwrap();
    let resource_root = temp.path().join("resources");
    let managed_engine = temp.path().join("CodexDreamSkin/engine");
    let files = [
        ("runtime/node.exe", b"same-node".as_slice()),
        ("scripts/injector.mjs", b"same-injector".as_slice()),
    ];
    write_engine(&resource_root, &files);
    write_engine(&managed_engine, &files);
    fs::write(managed_engine.join("identity.marker"), b"do-not-replace").unwrap();

    let report = EngineService::synchronize(&resource_root, &managed_engine).unwrap();

    assert!(!report.installed);
    assert_eq!(report.file_count, 2);
    assert_eq!(
        fs::read(managed_engine.join("identity.marker")).unwrap(),
        b"do-not-replace"
    );
}

#[derive(Default)]
struct ControlledCleanup {
    fail: Cell<bool>,
    attempted: RefCell<Vec<PathBuf>>,
}

impl EngineDirectoryCleanup for ControlledCleanup {
    fn remove_dir_all(&self, path: &Path) -> io::Result<()> {
        self.attempted.borrow_mut().push(path.to_path_buf());
        if self.fail.get() {
            Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "simulated locked watcher runtime",
            ))
        } else {
            fs::remove_dir_all(path)
        }
    }
}

#[test]
fn activated_update_survives_locked_backup_and_cleans_it_on_the_next_sync() {
    let temp = tempdir().unwrap();
    let parent = temp.path().join("CodexDreamSkin");
    let resource_root = temp.path().join("resources");
    let managed_engine = parent.join("engine");
    write_engine(&resource_root, &[("scripts/injector.mjs", b"new-injector")]);
    write_engine(
        &managed_engine,
        &[("scripts/injector.mjs", b"old-injector")],
    );
    let unrelated = parent.join("user-data");
    let nested_backup = unrelated.join(".engine-backup-nested");
    fs::create_dir_all(&nested_backup).unwrap();
    fs::write(nested_backup.join("keep.txt"), b"keep").unwrap();
    let stale_stage = parent.join(".engine-stage-stale");
    fs::create_dir_all(&stale_stage).unwrap();
    fs::write(stale_stage.join("partial.txt"), b"partial").unwrap();
    let cleanup = ControlledCleanup::default();
    cleanup.fail.set(true);

    let report =
        EngineService::synchronize_with_cleanup(&resource_root, &managed_engine, &cleanup).unwrap();

    assert!(report.installed);
    assert_eq!(
        fs::read(managed_engine.join("scripts/injector.mjs")).unwrap(),
        b"new-injector"
    );
    let locked_backups = fs::read_dir(&parent)
        .unwrap()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with(".engine-backup-"))
        })
        .collect::<Vec<_>>();
    assert_eq!(locked_backups.len(), 1);
    assert!(locked_backups[0].is_dir());

    cleanup.fail.set(false);
    let next =
        EngineService::synchronize_with_cleanup(&resource_root, &managed_engine, &cleanup).unwrap();

    assert!(!next.installed);
    assert!(!locked_backups[0].exists());
    assert!(!stale_stage.exists());
    assert!(nested_backup.join("keep.txt").is_file());
}

#[test]
fn failed_engine_verification_preserves_the_previous_installation() {
    let temp = tempdir().unwrap();
    let resource_root = temp.path().join("resources");
    let managed_engine = temp.path().join("CodexDreamSkin/engine");
    write_engine(&resource_root, &[("scripts/injector.mjs", b"expected")]);
    fs::write(resource_root.join("scripts/injector.mjs"), b"tampered").unwrap();
    fs::create_dir_all(&managed_engine).unwrap();
    fs::write(managed_engine.join("current.txt"), b"keep-me").unwrap();

    let error = EngineService::synchronize(&resource_root, &managed_engine).unwrap_err();

    assert_eq!(error.code(), "ENGINE_HASH_MISMATCH");
    assert_eq!(
        fs::read(managed_engine.join("current.txt")).unwrap(),
        b"keep-me"
    );
}

struct FakeEnvironment {
    windows: Option<String>,
    node_candidates: Vec<PathBuf>,
    codex: Option<String>,
}

impl EnvironmentProbe for FakeEnvironment {
    fn windows_version(&self) -> Option<String> {
        self.windows.clone()
    }

    fn node_candidates(&self) -> Vec<PathBuf> {
        self.node_candidates.clone()
    }

    fn official_codex_version(&self) -> Option<String> {
        self.codex.clone()
    }
}

struct FakeNodeValidator {
    versions: HashMap<PathBuf, String>,
}

impl<const N: usize> From<[(PathBuf, &'static str); N]> for FakeNodeValidator {
    fn from(entries: [(PathBuf, &'static str); N]) -> Self {
        Self {
            versions: entries
                .into_iter()
                .map(|(path, version)| (path, version.to_string()))
                .collect(),
        }
    }
}

impl NodeCandidateValidator for FakeNodeValidator {
    fn validate(&self, path: &Path) -> NodeCandidateValidation {
        let Some(version) = self.versions.get(path).cloned() else {
            return NodeCandidateValidation::Invalid;
        };
        let runtime = (path.to_path_buf(), version.clone());
        match version
            .trim_start_matches(['v', 'V'])
            .split('.')
            .next()
            .and_then(|major| major.parse::<u32>().ok())
        {
            Some(major) if major >= 22 => NodeCandidateValidation::Valid(runtime.0, runtime.1),
            Some(_) => NodeCandidateValidation::Unsupported(runtime.0, runtime.1),
            None => NodeCandidateValidation::Invalid,
        }
    }
}

#[test]
fn private_node_is_preferred_over_a_valid_external_node() {
    let root = tempdir().unwrap();
    let bundled = root.path().join("runtime").join("node.exe");
    std::fs::create_dir_all(bundled.parent().unwrap()).unwrap();
    std::fs::write(&bundled, b"fixture").unwrap();
    let external = PathBuf::from(r"C:\Program Files\nodejs\node.exe");
    let probe = FakeEnvironment {
        windows: Some("Windows 11 24H2".into()),
        node_candidates: vec![external.clone()],
        codex: Some("26.715.4045.0".into()),
    };
    let validator = FakeNodeValidator::from([(bundled.clone(), "24.18.0"), (external, "24.18.0")]);

    let selected = resolve_node_runtime(root.path(), &probe, &validator).unwrap();
    assert_eq!(selected.path, bundled);
    assert_eq!(selected.version, "24.18.0");
    assert_eq!(selected.source, NodeRuntimeSource::Bundled);
}

#[test]
fn external_node_24_is_used_when_private_runtime_is_invalid() {
    let root = tempdir().unwrap();
    let external = PathBuf::from(r"C:\tools\node-v24.18.0\node.exe");
    let probe = FakeEnvironment {
        windows: Some("Windows 11 24H2".into()),
        node_candidates: vec![external.clone()],
        codex: Some("26.715.4045.0".into()),
    };
    let validator = FakeNodeValidator::from([(external.clone(), "24.18.0")]);

    let selected = resolve_node_runtime(root.path(), &probe, &validator).unwrap();
    assert_eq!(selected.path, external);
    assert_eq!(selected.source, NodeRuntimeSource::External);
}

#[test]
fn environment_is_ready_without_external_path_when_private_node_is_valid() {
    let temp = tempdir().unwrap();
    let engine = temp.path().join("engine");
    write_engine(&engine, &[("runtime/node.exe", b"fixture")]);
    let private_node = engine.join("runtime/node.exe");
    let probe = FakeEnvironment {
        windows: Some("Windows 11 24H2".into()),
        node_candidates: Vec::new(),
        codex: Some("26.715.4045.0".into()),
    };
    let validator = FakeNodeValidator::from([(private_node, "24.18.0")]);

    let status = EngineService::environment_status_with(&probe, &validator, &engine);
    assert!(status.skin_runtime_ready);
    assert_eq!(status.node_source, Some(NodeRuntimeSource::Bundled));
    assert!(!status.error_codes.contains(&"NODE_NOT_FOUND".to_string()));
}

#[test]
fn environment_status_reports_old_node_without_failing_the_check() {
    let temp = tempdir().unwrap();
    let engine = temp.path().join("engine");
    write_engine(&engine, &[("scripts/injector.mjs", b"valid")]);
    let probe = FakeEnvironment {
        windows: Some("Windows 11 24H2".into()),
        node_candidates: vec![PathBuf::from(r"C:\Node\node.exe")],
        codex: Some("26.707.9981.0".into()),
    };
    let validator = FakeNodeValidator::from([(PathBuf::from(r"C:\Node\node.exe"), "v20.18.0")]);

    assert!(resolve_node_runtime(&engine, &probe, &validator).is_none());
    let status = EngineService::environment_status_with(&probe, &validator, &engine);

    assert_eq!(status.windows_version.as_deref(), Some("Windows 11 24H2"));
    assert_eq!(
        status.node_path.as_deref(),
        Some(Path::new(r"C:\Node\node.exe"))
    );
    assert_eq!(status.node_version.as_deref(), Some("v20.18.0"));
    assert_eq!(status.node_source, Some(NodeRuntimeSource::External));
    assert_eq!(status.codex_version.as_deref(), Some("26.707.9981.0"));
    assert!(status.engine_installed);
    assert!(!status.skin_runtime_ready);
    assert_eq!(status.error_codes, vec!["NODE_VERSION_UNSUPPORTED"]);
}

#[test]
fn environment_status_is_not_ready_when_windows_cannot_be_identified() {
    let temp = tempdir().unwrap();
    let engine = temp.path().join("engine");
    write_engine(&engine, &[("scripts/injector.mjs", b"valid")]);
    let probe = FakeEnvironment {
        windows: None,
        node_candidates: vec![PathBuf::from(r"C:\Node\node.exe")],
        codex: Some("26.707.9981.0".into()),
    };
    let validator = FakeNodeValidator::from([(PathBuf::from(r"C:\Node\node.exe"), "v22.20.0")]);

    let status = EngineService::environment_status_with(&probe, &validator, &engine);

    assert!(!status.skin_runtime_ready);
    assert_eq!(status.error_codes, vec!["WINDOWS_VERSION_UNAVAILABLE"]);
}

#[derive(Default)]
struct FakeProcesses {
    processes: Vec<ProcessSnapshot>,
    stopped: RefCell<Vec<u32>>,
}

impl LegacyProcessControl for FakeProcesses {
    fn list_processes(&self) -> Vec<ProcessSnapshot> {
        self.processes.clone()
    }

    fn stop_process(&self, pid: u32) -> std::io::Result<()> {
        self.stopped.borrow_mut().push(pid);
        Ok(())
    }
}

#[test]
fn retiring_legacy_tray_stops_only_the_canonical_tray_and_removes_named_shortcuts() {
    let temp = tempdir().unwrap();
    let canonical = temp.path().join("engine/scripts/tray-dream-skin.ps1");
    let other = temp.path().join("other/tray-dream-skin.ps1");
    let desktop = temp.path().join("Desktop/Codex Dream Skin - Tray.lnk");
    let start_menu = temp.path().join("Start/Codex Dream Skin - Tray.lnk");
    fs::create_dir_all(desktop.parent().unwrap()).unwrap();
    fs::create_dir_all(start_menu.parent().unwrap()).unwrap();
    fs::create_dir_all(canonical.parent().unwrap()).unwrap();
    fs::write(&canonical, b"# canonical legacy tray").unwrap();
    fs::write(&desktop, b"shortcut").unwrap();
    fs::write(&start_menu, b"shortcut").unwrap();
    let processes = FakeProcesses {
        processes: vec![
            ProcessSnapshot::new(
                10,
                "powershell.exe",
                format!("powershell -File \"{}\"", canonical.display()),
            ),
            ProcessSnapshot::new(11, "node.exe", "node injector.mjs"),
            ProcessSnapshot::new(12, "Codex.exe", "Codex.exe"),
            ProcessSnapshot::new(
                13,
                "powershell.exe",
                format!("powershell -File \"{}\"", other.display()),
            ),
        ],
        ..Default::default()
    };

    let report = EngineService::retire_legacy_tray_with(
        &processes,
        &canonical,
        &[desktop.clone(), start_menu.clone()],
    )
    .unwrap();

    assert_eq!(&*processes.stopped.borrow(), &[10]);
    assert_eq!(report.stopped_processes, vec![10]);
    assert_eq!(report.removed_shortcuts.len(), 2);
    assert!(!desktop.exists());
    assert!(!start_menu.exists());
}
