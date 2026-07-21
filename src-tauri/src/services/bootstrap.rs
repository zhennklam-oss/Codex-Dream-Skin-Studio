use crate::{
    error::StudioResult,
    services::{
        engine::{EngineInstallReport, EngineService},
        paths::StudioPaths,
    },
};
use std::path::{Path, PathBuf};

pub fn bundled_engine_root(resource_dir: &Path) -> PathBuf {
    resource_dir.join("resources").join("dream-skin-engine")
}

pub fn synchronize_bundled_engine(
    resource_dir: &Path,
    paths: &StudioPaths,
) -> StudioResult<EngineInstallReport> {
    EngineService::synchronize(
        &bundled_engine_root(resource_dir),
        &paths.dream_skin_root.join("engine"),
    )
}
