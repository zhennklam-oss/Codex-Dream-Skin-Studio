use crate::{
    error::{StudioError, StudioResult},
    model::{
        status::{ImageMetadata, ThemeDetail, ThemeSummary},
        theme::ThemeDocument,
    },
    services::{engine::EngineRuntime, image::validate_image, theme_repository::ThemeRepository},
};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeIdRequest {
    pub id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateThemeRequest {
    pub name: String,
    pub source_image: PathBuf,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedThemeRequest {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyThemeRequest {
    pub theme: ThemeDocument,
    pub source_image: Option<PathBuf>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChooseImageRequest {
    pub path: PathBuf,
}

#[tauri::command]
pub fn list_themes(repository: State<'_, ThemeRepository>) -> StudioResult<Vec<ThemeSummary>> {
    repository.list()
}

#[tauri::command]
pub fn read_theme(
    request: ThemeIdRequest,
    repository: State<'_, ThemeRepository>,
) -> StudioResult<ThemeDetail> {
    repository.read(&request.id)
}

#[tauri::command]
pub fn create_theme(
    request: CreateThemeRequest,
    repository: State<'_, ThemeRepository>,
) -> StudioResult<ThemeDetail> {
    repository.create(&request.name, &request.source_image)
}

#[tauri::command]
pub fn duplicate_theme(
    request: NamedThemeRequest,
    repository: State<'_, ThemeRepository>,
) -> StudioResult<ThemeDetail> {
    repository.duplicate(&request.id, &request.name)
}

#[tauri::command]
pub fn rename_theme(
    request: NamedThemeRequest,
    repository: State<'_, ThemeRepository>,
) -> StudioResult<ThemeDetail> {
    repository.rename(&request.id, &request.name)
}

#[tauri::command]
pub fn delete_theme(
    request: ThemeIdRequest,
    repository: State<'_, ThemeRepository>,
) -> StudioResult<()> {
    repository.delete(&request.id)
}

#[tauri::command]
pub async fn apply_theme(
    request: ApplyThemeRequest,
    repository: State<'_, ThemeRepository>,
    runtime: State<'_, EngineRuntime>,
) -> StudioResult<ThemeDetail> {
    let applied = repository.apply(request.theme, request.source_image.as_deref())?;
    runtime.reconcile_runtime().await?;
    Ok(applied)
}

#[tauri::command]
pub fn choose_image(request: ChooseImageRequest, app: AppHandle) -> StudioResult<ImageMetadata> {
    let scope = app.asset_protocol_scope();
    validate_and_allow_image(&request.path, validate_image, |path| {
        scope.allow_file(path).map_err(|error| error.to_string())
    })
}

fn validate_and_allow_image(
    path: &Path,
    validate: impl FnOnce(&Path) -> StudioResult<ImageMetadata>,
    allow: impl FnOnce(&Path) -> Result<(), String>,
) -> StudioResult<ImageMetadata> {
    let metadata = validate(path)?;
    allow(path).map_err(|error| {
        StudioError::new(
            "ASSET_SCOPE_ALLOW_FAILED",
            "failed to allow validated image preview",
        )
        .with_detail(error)
    })?;
    Ok(metadata)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::StudioError;
    use std::{cell::RefCell, path::Path};

    fn metadata(path: &Path) -> ImageMetadata {
        ImageMetadata {
            path: path.to_path_buf(),
            format: "webp".to_string(),
            width: 1920,
            height: 1080,
            bytes: 1024,
            sha256: "abc".to_string(),
        }
    }

    #[test]
    fn preview_scope_is_not_extended_when_validation_fails() {
        let allowed = RefCell::new(Vec::new());
        let result = validate_and_allow_image(
            Path::new("invalid.gif"),
            |_| Err(StudioError::new("IMAGE_FORMAT_UNSUPPORTED", "unsupported")),
            |path| {
                allowed.borrow_mut().push(path.to_path_buf());
                Ok(())
            },
        );

        assert_eq!(result.unwrap_err().code(), "IMAGE_FORMAT_UNSUPPORTED");
        assert!(allowed.borrow().is_empty());
    }

    #[test]
    fn preview_scope_allow_failure_is_structured_after_validation() {
        let calls = RefCell::new(Vec::new());
        let path = Path::new("D:\\wallpapers\\skin.webp");
        let result = validate_and_allow_image(
            path,
            |validated| {
                calls.borrow_mut().push("validate");
                Ok(metadata(validated))
            },
            |_| {
                calls.borrow_mut().push("allow");
                Err("invalid glob pattern".to_string())
            },
        );

        let error = result.unwrap_err();
        assert_eq!(calls.into_inner(), vec!["validate", "allow"]);
        assert_eq!(error.code(), "ASSET_SCOPE_ALLOW_FAILED");
        assert_eq!(error.detail.as_deref(), Some("invalid glob pattern"));
    }
}
