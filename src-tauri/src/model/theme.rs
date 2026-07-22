use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

const CURRENT_SCHEMA_VERSION: u8 = 5;

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Appearance {
    #[default]
    Auto,
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SafeArea {
    Auto,
    Left,
    Right,
    Center,
    #[default]
    None,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TaskMode {
    #[default]
    Auto,
    Ambient,
    Banner,
    Off,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ToneMode {
    #[default]
    Original,
    Grayscale,
    Duotone,
    Wash,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ArtSettings {
    #[serde(default = "default_focus_x")]
    pub focus_x: f64,
    #[serde(default = "default_focus_y")]
    pub focus_y: f64,
    #[serde(default = "default_scale")]
    pub scale: f64,
    #[serde(default)]
    pub safe_area: SafeArea,
    #[serde(default)]
    pub task_mode: TaskMode,
}

impl Default for ArtSettings {
    fn default() -> Self {
        Self {
            focus_x: default_focus_x(),
            focus_y: default_focus_y(),
            scale: default_scale(),
            safe_area: SafeArea::None,
            task_mode: TaskMode::Auto,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EffectSettings {
    pub home_opacity: f64,
    pub task_opacity: f64,
    pub blur: f64,
    pub saturation: f64,
    pub brightness: f64,
    pub mask_strength: f64,
    pub interface_opacity: f64,
    pub left_sidebar_opacity: f64,
    pub top_bar_opacity: f64,
    pub right_sidebar_opacity: f64,
    pub bottom_bar_opacity: f64,
    pub input_opacity: f64,
    pub tone_mode: ToneMode,
    pub tone_strength: f64,
    pub duotone_shadow: String,
    pub duotone_highlight: String,
    pub wash_color: String,
}

impl Default for EffectSettings {
    fn default() -> Self {
        Self {
            home_opacity: default_home_opacity(),
            task_opacity: default_task_opacity(),
            blur: 0.0,
            saturation: default_saturation(),
            brightness: default_brightness(),
            mask_strength: default_mask_strength(),
            interface_opacity: default_interface_opacity(),
            left_sidebar_opacity: default_interface_opacity(),
            top_bar_opacity: default_interface_opacity(),
            right_sidebar_opacity: default_interface_opacity(),
            bottom_bar_opacity: default_interface_opacity(),
            input_opacity: default_input_opacity(),
            tone_mode: ToneMode::Original,
            tone_strength: 1.0,
            duotone_shadow: default_duotone_shadow(),
            duotone_highlight: default_duotone_highlight(),
            wash_color: default_wash_color(),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EffectSettingsWire {
    home_opacity: Option<f64>,
    task_opacity: Option<f64>,
    blur: Option<f64>,
    saturation: Option<f64>,
    brightness: Option<f64>,
    mask_strength: Option<f64>,
    interface_opacity: Option<f64>,
    sidebar_opacity: Option<f64>,
    composer_opacity: Option<f64>,
    tone_mode: Option<ToneMode>,
    tone_strength: Option<f64>,
    duotone_shadow: Option<String>,
    duotone_highlight: Option<String>,
    wash_color: Option<String>,
    left_sidebar_opacity: Option<f64>,
    top_bar_opacity: Option<f64>,
    right_sidebar_opacity: Option<f64>,
    bottom_bar_opacity: Option<f64>,
    input_opacity: Option<f64>,
}

impl<'de> Deserialize<'de> for EffectSettings {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = EffectSettingsWire::deserialize(deserializer)?;
        let interface_opacity = migrated_interface_opacity(&wire);
        let left_sidebar_opacity = wire
            .left_sidebar_opacity
            .or(wire.sidebar_opacity)
            .unwrap_or(interface_opacity);
        let top_bar_opacity = wire.top_bar_opacity.unwrap_or(interface_opacity);
        let right_sidebar_opacity = wire.right_sidebar_opacity.unwrap_or(interface_opacity);
        let input_opacity = wire
            .input_opacity
            .or(wire.composer_opacity)
            .unwrap_or_else(default_input_opacity);
        let bottom_bar_opacity = wire.bottom_bar_opacity.unwrap_or(interface_opacity);
        Ok(Self {
            home_opacity: wire.home_opacity.unwrap_or_else(default_home_opacity),
            task_opacity: wire.task_opacity.unwrap_or_else(default_task_opacity),
            blur: wire.blur.unwrap_or(0.0),
            saturation: wire.saturation.unwrap_or_else(default_saturation),
            brightness: wire.brightness.unwrap_or_else(default_brightness),
            mask_strength: wire.mask_strength.unwrap_or_else(default_mask_strength),
            interface_opacity,
            left_sidebar_opacity,
            top_bar_opacity,
            right_sidebar_opacity,
            bottom_bar_opacity,
            input_opacity,
            tone_mode: wire.tone_mode.unwrap_or_default(),
            tone_strength: wire.tone_strength.unwrap_or(1.0),
            duotone_shadow: wire.duotone_shadow.unwrap_or_else(default_duotone_shadow),
            duotone_highlight: wire
                .duotone_highlight
                .unwrap_or_else(default_duotone_highlight),
            wash_color: wire.wash_color.unwrap_or_else(default_wash_color),
        })
    }
}

fn migrated_interface_opacity(wire: &EffectSettingsWire) -> f64 {
    if let Some(value) = wire.interface_opacity {
        return value;
    }
    let regions = [
        wire.left_sidebar_opacity,
        wire.top_bar_opacity,
        wire.right_sidebar_opacity,
        wire.bottom_bar_opacity,
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>();
    let legacy = [wire.sidebar_opacity, wire.composer_opacity]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    let values = if regions.is_empty() { legacy } else { regions };
    let mean = if values.is_empty() {
        default_interface_opacity()
    } else {
        values.iter().sum::<f64>() / values.len() as f64
    };
    (mean.clamp(0.0, 1.0) * 10_000.0).round() / 10_000.0
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeDocument {
    #[serde(default = "default_source_schema_version")]
    pub schema_version: u8,
    pub id: String,
    pub name: String,
    pub image: String,
    #[serde(default)]
    pub appearance: Appearance,
    #[serde(default)]
    pub art: ArtSettings,
    #[serde(default)]
    pub effects: EffectSettings,
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

impl ThemeDocument {
    pub fn from_json(json: &str) -> Result<Self, String> {
        let value = serde_json::from_str(json).map_err(|error| error.to_string())?;
        let value = migrate_raw_theme(value)?;
        let mut theme: Self = serde_json::from_value(value).map_err(|error| error.to_string())?;
        if let Some(nested_extra) = theme.extra.remove("extra") {
            let serde_json::Value::Object(nested_extra) = nested_extra else {
                return Err("extra must be an object".to_owned());
            };
            for (key, value) in nested_extra {
                theme.extra.entry(key).or_insert(value);
            }
        }
        theme.validate()?;
        Ok(theme)
    }

    pub fn default_for(id: &str, name: &str, image: &str) -> Self {
        Self {
            schema_version: CURRENT_SCHEMA_VERSION,
            id: id.to_owned(),
            name: name.to_owned(),
            image: image.to_owned(),
            appearance: Appearance::Auto,
            art: ArtSettings::default(),
            effects: EffectSettings::default(),
            extra: BTreeMap::new(),
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != CURRENT_SCHEMA_VERSION {
            return Err(format!("schemaVersion must be {CURRENT_SCHEMA_VERSION}"));
        }
        for (field, value) in [
            ("id", self.id.as_str()),
            ("name", self.name.as_str()),
            ("image", self.image.as_str()),
        ] {
            if value.trim().is_empty() {
                return Err(format!("{field} must not be empty"));
            }
        }
        validate_range("art.focusX", self.art.focus_x, 0.0, 1.0)?;
        validate_range("art.focusY", self.art.focus_y, 0.0, 1.0)?;
        validate_range("art.scale", self.art.scale, 0.5, 2.5)?;
        validate_range("effects.homeOpacity", self.effects.home_opacity, 0.0, 1.0)?;
        validate_range("effects.taskOpacity", self.effects.task_opacity, 0.0, 1.0)?;
        validate_range("effects.blur", self.effects.blur, 0.0, 32.0)?;
        validate_range("effects.saturation", self.effects.saturation, 0.0, 2.0)?;
        validate_range("effects.brightness", self.effects.brightness, 0.5, 1.5)?;
        validate_range("effects.maskStrength", self.effects.mask_strength, 0.0, 1.0)?;
        validate_range(
            "effects.interfaceOpacity",
            self.effects.interface_opacity,
            0.0,
            1.0,
        )?;
        validate_range(
            "effects.leftSidebarOpacity",
            self.effects.left_sidebar_opacity,
            0.0,
            1.0,
        )?;
        validate_range(
            "effects.topBarOpacity",
            self.effects.top_bar_opacity,
            0.0,
            1.0,
        )?;
        validate_range(
            "effects.rightSidebarOpacity",
            self.effects.right_sidebar_opacity,
            0.0,
            1.0,
        )?;
        validate_range(
            "effects.bottomBarOpacity",
            self.effects.bottom_bar_opacity,
            0.0,
            1.0,
        )?;
        validate_range("effects.inputOpacity", self.effects.input_opacity, 0.0, 1.0)?;
        validate_range("effects.toneStrength", self.effects.tone_strength, 0.0, 1.0)?;
        validate_hex_color("effects.duotoneShadow", &self.effects.duotone_shadow)?;
        validate_hex_color("effects.duotoneHighlight", &self.effects.duotone_highlight)?;
        validate_hex_color("effects.washColor", &self.effects.wash_color)?;
        Ok(())
    }
}

fn migrate_raw_theme(mut value: serde_json::Value) -> Result<serde_json::Value, String> {
    let source_schema = match value.get("schemaVersion") {
        Some(schema) => schema
            .as_u64()
            .and_then(|schema| u8::try_from(schema).ok())
            .ok_or_else(|| "schemaVersion must be an integer".to_owned())?,
        None => default_source_schema_version(),
    };
    if !(1..=CURRENT_SCHEMA_VERSION).contains(&source_schema) {
        return Err(format!("unsupported schemaVersion: {source_schema}"));
    }
    if source_schema <= 4 {
        let effects = value
            .as_object_mut()
            .and_then(|theme| {
                theme
                    .entry("effects")
                    .or_insert_with(|| serde_json::json!({}))
                    .as_object_mut()
            })
            .ok_or_else(|| "effects must be an object".to_owned())?;
        let migrated_interface = migrated_interface_opacity_from_value(effects)?;
        let migrated_input = effects
            .get("inputOpacity")
            .or_else(|| effects.get("composerOpacity"))
            .or_else(|| effects.get("bottomBarOpacity"))
            .cloned()
            .unwrap_or_else(|| serde_json::json!(default_input_opacity()));
        effects.insert("inputOpacity".to_owned(), migrated_input);
        effects.insert(
            "bottomBarOpacity".to_owned(),
            serde_json::json!(migrated_interface),
        );
    }
    value["schemaVersion"] = serde_json::json!(CURRENT_SCHEMA_VERSION);
    Ok(value)
}

fn read_opacity(
    effects: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Result<Option<f64>, String> {
    let Some(value) = effects.get(key) else {
        return Ok(None);
    };
    let number = value
        .as_f64()
        .ok_or_else(|| format!("effects.{key} must be a number"))?;
    if !(0.0..=1.0).contains(&number) {
        return Err(format!("effects.{key} must be between 0 and 1"));
    }
    Ok(Some(number))
}

fn migrated_interface_opacity_from_value(
    effects: &serde_json::Map<String, serde_json::Value>,
) -> Result<f64, String> {
    if let Some(value) = read_opacity(effects, "interfaceOpacity")? {
        return Ok(value);
    }
    let mut region_values = Vec::new();
    for key in [
        "leftSidebarOpacity",
        "topBarOpacity",
        "rightSidebarOpacity",
        "bottomBarOpacity",
    ] {
        if let Some(value) = read_opacity(effects, key)? {
            region_values.push(value);
        }
    }
    let mut legacy_values = Vec::new();
    for key in ["sidebarOpacity", "composerOpacity"] {
        if let Some(value) = read_opacity(effects, key)? {
            legacy_values.push(value);
        }
    }
    let values = if region_values.is_empty() {
        legacy_values
    } else {
        region_values
    };
    let mean = if values.is_empty() {
        default_interface_opacity()
    } else {
        values.iter().sum::<f64>() / values.len() as f64
    };
    Ok((mean.clamp(0.0, 1.0) * 10_000.0).round() / 10_000.0)
}

fn validate_range(field: &str, value: f64, minimum: f64, maximum: f64) -> Result<(), String> {
    if value.is_finite() && (minimum..=maximum).contains(&value) {
        Ok(())
    } else {
        Err(format!("{field} must be between {minimum} and {maximum}"))
    }
}

fn validate_hex_color(field: &str, value: &str) -> Result<(), String> {
    let bytes = value.as_bytes();
    if bytes.len() == 7 && bytes[0] == b'#' && bytes[1..].iter().all(u8::is_ascii_hexdigit) {
        Ok(())
    } else {
        Err(format!("{field} must be a six-digit hexadecimal color"))
    }
}

const fn default_source_schema_version() -> u8 {
    1
}
const fn default_focus_x() -> f64 {
    0.5
}
const fn default_focus_y() -> f64 {
    0.46
}
const fn default_scale() -> f64 {
    1.0
}
const fn default_home_opacity() -> f64 {
    1.0
}
const fn default_task_opacity() -> f64 {
    0.18
}
const fn default_saturation() -> f64 {
    1.0
}
const fn default_brightness() -> f64 {
    1.0
}
const fn default_mask_strength() -> f64 {
    0.65
}
const fn default_interface_opacity() -> f64 {
    0.78
}
const fn default_input_opacity() -> f64 {
    0.9
}
fn default_duotone_shadow() -> String {
    "#1C1B22".to_owned()
}
fn default_duotone_highlight() -> String {
    "#F2E9DC".to_owned()
}
fn default_wash_color() -> String {
    "#7D9FA5".to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn migrates_schema_one_with_exact_defaults() {
        let theme = ThemeDocument::from_json(
            r#"{
              "schemaVersion":1,"id":"preset-a","name":"A","image":"art.jpg",
              "appearance":"auto","art":{"focusX":0.4,"focusY":0.6,"safeArea":"left","taskMode":"ambient"}
            }"#,
        )
        .unwrap();

        assert_eq!(theme.schema_version, 5);
        assert_eq!(theme.art.scale, 1.0);
        assert_eq!(theme.effects, EffectSettings::default());
    }

    #[test]
    fn migrates_legacy_opacity_aliases_and_tone_defaults() {
        for schema_version in [1, 2] {
            let theme = ThemeDocument::from_json(&format!(
                r#"{{
                  "schemaVersion":{schema_version},"id":"legacy","name":"Legacy","image":"art.jpg",
                  "effects":{{"sidebarOpacity":0.31,"composerOpacity":0.47}}
                }}"#
            ))
            .unwrap();

            assert_eq!(theme.effects.tone_mode, ToneMode::Original);
            assert_eq!(theme.effects.tone_strength, 1.0);
            assert_eq!(theme.effects.duotone_shadow, "#1C1B22");
            assert_eq!(theme.effects.duotone_highlight, "#F2E9DC");
            assert_eq!(theme.effects.wash_color, "#7D9FA5");
            assert_eq!(theme.effects.interface_opacity, 0.39);
            assert_eq!(theme.effects.left_sidebar_opacity, 0.31);
            assert_eq!(theme.effects.top_bar_opacity, 0.39);
            assert_eq!(theme.effects.right_sidebar_opacity, 0.39);
            assert_eq!(theme.effects.bottom_bar_opacity, 0.39);
            assert_eq!(theme.effects.input_opacity, 0.47);
        }
    }

    #[test]
    fn migrates_present_region_values_before_legacy_aliases() {
        let theme = ThemeDocument::from_json(
            r#"{
              "schemaVersion":2,"id":"legacy","name":"Legacy","image":"art.jpg",
              "effects":{"leftSidebarOpacity":0.2,"topBarOpacity":0.4,"sidebarOpacity":1.0,"composerOpacity":1.0}
            }"#,
        )
        .unwrap();

        assert_eq!(theme.schema_version, 5);
        assert_eq!(theme.effects.interface_opacity, 0.3);
        assert_eq!(theme.effects.left_sidebar_opacity, 0.2);
        assert_eq!(theme.effects.top_bar_opacity, 0.4);
        assert_eq!(theme.effects.right_sidebar_opacity, 0.3);
        assert_eq!(theme.effects.bottom_bar_opacity, 0.3);
        assert_eq!(theme.effects.input_opacity, 1.0);
    }

    #[test]
    fn migrates_schema_four_bottom_opacity_to_input_opacity() {
        let theme = ThemeDocument::from_json(
            r#"{
              "schemaVersion":4,"id":"legacy","name":"Legacy","image":"art.jpg",
              "effects":{"interfaceOpacity":0.61,"bottomBarOpacity":0.27}
            }"#,
        )
        .unwrap();

        assert_eq!(theme.schema_version, 5);
        assert_eq!(theme.effects.input_opacity, 0.27);
        assert_eq!(theme.effects.bottom_bar_opacity, 0.61);
    }

    #[test]
    fn preserves_schema_five_input_and_bottom_opacity() {
        let theme = ThemeDocument::from_json(
            r#"{
              "schemaVersion":5,"id":"current","name":"Current","image":"art.jpg",
              "effects":{"interfaceOpacity":0.61,"bottomBarOpacity":0.42,"inputOpacity":0.83}
            }"#,
        )
        .unwrap();

        assert_eq!(theme.effects.bottom_bar_opacity, 0.42);
        assert_eq!(theme.effects.input_opacity, 0.83);
    }

    #[test]
    fn serializes_unified_and_independent_region_opacity() {
        let theme = ThemeDocument::from_json(
            r#"{
              "schemaVersion":2,"id":"legacy","name":"Legacy","image":"art.jpg",
              "effects":{"leftSidebarOpacity":0.2,"rightSidebarOpacity":0.7}
            }"#,
        )
        .unwrap();

        let serialized = serde_json::to_value(theme).unwrap();
        assert_eq!(serialized["schemaVersion"], 5);
        assert_eq!(serialized["effects"]["interfaceOpacity"], 0.45);
        assert_eq!(serialized["effects"]["leftSidebarOpacity"], 0.2);
        assert_eq!(serialized["effects"]["topBarOpacity"], 0.45);
        assert_eq!(serialized["effects"]["rightSidebarOpacity"], 0.7);
        assert_eq!(serialized["effects"]["bottomBarOpacity"], 0.45);
        assert_eq!(serialized["effects"]["inputOpacity"], 0.9);
        for key in ["sidebarOpacity", "composerOpacity"] {
            assert!(serialized["effects"].get(key).is_none(), "retained {key}");
        }
    }

    #[test]
    fn rejects_out_of_range_schema_five_input_opacity() {
        assert!(ThemeDocument::from_json(
            r#"{
              "schemaVersion":5,"id":"bad","name":"Bad","image":"art.jpg",
              "effects":{"inputOpacity":1.01}
            }"#,
        )
        .is_err());
    }

    #[test]
    fn rejects_invalid_tone_values() {
        let invalid_cases = [
            r##"{"schemaVersion":2,"id":"a","name":"A","image":"a.jpg","effects":{"toneMode":"sepia"}}"##,
            r##"{"schemaVersion":2,"id":"a","name":"A","image":"a.jpg","effects":{"duotoneShadow":"#123"}}"##,
            r##"{"schemaVersion":2,"id":"a","name":"A","image":"a.jpg","effects":{"duotoneHighlight":"red"}}"##,
            r##"{"schemaVersion":2,"id":"a","name":"A","image":"a.jpg","effects":{"washColor":"#12345G"}}"##,
            r##"{"schemaVersion":2,"id":"a","name":"A","image":"a.jpg","effects":{"toneStrength":1.01}}"##,
        ];

        for json in invalid_cases {
            assert!(
                ThemeDocument::from_json(json).is_err(),
                "unexpectedly accepted {json}"
            );
        }
    }

    #[test]
    fn treats_a_missing_schema_version_as_schema_one() {
        let theme = ThemeDocument::from_json(
            r#"{
              "id":"custom-yingying","name":"Yingying","image":"art.jpg",
              "appearance":"auto","art":{"focusX":0.5,"focusY":0.46,"safeArea":"auto","taskMode":"auto"}
            }"#,
        )
        .unwrap();

        assert_eq!(theme.schema_version, 5);
        assert_eq!(theme.art.scale, 1.0);
    }

    #[test]
    fn preserves_unknown_top_level_fields_when_round_tripped() {
        let theme = ThemeDocument::from_json(
            r#"{
              "schemaVersion":1,"id":"preset-a","name":"A","image":"art.jpg",
              "appearance":"auto","art":{"focusX":0.4,"focusY":0.6,"safeArea":"left","taskMode":"ambient"},
              "quote":"KEEP ME","palette":{"accent":"blue"}
            }"#,
        )
        .unwrap();

        assert_eq!(theme.extra.get("quote"), Some(&json!("KEEP ME")));
        let serialized = serde_json::to_value(theme).unwrap();
        assert_eq!(serialized["quote"], "KEEP ME");
        assert_eq!(serialized["palette"]["accent"], "blue");
        assert!(serialized.get("extra").is_none());
    }

    #[test]
    fn accepts_frontend_normalized_extra_without_nesting_it() {
        let theme = ThemeDocument::from_json(
            r#"{
              "schemaVersion":2,"id":"preset-a","name":"A","image":"art.jpg",
              "appearance":"auto","art":{},"effects":{},
              "extra":{"quote":"KEEP ME"}
            }"#,
        )
        .unwrap();

        assert_eq!(theme.extra.get("quote"), Some(&json!("KEEP ME")));
        assert!(!theme.extra.contains_key("extra"));
    }

    #[test]
    fn default_theme_uses_schema_five_defaults() {
        let theme = ThemeDocument::default_for("id", "name", "art.jpg");

        assert_eq!(theme.schema_version, 5);
        assert_eq!(theme.appearance, Appearance::Auto);
        assert_eq!(theme.art, ArtSettings::default());
        assert_eq!(theme.effects, EffectSettings::default());
        assert!(theme.extra.is_empty());
        assert_eq!(theme.art.safe_area, SafeArea::None);
    }

    #[test]
    fn rejects_unsupported_schema_versions_and_invalid_enums() {
        let unsupported = ThemeDocument::from_json(
            r#"{"schemaVersion":6,"id":"a","name":"A","image":"a.jpg","appearance":"auto","art":{}}"#,
        );
        assert!(unsupported.is_err());

        let invalid_enum = ThemeDocument::from_json(
            r#"{"schemaVersion":5,"id":"a","name":"A","image":"a.jpg","appearance":"sepia","art":{}}"#,
        );
        assert!(invalid_enum.is_err());
    }

    #[test]
    fn rejects_each_out_of_range_numeric_group() {
        let mut theme = ThemeDocument::default_for("id", "name", "art.jpg");
        theme.art.focus_x = -0.01;
        assert!(theme.validate().is_err());

        theme.art = ArtSettings::default();
        theme.art.scale = 2.51;
        assert!(theme.validate().is_err());

        theme.art = ArtSettings::default();
        theme.effects.interface_opacity = 1.2;
        assert!(theme.validate().is_err());

        theme.effects = EffectSettings::default();
        theme.effects.blur = 32.01;
        assert!(theme.validate().is_err());

        theme.effects = EffectSettings::default();
        theme.effects.saturation = 2.01;
        assert!(theme.validate().is_err());

        theme.effects = EffectSettings::default();
        theme.effects.brightness = 0.49;
        assert!(theme.validate().is_err());
    }

    #[test]
    fn accepts_all_inclusive_numeric_boundaries() {
        let mut theme = ThemeDocument::default_for("id", "name", "art.jpg");
        theme.art.focus_x = 0.0;
        theme.art.focus_y = 1.0;
        theme.art.scale = 0.5;
        theme.effects.home_opacity = 0.0;
        theme.effects.task_opacity = 1.0;
        theme.effects.blur = 32.0;
        theme.effects.saturation = 2.0;
        theme.effects.brightness = 1.5;
        theme.effects.mask_strength = 0.0;
        theme.effects.interface_opacity = 1.0;

        assert!(theme.validate().is_ok());
    }
}
