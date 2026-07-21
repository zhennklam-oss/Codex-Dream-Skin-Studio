use codex_dream_skin_studio_lib::services::paths::StudioPaths;

#[test]
fn derives_dream_skin_and_studio_roots_from_local_app_data() {
    let temp = tempfile::tempdir().unwrap();

    let paths = StudioPaths::from_local_data_root(temp.path());

    assert_eq!(paths.dream_skin_root, temp.path().join("CodexDreamSkin"));
    assert_eq!(paths.studio_root, temp.path().join("CodexDreamSkinStudio"));
    assert_eq!(
        paths.settings_file,
        temp.path()
            .join("CodexDreamSkinStudio")
            .join("settings.json")
    );
}
