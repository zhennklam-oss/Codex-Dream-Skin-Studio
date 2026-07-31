use codex_dream_skin_studio_lib::services::{
    bootstrap::{bundled_engine_root, synchronize_bundled_engine},
    paths::StudioPaths,
};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{fs, path::Path};
use tempfile::tempdir;

fn write_engine(root: &Path, relative: &str, bytes: &[u8]) {
    let target = root.join(relative);
    fs::create_dir_all(target.parent().unwrap()).unwrap();
    fs::write(&target, bytes).unwrap();
    fs::write(
        root.join("ENGINE-SOURCE.json"),
        serde_json::to_vec_pretty(&json!({
            "repository": "bundled",
            "commit": "acceptance",
            "files": [{
                "path": relative,
                "sha256": format!("{:x}", Sha256::digest(bytes))
            }]
        }))
        .unwrap(),
    )
    .unwrap();
}

#[test]
fn packaged_resource_directory_resolves_the_bundled_engine() {
    assert_eq!(
        bundled_engine_root(Path::new(r"C:\Program Files\Dream Skin Studio")),
        Path::new(r"C:\Program Files\Dream Skin Studio")
            .join("resources")
            .join("dream-skin-engine")
    );
}

#[test]
fn startup_bootstrap_installs_verified_engine_without_touching_themes() {
    let temp = tempdir().unwrap();
    let resource_dir = temp.path().join("installed-app");
    let bundled = bundled_engine_root(&resource_dir);
    write_engine(&bundled, "scripts/injector.mjs", b"installed engine");

    let local_data = temp.path().join("local-data");
    let paths = StudioPaths::from_local_data_root(&local_data);
    let theme = paths.dream_skin_root.join("themes/yingying/theme.json");
    fs::create_dir_all(theme.parent().unwrap()).unwrap();
    fs::write(&theme, b"keep theme").unwrap();

    let report = synchronize_bundled_engine(&resource_dir, &paths).unwrap();

    assert!(report.installed);
    assert_eq!(report.file_count, 1);
    assert_eq!(
        fs::read(paths.dream_skin_root.join("engine/scripts/injector.mjs")).unwrap(),
        b"installed engine"
    );
    assert_eq!(fs::read(theme).unwrap(), b"keep theme");
}
