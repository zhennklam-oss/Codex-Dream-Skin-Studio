use crate::model::theme::ThemeDocument;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImageMetadata {
    pub path: PathBuf,
    pub format: String,
    pub width: u32,
    pub height: u32,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeSummary {
    pub id: String,
    pub name: String,
    pub image_path: Option<PathBuf>,
    pub is_built_in: bool,
    pub is_damaged: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeDetail {
    pub theme: ThemeDocument,
    pub image_path: PathBuf,
    pub metadata: ImageMetadata,
    pub is_built_in: bool,
}
