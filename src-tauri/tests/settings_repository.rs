use codex_dream_skin_studio_lib::{
    model::settings::{AppSettings, FontPreset},
    services::settings_repository::SettingsRepository,
};

#[test]
fn first_read_returns_approved_defaults() {
    let temp = tempfile::tempdir().unwrap();
    let repo = SettingsRepository::new(temp.path().join("settings.json"));

    let settings = repo.read().unwrap();

    assert!(settings.launch_at_login);
    assert!(settings.auto_start_skin);
    assert_eq!(settings.font_preset, FontPreset::Industrial);
    assert_eq!(settings.window, None);
}

#[test]
fn settings_without_font_preset_migrate_to_industrial() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("settings.json");
    std::fs::write(
        &path,
        r#"{"launchAtLogin":false,"autoStartSkin":true,"window":null}"#,
    )
    .unwrap();
    let repo = SettingsRepository::new(path);

    let settings = repo.read().unwrap();

    assert_eq!(settings.font_preset, FontPreset::Industrial);
    assert!(!settings.launch_at_login);
    assert!(settings.auto_start_skin);
}

#[test]
fn all_font_presets_round_trip() {
    let temp = tempfile::tempdir().unwrap();
    let repo = SettingsRepository::new(temp.path().join("settings.json"));

    for font_preset in [FontPreset::Industrial, FontPreset::Poster, FontPreset::Mono] {
        let expected = AppSettings {
            font_preset,
            ..AppSettings::default()
        };

        repo.write(&expected).unwrap();

        assert_eq!(repo.read().unwrap(), expected);
    }
}

#[test]
fn write_then_read_round_trips() {
    let temp = tempfile::tempdir().unwrap();
    let repo = SettingsRepository::new(temp.path().join("settings.json"));
    let expected = AppSettings {
        launch_at_login: false,
        auto_start_skin: true,
        window: None,
        ..AppSettings::default()
    };

    repo.write(&expected).unwrap();

    assert_eq!(repo.read().unwrap(), expected);
}

#[test]
fn replacing_settings_overwrites_the_previous_document() {
    let temp = tempfile::tempdir().unwrap();
    let repo = SettingsRepository::new(temp.path().join("settings.json"));
    repo.write(&AppSettings::default()).unwrap();
    let expected = AppSettings {
        launch_at_login: false,
        auto_start_skin: false,
        window: None,
        ..AppSettings::default()
    };

    repo.write(&expected).unwrap();

    assert_eq!(repo.read().unwrap(), expected);
}
