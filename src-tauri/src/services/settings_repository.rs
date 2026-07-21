use crate::{
    error::{StudioError, StudioResult},
    model::settings::AppSettings,
    services::atomic_json,
};
use std::{fs, path::PathBuf};

#[derive(Debug, Clone)]
pub struct SettingsRepository {
    path: PathBuf,
}

impl SettingsRepository {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn read(&self) -> StudioResult<AppSettings> {
        if !self.path.exists() {
            return Ok(AppSettings::default());
        }
        let contents = fs::read_to_string(&self.path)
            .map_err(|error| StudioError::io("failed to read application settings", error))?;
        serde_json::from_str(&contents)
            .map_err(|error| StudioError::json("failed to parse application settings", error))
    }

    pub fn exists(&self) -> bool {
        self.path.is_file()
    }

    pub fn write(&self, settings: &AppSettings) -> StudioResult<()> {
        atomic_json::write_json(&self.path, settings)
    }
}
