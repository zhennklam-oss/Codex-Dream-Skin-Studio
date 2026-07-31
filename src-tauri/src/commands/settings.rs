use crate::{
    error::StudioResult,
    model::settings::AppSettings,
    services::{
        settings_repository::SettingsRepository,
        startup::{StartupService, TauriStartupService},
    },
};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn get_app_settings(
    app: AppHandle,
    repository: State<'_, SettingsRepository>,
) -> StudioResult<AppSettings> {
    let startup = TauriStartupService::new(&app);
    get_app_settings_inner(repository.inner(), &startup)
}

pub fn get_app_settings_inner(
    repository: &SettingsRepository,
    startup: &dyn StartupService,
) -> StudioResult<AppSettings> {
    let first_read = !repository.exists();
    let settings = repository.read()?;
    if first_read {
        startup.sync(settings.launch_at_login)?;
        repository.write(&settings)?;
    }
    Ok(settings)
}

#[tauri::command]
pub fn update_app_settings(
    app: AppHandle,
    repository: State<'_, SettingsRepository>,
    settings: AppSettings,
) -> StudioResult<AppSettings> {
    let startup = TauriStartupService::new(&app);
    update_app_settings_inner(repository.inner(), &startup, settings)
}

pub fn update_app_settings_inner(
    repository: &SettingsRepository,
    startup: &dyn StartupService,
    settings: AppSettings,
) -> StudioResult<AppSettings> {
    let previous = repository.read()?;
    if previous.launch_at_login != settings.launch_at_login {
        startup.sync(settings.launch_at_login)?;
    }
    repository.write(&settings)?;
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use tempfile::tempdir;

    #[derive(Default)]
    struct RecordingStartup(Mutex<Vec<bool>>);

    impl StartupService for RecordingStartup {
        fn sync(&self, enabled: bool) -> StudioResult<()> {
            self.0.lock().unwrap().push(enabled);
            Ok(())
        }
    }

    #[test]
    fn first_settings_read_persists_and_synchronizes_enabled_defaults() {
        let root = tempdir().unwrap();
        let path = root.path().join("settings.json");
        let repository = SettingsRepository::new(path.clone());
        let startup = RecordingStartup::default();

        let settings = get_app_settings_inner(&repository, &startup).unwrap();

        assert_eq!(settings, AppSettings::default());
        assert!(path.is_file());
        assert_eq!(*startup.0.lock().unwrap(), vec![true]);
    }
}
