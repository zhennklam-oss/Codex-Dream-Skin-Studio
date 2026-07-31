use crate::error::{StudioError, StudioResult};
use serde::Serialize;
use std::{fs, io::Write, path::Path};
use uuid::Uuid;

pub fn write_json<T: Serialize + ?Sized>(path: &Path, value: &T) -> StudioResult<()> {
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| StudioError::json("failed to serialize JSON", error))?;
    let parent = path.parent().ok_or_else(|| {
        StudioError::new("INVALID_PATH", "JSON destination has no parent directory")
    })?;
    fs::create_dir_all(parent)
        .map_err(|error| StudioError::io("failed to create settings directory", error))?;

    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("document.json");
    let temporary_path = parent.join(format!(".{file_name}.{}.tmp", Uuid::new_v4()));

    let result = (|| {
        let mut temporary = fs::File::create(&temporary_path)
            .map_err(|error| StudioError::io("failed to create temporary JSON file", error))?;
        temporary
            .write_all(&bytes)
            .map_err(|error| StudioError::io("failed to write temporary JSON file", error))?;
        temporary
            .write_all(b"\n")
            .map_err(|error| StudioError::io("failed to finish temporary JSON file", error))?;
        temporary
            .sync_all()
            .map_err(|error| StudioError::io("failed to flush temporary JSON file", error))?;
        drop(temporary);
        fs::rename(&temporary_path, path)
            .map_err(|error| StudioError::io("failed to replace JSON file", error))
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    result
}
