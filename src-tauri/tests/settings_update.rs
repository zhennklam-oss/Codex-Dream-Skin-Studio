use codex_dream_skin_studio_lib::{
    commands::settings::update_app_settings_inner,
    error::{StudioError, StudioResult},
    model::settings::{AppSettings, FontPreset},
    services::{settings_repository::SettingsRepository, startup::StartupService},
};
use std::sync::Mutex;

#[derive(Default)]
struct FakeStartup {
    calls: Mutex<Vec<bool>>,
    fail: bool,
}

impl StartupService for FakeStartup {
    fn sync(&self, enabled: bool) -> StudioResult<()> {
        self.calls.lock().unwrap().push(enabled);
        if self.fail {
            return Err(StudioError::new(
                "STARTUP_SYNC_FAILED",
                "startup registration failed",
            ));
        }
        Ok(())
    }
}

#[test]
fn synchronizes_startup_before_persisting_settings() {
    let temp = tempfile::tempdir().unwrap();
    let repo = SettingsRepository::new(temp.path().join("settings.json"));
    let startup = FakeStartup::default();
    let expected = AppSettings {
        launch_at_login: false,
        auto_start_skin: true,
        window: None,
        ..AppSettings::default()
    };

    let actual = update_app_settings_inner(&repo, &startup, expected.clone()).unwrap();

    assert_eq!(*startup.calls.lock().unwrap(), vec![false]);
    assert_eq!(repo.read().unwrap(), expected);
    assert_eq!(actual, expected);
}

#[test]
fn startup_failure_preserves_previous_settings() {
    let temp = tempfile::tempdir().unwrap();
    let repo = SettingsRepository::new(temp.path().join("settings.json"));
    let previous = AppSettings::default();
    repo.write(&previous).unwrap();
    let startup = FakeStartup {
        calls: Mutex::new(Vec::new()),
        fail: true,
    };
    let replacement = AppSettings {
        launch_at_login: false,
        auto_start_skin: false,
        window: None,
        ..AppSettings::default()
    };

    let error = update_app_settings_inner(&repo, &startup, replacement).unwrap_err();

    assert_eq!(error.code, "STARTUP_SYNC_FAILED");
    assert_eq!(repo.read().unwrap(), previous);
}

#[test]
fn changing_only_auto_start_skin_skips_redundant_startup_disable() {
    let temp = tempfile::tempdir().unwrap();
    let repo = SettingsRepository::new(temp.path().join("settings.json"));
    repo.write(&AppSettings {
        launch_at_login: false,
        auto_start_skin: true,
        window: None,
        ..AppSettings::default()
    })
    .unwrap();
    let startup = FakeStartup {
        calls: Mutex::new(Vec::new()),
        fail: true,
    };
    let expected = AppSettings {
        launch_at_login: false,
        auto_start_skin: false,
        window: None,
        ..AppSettings::default()
    };

    let actual = update_app_settings_inner(&repo, &startup, expected.clone()).unwrap();

    assert!(startup.calls.lock().unwrap().is_empty());
    assert_eq!(repo.read().unwrap(), expected);
    assert_eq!(actual, expected);
}

#[test]
fn changing_only_font_preset_skips_redundant_startup_synchronization() {
    let temp = tempfile::tempdir().unwrap();
    let repo = SettingsRepository::new(temp.path().join("settings.json"));
    repo.write(&AppSettings::default()).unwrap();
    let startup = FakeStartup {
        calls: Mutex::new(Vec::new()),
        fail: true,
    };
    let expected = AppSettings {
        font_preset: FontPreset::Poster,
        ..AppSettings::default()
    };

    let actual = update_app_settings_inner(&repo, &startup, expected.clone()).unwrap();

    assert!(startup.calls.lock().unwrap().is_empty());
    assert_eq!(repo.read().unwrap(), expected);
    assert_eq!(actual, expected);
}
