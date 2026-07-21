#![cfg(windows)]

use codex_dream_skin_studio_lib::services::engine::{
    EngineRuntime, EngineService, NodeRuntimeSource,
};
use std::{
    env, fs,
    path::{Path, PathBuf},
};
use tempfile::tempdir;

const SCENARIO_ENV: &str = "DREAM_SKIN_NODE_SCENARIO";
const EXTERNAL_NODE_ENV: &str = "DREAM_SKIN_EXPECTED_EXTERNAL_NODE";

#[test]
#[ignore = "acceptance harness supplies an isolated PATH and Node scenario"]
fn installed_environment_probe_resolves_node_runtime() {
    let scenario = env::var(SCENARIO_ENV).expect("acceptance harness must select a Node scenario");
    let temp = tempdir().unwrap();
    let packaged_engine = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("dream-skin-engine");
    let temporary_resources = temp.path().join("resources/dream-skin-engine");
    copy_tree(&packaged_engine, &temporary_resources);

    let state_root = temp.path().join("localappdata/CodexDreamSkin");
    let managed_engine = state_root.join("engine");
    let report = EngineService::synchronize(&temporary_resources, &managed_engine).unwrap();
    assert!(report.installed);

    if scenario == "external" {
        fs::remove_file(managed_engine.join("runtime/node.exe")).unwrap();
    } else {
        assert_eq!(scenario, "bundled", "unsupported acceptance scenario");
    }

    let status = EngineRuntime::new(managed_engine.clone(), state_root).get_environment_status();
    println!(
        "DREAM_SKIN_ENV_STATUS={}",
        serde_json::to_string(&status).unwrap()
    );

    assert!(status.windows_version.is_some());
    assert!(status.codex_present);
    assert!(!status
        .error_codes
        .iter()
        .any(|code| code == "NODE_NOT_FOUND"));

    match scenario.as_str() {
        "bundled" => {
            assert_eq!(status.node_source, Some(NodeRuntimeSource::Bundled));
            assert_eq!(status.node_version.as_deref(), Some("24.18.0"));
            let expected = fs::canonicalize(managed_engine.join("runtime/node.exe")).unwrap();
            let selected = fs::canonicalize(status.node_path.as_ref().unwrap()).unwrap();
            assert_eq!(selected, expected);
            assert!(status.engine_installed);
            assert!(status.skin_runtime_ready);
            assert!(status.error_codes.is_empty());
        }
        "external" => {
            let expected = fs::canonicalize(
                env::var_os(EXTERNAL_NODE_ENV)
                    .map(PathBuf::from)
                    .expect("external scenario requires an expected executable"),
            )
            .unwrap();
            let selected = fs::canonicalize(status.node_path.as_ref().unwrap()).unwrap();
            assert_eq!(status.node_source, Some(NodeRuntimeSource::External));
            assert_eq!(selected, expected);
            assert!(node_major(status.node_version.as_deref().unwrap()) >= 22);
            assert!(!status.engine_installed);
            assert!(!status.skin_runtime_ready);
            assert!(status
                .error_codes
                .iter()
                .any(|code| code == "ENGINE_NOT_INSTALLED"));
        }
        _ => unreachable!(),
    }
}

fn copy_tree(source: &Path, destination: &Path) {
    fs::create_dir_all(destination).unwrap();
    for entry in fs::read_dir(source).unwrap() {
        let entry = entry.unwrap();
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_tree(&source_path, &destination_path);
        } else {
            fs::copy(&source_path, &destination_path).unwrap();
        }
    }
}

fn node_major(version: &str) -> u32 {
    version
        .trim_start_matches(['v', 'V'])
        .split('.')
        .next()
        .unwrap()
        .parse()
        .unwrap()
}
