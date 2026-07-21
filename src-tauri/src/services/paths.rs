use crate::error::{StudioError, StudioResult};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StudioPaths {
    pub dream_skin_root: PathBuf,
    pub studio_root: PathBuf,
    pub settings_file: PathBuf,
}

impl StudioPaths {
    pub fn discover() -> StudioResult<Self> {
        let local_data_root = dirs::data_local_dir().ok_or_else(|| {
            StudioError::new(
                "LOCAL_APP_DATA_UNAVAILABLE",
                "Windows local application data directory is unavailable",
            )
        })?;
        Ok(Self::from_local_data_root(&local_data_root))
    }

    pub fn from_local_data_root(local_data_root: &Path) -> Self {
        let dream_skin_root = local_data_root.join("CodexDreamSkin");
        let studio_root = local_data_root.join("CodexDreamSkinStudio");
        let settings_file = studio_root.join("settings.json");
        Self {
            dream_skin_root,
            studio_root,
            settings_file,
        }
    }
}
