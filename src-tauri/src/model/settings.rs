use serde::{Deserialize, Serialize};

#[derive(Debug, Default, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FontPreset {
    #[default]
    Industrial,
    Poster,
    Mono,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WindowPlacement {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub maximized: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub launch_at_login: bool,
    pub auto_start_skin: bool,
    pub font_preset: FontPreset,
    pub window: Option<WindowPlacement>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            launch_at_login: true,
            auto_start_skin: true,
            font_preset: FontPreset::Industrial,
            window: None,
        }
    }
}
