use crate::{
    error::{StudioError, StudioResult},
    model::{
        status::{ThemeDetail, ThemeSummary},
        theme::ThemeDocument,
    },
    services::{
        atomic_json,
        image::{extension_for_format, validate_image},
    },
};
use chrono::Local;
use std::{
    fs,
    path::{Component, Path, PathBuf},
    sync::{Mutex, OnceLock},
};
use uuid::Uuid;

static APPLY_MUTEX: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug)]
pub struct ThemeRepository {
    canonical_root: PathBuf,
    themes: PathBuf,
    active_theme: PathBuf,
}

impl ThemeRepository {
    pub fn new(root: PathBuf) -> StudioResult<Self> {
        fs::create_dir_all(root.join("themes"))
            .map_err(|error| StudioError::io("failed to create theme library", error))?;
        let canonical_root = root
            .canonicalize()
            .map_err(|error| StudioError::io("failed to resolve theme root", error))?;
        reject_reparse_point(&canonical_root)?;
        let repository = Self {
            themes: canonical_root.join("themes"),
            active_theme: canonical_root.join("active-theme"),
            canonical_root,
        };
        repository.migrate_stored_themes()?;
        Ok(repository)
    }

    pub fn list(&self) -> StudioResult<Vec<ThemeSummary>> {
        let mut themes = Vec::new();
        for entry in fs::read_dir(&self.themes)
            .map_err(|error| StudioError::io("failed to list themes", error))?
        {
            let entry = entry.map_err(|error| StudioError::io("failed to list theme", error))?;
            if !entry
                .file_type()
                .map_err(|error| StudioError::io("failed to inspect theme", error))?
                .is_dir()
            {
                continue;
            }
            let id = entry.file_name().to_string_lossy().into_owned();
            match self.read(&id) {
                Ok(detail) => themes.push(ThemeSummary {
                    id: detail.theme.id,
                    name: detail.theme.name,
                    image_path: Some(detail.image_path),
                    is_built_in: detail.is_built_in,
                    is_damaged: false,
                }),
                Err(_) => themes.push(ThemeSummary {
                    name: id.clone(),
                    image_path: None,
                    is_built_in: is_built_in_id(&id),
                    is_damaged: true,
                    id,
                }),
            }
        }
        themes.sort_by(|left, right| {
            right
                .is_built_in
                .cmp(&left.is_built_in)
                .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
        });
        Ok(themes)
    }

    pub fn read(&self, id: &str) -> StudioResult<ThemeDetail> {
        let theme_directory = self.theme_directory(id)?;
        self.read_from_directory(&theme_directory, Some(id))
    }

    pub fn create(&self, name: &str, source_image: &Path) -> StudioResult<ThemeDetail> {
        validate_name(name)?;
        let metadata = validate_image(source_image)?;
        let id = new_theme_id();
        let theme_directory = self.theme_directory(&id)?;
        fs::create_dir(&theme_directory)
            .map_err(|error| StudioError::io("failed to create theme", error))?;
        let extension = extension_for_format(&metadata.format)?;
        let image_name = generated_image_name(extension);
        let result = (|| {
            fs::copy(source_image, theme_directory.join(&image_name))
                .map_err(|error| StudioError::io("failed to copy theme image", error))?;
            let theme = ThemeDocument::default_for(&id, name.trim(), &image_name);
            atomic_json::write_json(&theme_directory.join("theme.json"), &theme)?;
            self.read(&id)
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(&theme_directory);
        }
        result
    }

    pub fn duplicate(&self, id: &str, name: &str) -> StudioResult<ThemeDetail> {
        validate_name(name)?;
        let source = self.read(id)?;
        let new_id = new_theme_id();
        let destination = self.theme_directory(&new_id)?;
        fs::create_dir(&destination)
            .map_err(|error| StudioError::io("failed to create duplicate theme", error))?;
        let result = (|| {
            let image_name = source.theme.image.clone();
            fs::copy(&source.image_path, destination.join(&image_name))
                .map_err(|error| StudioError::io("failed to copy duplicate image", error))?;
            let mut theme = source.theme;
            theme.id = new_id.clone();
            theme.name = name.trim().to_owned();
            atomic_json::write_json(&destination.join("theme.json"), &theme)?;
            self.read(&new_id)
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(&destination);
        }
        result
    }

    pub fn rename(&self, id: &str, name: &str) -> StudioResult<ThemeDetail> {
        validate_name(name)?;
        let mut detail = self.read(id)?;
        detail.theme.name = name.trim().to_owned();
        atomic_json::write_json(&self.theme_directory(id)?.join("theme.json"), &detail.theme)?;
        self.read(id)
    }

    pub fn delete(&self, id: &str) -> StudioResult<()> {
        let theme_directory = self.theme_directory(id)?;
        fs::remove_dir_all(theme_directory)
            .map_err(|error| StudioError::io("failed to delete theme", error))
    }

    pub fn apply(
        &self,
        mut theme: ThemeDocument,
        source_image: Option<&Path>,
    ) -> StudioResult<ThemeDetail> {
        let _guard = APPLY_MUTEX
            .get_or_init(|| Mutex::new(()))
            .lock()
            .map_err(|_| {
                StudioError::new("THEME_APPLY_LOCK_POISONED", "theme apply lock failed")
            })?;
        theme.validate().map_err(|detail| {
            StudioError::new("THEME_INVALID", "theme settings are invalid").with_detail(detail)
        })?;
        let theme_directory = self.theme_directory(&theme.id)?;
        fs::create_dir_all(&theme_directory)
            .map_err(|error| StudioError::io("failed to create managed theme directory", error))?;

        if let Some(source_image) = source_image {
            let metadata = validate_image(source_image)?;
            let extension = extension_for_format(&metadata.format)?;
            let image_name = generated_image_name(extension);
            fs::copy(source_image, theme_directory.join(&image_name))
                .map_err(|error| StudioError::io("failed to copy replacement image", error))?;
            theme.image = image_name;
        } else {
            let image_path = managed_image_path(&theme_directory, &theme.image)?;
            validate_image(&image_path)?;
        }
        atomic_json::write_json(&theme_directory.join("theme.json"), &theme)?;
        let managed = self.read(&theme.id)?;
        if managed.theme != theme {
            return Err(StudioError::new(
                "THEME_READBACK_MISMATCH",
                "managed theme did not match after writing",
            ));
        }

        let staging = self
            .canonical_root
            .join(format!(".active-theme.{}.tmp", Uuid::new_v4()));
        fs::create_dir(&staging)
            .map_err(|error| StudioError::io("failed to stage active theme", error))?;
        let staged_result = (|| {
            fs::copy(&managed.image_path, staging.join(&managed.theme.image))
                .map_err(|error| StudioError::io("failed to stage active image", error))?;
            atomic_json::write_json(&staging.join("theme.json"), &managed.theme)?;
            let staged = self.read_from_directory(&staging, Some(&managed.theme.id))?;
            if staged.theme != managed.theme || staged.metadata.sha256 != managed.metadata.sha256 {
                return Err(StudioError::new(
                    "THEME_READBACK_MISMATCH",
                    "staged active theme did not match managed theme",
                ));
            }
            Ok(())
        })();
        if let Err(error) = staged_result {
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }
        replace_directory(&staging, &self.active_theme)?;
        let active = self.read_from_directory(&self.active_theme, Some(&managed.theme.id))?;
        if active.theme != managed.theme || active.metadata.sha256 != managed.metadata.sha256 {
            return Err(StudioError::new(
                "THEME_READBACK_MISMATCH",
                "active theme did not match managed theme",
            ));
        }
        Ok(managed)
    }

    fn read_from_directory(
        &self,
        directory: &Path,
        expected_id: Option<&str>,
    ) -> StudioResult<ThemeDetail> {
        ensure_existing_managed_path(&self.canonical_root, directory)?;
        let json = fs::read_to_string(directory.join("theme.json"))
            .map_err(|error| StudioError::io("failed to read theme document", error))?;
        let theme = ThemeDocument::from_json(&json).map_err(|detail| {
            StudioError::new("THEME_INVALID", "theme document is invalid").with_detail(detail)
        })?;
        if let Some(expected_id) = expected_id {
            if theme.id != expected_id {
                return Err(StudioError::new(
                    "THEME_ID_MISMATCH",
                    "theme ID does not match its managed directory",
                ));
            }
        }
        let image_path = managed_image_path(directory, &theme.image)?;
        let metadata = validate_image(&image_path)?;
        Ok(ThemeDetail {
            is_built_in: is_built_in_id(&theme.id),
            theme,
            image_path,
            metadata,
        })
    }

    fn theme_directory(&self, id: &str) -> StudioResult<PathBuf> {
        validate_id(id)?;
        let path = self.themes.join(id);
        ensure_parent_managed_path(&self.canonical_root, &path)?;
        Ok(path)
    }

    fn migrate_stored_themes(&self) -> StudioResult<()> {
        for entry in fs::read_dir(&self.themes)
            .map_err(|error| StudioError::io("failed to list themes for migration", error))?
        {
            let entry = entry
                .map_err(|error| StudioError::io("failed to list theme for migration", error))?;
            if !entry
                .file_type()
                .map_err(|error| StudioError::io("failed to inspect theme for migration", error))?
                .is_dir()
            {
                continue;
            }
            let id = entry.file_name().to_string_lossy().into_owned();
            self.migrate_theme_directory(&entry.path(), Some(&id))?;
        }
        self.migrate_theme_directory(&self.active_theme, None)
    }

    fn migrate_theme_directory(
        &self,
        directory: &Path,
        expected_id: Option<&str>,
    ) -> StudioResult<()> {
        let theme_path = directory.join("theme.json");
        match fs::metadata(&theme_path) {
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => {
                return Err(StudioError::io(
                    "failed to inspect theme document for migration",
                    error,
                ));
            }
        }
        let original = fs::read_to_string(&theme_path).map_err(|error| {
            StudioError::io("failed to read theme document for migration", error)
        })?;
        let Ok(theme) = ThemeDocument::from_json(&original) else {
            return Ok(());
        };
        if expected_id.is_some_and(|id| theme.id != id) {
            return Ok(());
        }
        let Ok(image_path) = managed_image_path(directory, &theme.image) else {
            return Ok(());
        };
        if validate_image(&image_path).is_err() {
            return Ok(());
        }
        migrate_theme_file(&theme_path)
    }
}

fn migrate_theme_file(path: &Path) -> StudioResult<()> {
    let original = fs::read_to_string(path)
        .map_err(|error| StudioError::io("failed to read theme document for migration", error))?;
    let Ok(theme) = ThemeDocument::from_json(&original) else {
        return Ok(());
    };
    let canonical = serde_json::to_value(&theme).map_err(|error| {
        StudioError::new(
            "THEME_SERIALIZE_FAILED",
            "failed to serialize migrated theme",
        )
        .with_detail(error.to_string())
    })?;
    let original_value: serde_json::Value = serde_json::from_str(&original).map_err(|error| {
        StudioError::json("failed to parse theme document for migration", error)
    })?;
    if canonical != original_value {
        atomic_json::write_json(path, &theme)?;
    }
    Ok(())
}

fn validate_id(id: &str) -> StudioResult<()> {
    let valid = !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'));
    if valid {
        Ok(())
    } else {
        Err(StudioError::new(
            "MANAGED_PATH_INVALID",
            "theme ID is not a safe managed directory name",
        ))
    }
}

fn validate_name(name: &str) -> StudioResult<()> {
    if name.trim().is_empty() || name.chars().count() > 100 {
        Err(StudioError::new(
            "THEME_NAME_INVALID",
            "theme name must contain 1 to 100 characters",
        ))
    } else {
        Ok(())
    }
}

fn managed_image_path(directory: &Path, image: &str) -> StudioResult<PathBuf> {
    let path = Path::new(image);
    if path.components().count() != 1
        || !matches!(path.components().next(), Some(Component::Normal(_)))
    {
        return Err(StudioError::new(
            "MANAGED_PATH_INVALID",
            "theme image must be a managed file name",
        ));
    }
    let destination = directory.join(path);
    ensure_existing_managed_path(directory, &destination)?;
    Ok(destination)
}

fn ensure_parent_managed_path(root: &Path, path: &Path) -> StudioResult<()> {
    let mut existing = path;
    while !existing.exists() {
        existing = existing.parent().ok_or_else(|| {
            StudioError::new(
                "MANAGED_PATH_INVALID",
                "managed path has no existing parent",
            )
        })?;
    }
    ensure_existing_managed_path(root, existing)
}

fn ensure_existing_managed_path(root: &Path, path: &Path) -> StudioResult<()> {
    let canonical = path
        .canonicalize()
        .map_err(|error| StudioError::io("failed to resolve managed path", error))?;
    if !canonical.starts_with(root) {
        return Err(StudioError::new(
            "MANAGED_PATH_INVALID",
            "managed path escapes the Dream Skin root",
        ));
    }
    reject_reparse_point(path)?;
    Ok(())
}

#[cfg(windows)]
fn reject_reparse_point(path: &Path) -> StudioResult<()> {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| StudioError::io("failed to inspect managed path", error))?;
    if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        Err(StudioError::new(
            "MANAGED_PATH_INVALID",
            "managed path cannot use a reparse point",
        ))
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn reject_reparse_point(path: &Path) -> StudioResult<()> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| StudioError::io("failed to inspect managed path", error))?;
    if metadata.file_type().is_symlink() {
        Err(StudioError::new(
            "MANAGED_PATH_INVALID",
            "managed path cannot use a symbolic link",
        ))
    } else {
        Ok(())
    }
}

fn replace_directory(staging: &Path, destination: &Path) -> StudioResult<()> {
    let backup = destination.with_file_name(format!(".active-theme.{}.bak", Uuid::new_v4()));
    if destination.exists() {
        fs::rename(destination, &backup)
            .map_err(|error| StudioError::io("failed to preserve previous active theme", error))?;
    }
    if let Err(error) = fs::rename(staging, destination) {
        if backup.exists() {
            let _ = fs::rename(&backup, destination);
        }
        return Err(StudioError::io("failed to activate theme", error));
    }
    if backup.exists() {
        fs::remove_dir_all(backup)
            .map_err(|error| StudioError::io("failed to remove previous active theme", error))?;
    }
    Ok(())
}

fn new_theme_id() -> String {
    format!(
        "{}-{}",
        Local::now().format("%Y%m%d-%H%M%S"),
        &Uuid::new_v4().simple().to_string()[..8]
    )
}

fn generated_image_name(extension: &str) -> String {
    format!(
        "art-{}.{}",
        &Uuid::new_v4().simple().to_string()[..8],
        extension
    )
}

fn is_built_in_id(id: &str) -> bool {
    id.starts_with("preset-")
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb};
    use std::{fs, path::Path};
    use tempfile::tempdir;

    fn write_minimal_jpeg(path: &Path, width: u16, height: u16) {
        ImageBuffer::<Rgb<u8>, Vec<u8>>::new(u32::from(width), u32::from(height))
            .save(path)
            .unwrap();
    }

    fn seed_theme(root: &Path, id: &str, name: &str) -> ThemeDocument {
        let directory = root.join("themes").join(id);
        fs::create_dir_all(&directory).unwrap();
        write_minimal_jpeg(&directory.join("art.jpg"), 640, 480);
        let theme = ThemeDocument::default_for(id, name, "art.jpg");
        fs::write(
            directory.join("theme.json"),
            serde_json::to_vec_pretty(&theme).unwrap(),
        )
        .unwrap();
        theme
    }

    #[test]
    fn bootstrap_atomically_migrates_managed_and_active_documents_without_touching_images() {
        let directory = tempdir().unwrap();
        let managed = directory.path().join("themes").join("legacy");
        let active = directory.path().join("active-theme");
        fs::create_dir_all(&managed).unwrap();
        fs::create_dir_all(&active).unwrap();
        for root in [&managed, &active] {
            write_minimal_jpeg(&root.join("art.jpg"), 800, 600);
            fs::write(
                root.join("theme.json"),
                r#"{
                  "schemaVersion":2,"id":"legacy","name":"Legacy","image":"art.jpg",
                  "effects":{"leftSidebarOpacity":0.2,"topBarOpacity":0.4},"quote":"KEEP"
                }"#,
            )
            .unwrap();
        }
        let before_images = [
            fs::read(managed.join("art.jpg")).unwrap(),
            fs::read(active.join("art.jpg")).unwrap(),
        ];

        ThemeRepository::new(directory.path().to_path_buf()).unwrap();

        for (index, root) in [&managed, &active].into_iter().enumerate() {
            let value: serde_json::Value =
                serde_json::from_slice(&fs::read(root.join("theme.json")).unwrap()).unwrap();
            assert_eq!(value["schemaVersion"], 5);
            assert_eq!(value["effects"]["interfaceOpacity"], 0.3);
            assert_eq!(value["effects"]["leftSidebarOpacity"], 0.2);
            assert_eq!(value["effects"]["topBarOpacity"], 0.4);
            assert_eq!(value["effects"]["bottomBarOpacity"], 0.3);
            assert_eq!(value["effects"]["inputOpacity"], 0.9);
            assert_eq!(value["quote"], "KEEP");
            assert_eq!(
                fs::read(root.join("art.jpg")).unwrap(),
                before_images[index]
            );
        }
    }

    #[test]
    fn bootstrap_leaves_damaged_theme_documents_untouched() {
        let directory = tempdir().unwrap();
        let damaged = directory.path().join("themes").join("damaged");
        fs::create_dir_all(&damaged).unwrap();
        let original = b"{ definitely not json";
        fs::write(damaged.join("theme.json"), original).unwrap();

        let repository = ThemeRepository::new(directory.path().to_path_buf()).unwrap();

        assert_eq!(fs::read(damaged.join("theme.json")).unwrap(), original);
        assert!(repository
            .list()
            .unwrap()
            .iter()
            .any(|theme| theme.id == "damaged" && theme.is_damaged));
    }

    #[test]
    fn bootstrap_scans_only_direct_managed_theme_directories() {
        let directory = tempdir().unwrap();
        let direct = directory.path().join("themes").join("direct");
        let nested = direct.join("nested");
        fs::create_dir_all(&nested).unwrap();
        write_minimal_jpeg(&direct.join("art.jpg"), 800, 600);
        write_minimal_jpeg(&nested.join("art.jpg"), 800, 600);
        let direct_legacy = r#"{
          "schemaVersion":2,"id":"direct","name":"Direct","image":"art.jpg",
          "effects":{"sidebarOpacity":0.2,"composerOpacity":0.4}
        }"#;
        let nested_legacy = r#"{
          "schemaVersion":2,"id":"nested","name":"Nested","image":"art.jpg",
          "effects":{"sidebarOpacity":0.2,"composerOpacity":0.4}
        }"#;
        fs::write(direct.join("theme.json"), direct_legacy).unwrap();
        fs::write(nested.join("theme.json"), nested_legacy).unwrap();

        ThemeRepository::new(directory.path().to_path_buf()).unwrap();

        let direct_value: serde_json::Value =
            serde_json::from_slice(&fs::read(direct.join("theme.json")).unwrap()).unwrap();
        let nested_value: serde_json::Value =
            serde_json::from_slice(&fs::read(nested.join("theme.json")).unwrap()).unwrap();
        assert_eq!(direct_value["schemaVersion"], 5);
        assert_eq!(direct_value["effects"]["bottomBarOpacity"], 0.3);
        assert_eq!(direct_value["effects"]["inputOpacity"], 0.4);
        assert_eq!(nested_value["schemaVersion"], 2);
    }

    #[test]
    fn bootstrap_leaves_repository_damaged_theme_documents_untouched() {
        let directory = tempdir().unwrap();
        let themes = directory.path().join("themes");
        let mismatched = themes.join("mismatched");
        let missing_image = themes.join("missing-image");
        let invalid_image = themes.join("invalid-image");
        for root in [&mismatched, &missing_image, &invalid_image] {
            fs::create_dir_all(root).unwrap();
        }
        write_minimal_jpeg(&mismatched.join("art.jpg"), 800, 600);
        fs::write(invalid_image.join("art.jpg"), b"not an image").unwrap();
        let documents = [
            (
                &mismatched,
                r#"{"schemaVersion":2,"id":"wrong","name":"Wrong","image":"art.jpg"}"#,
            ),
            (
                &missing_image,
                r#"{"schemaVersion":2,"id":"missing-image","name":"Missing","image":"art.jpg"}"#,
            ),
            (
                &invalid_image,
                r#"{"schemaVersion":2,"id":"invalid-image","name":"Invalid","image":"art.jpg"}"#,
            ),
        ];
        for (root, document) in documents {
            fs::write(root.join("theme.json"), document).unwrap();
        }
        let before = [&mismatched, &missing_image, &invalid_image]
            .map(|root| fs::read(root.join("theme.json")).unwrap());

        let repository = ThemeRepository::new(directory.path().to_path_buf()).unwrap();

        for (index, root) in [&mismatched, &missing_image, &invalid_image]
            .into_iter()
            .enumerate()
        {
            assert_eq!(fs::read(root.join("theme.json")).unwrap(), before[index]);
        }
        let summaries = repository.list().unwrap();
        for id in ["mismatched", "missing-image", "invalid-image"] {
            assert!(summaries
                .iter()
                .any(|theme| theme.id == id && theme.is_damaged));
        }
    }

    #[test]
    fn bootstrap_returns_theme_document_read_failures() {
        let directory = tempdir().unwrap();
        let theme_document = directory
            .path()
            .join("themes")
            .join("unreadable")
            .join("theme.json");
        fs::create_dir_all(&theme_document).unwrap();

        let error = ThemeRepository::new(directory.path().to_path_buf()).unwrap_err();

        assert_eq!(error.code(), "IO_ERROR");
    }

    #[cfg(windows)]
    #[test]
    #[allow(clippy::permissions_set_readonly_false)]
    fn bootstrap_returns_atomic_write_failures() {
        let directory = tempdir().unwrap();
        let managed = directory.path().join("themes").join("read-only");
        fs::create_dir_all(&managed).unwrap();
        let theme_document = managed.join("theme.json");
        fs::write(
            &theme_document,
            r#"{"schemaVersion":2,"id":"read-only","name":"Read only","image":"art.jpg"}"#,
        )
        .unwrap();
        write_minimal_jpeg(&managed.join("art.jpg"), 800, 600);
        let mut permissions = fs::metadata(&theme_document).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&theme_document, permissions).unwrap();

        let result = ThemeRepository::new(directory.path().to_path_buf());

        let mut permissions = fs::metadata(&theme_document).unwrap().permissions();
        permissions.set_readonly(false);
        fs::set_permissions(&theme_document, permissions).unwrap();
        assert_eq!(result.unwrap_err().code(), "IO_ERROR");
    }

    #[test]
    fn lists_built_in_and_user_themes() {
        let directory = tempdir().unwrap();
        seed_theme(directory.path(), "preset-default", "Default");
        seed_theme(directory.path(), "20260718-120000-deadbeef", "User");
        let repository = ThemeRepository::new(directory.path().to_path_buf()).unwrap();

        let themes = repository.list().unwrap();

        assert_eq!(themes.len(), 2);
        assert!(themes
            .iter()
            .any(|theme| theme.id == "preset-default" && theme.is_built_in));
        assert!(themes
            .iter()
            .any(|theme| theme.name == "User" && !theme.is_built_in));
    }

    #[test]
    fn create_duplicate_rename_and_delete_preserve_managed_images() {
        let directory = tempdir().unwrap();
        let source = directory.path().join("source.jpg");
        write_minimal_jpeg(&source, 800, 600);
        let repository = ThemeRepository::new(directory.path().join("managed")).unwrap();

        let created = repository.create("Original", &source).unwrap();
        assert!(created.theme.image.starts_with("art-"));
        assert!(created.theme.image.ends_with(".jpg"));
        let duplicate = repository.duplicate(&created.theme.id, "Copy").unwrap();
        assert_ne!(created.theme.id, duplicate.theme.id);
        assert_eq!(created.metadata.sha256, duplicate.metadata.sha256);

        let renamed = repository.rename(&duplicate.theme.id, "Renamed").unwrap();
        assert_eq!(renamed.theme.name, "Renamed");
        assert_eq!(renamed.metadata.sha256, created.metadata.sha256);

        repository.delete(&renamed.theme.id).unwrap();
        assert!(repository.read(&renamed.theme.id).is_err());
    }

    #[test]
    fn delete_managed_preset_preserves_the_active_theme_copy() {
        let directory = tempdir().unwrap();
        let theme = seed_theme(directory.path(), "preset-default", "Default");
        let repository = ThemeRepository::new(directory.path().to_path_buf()).unwrap();

        let applied = repository.apply(theme, None).unwrap();
        let active_theme_path = directory.path().join("active-theme").join("theme.json");
        let active_image_path = directory
            .path()
            .join("active-theme")
            .join(&applied.theme.image);
        let active_theme_bytes = fs::read(&active_theme_path).unwrap();
        let active_image_bytes = fs::read(&active_image_path).unwrap();

        repository.delete("preset-default").unwrap();

        assert!(!directory
            .path()
            .join("themes")
            .join("preset-default")
            .exists());
        assert_eq!(fs::read(active_theme_path).unwrap(), active_theme_bytes);
        assert_eq!(fs::read(active_image_path).unwrap(), active_image_bytes);
    }

    #[test]
    fn rejects_theme_ids_that_escape_the_managed_root() {
        let directory = tempdir().unwrap();
        let repository = ThemeRepository::new(directory.path().join("managed")).unwrap();

        assert_eq!(
            repository.read("../outside").unwrap_err().code(),
            "MANAGED_PATH_INVALID"
        );
    }

    #[test]
    fn reads_a_copied_snapshot_of_the_current_yingying_theme_without_mutating_source() {
        let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") else {
            return;
        };
        let source_root = Path::new(&local_app_data).join("CodexDreamSkin");
        let source_theme = source_root.join("themes").join("20260718-102005-ffc6525c");
        if !source_theme.join("theme.json").is_file() {
            return;
        }
        let source_json_before = fs::read(source_theme.join("theme.json")).unwrap();
        let source_image_before = fs::read(source_theme.join("art.jpg")).unwrap();

        let copied = tempdir().unwrap();
        let destination = copied
            .path()
            .join("themes")
            .join("20260718-102005-ffc6525c");
        fs::create_dir_all(&destination).unwrap();
        fs::copy(
            source_theme.join("theme.json"),
            destination.join("theme.json"),
        )
        .unwrap();
        fs::copy(source_theme.join("art.jpg"), destination.join("art.jpg")).unwrap();

        let repository = ThemeRepository::new(copied.path().to_path_buf()).unwrap();
        let detail = repository.read("20260718-102005-ffc6525c").unwrap();
        assert_eq!(detail.theme.name, "萦萦");
        assert_eq!(detail.theme.schema_version, 5);
        let copied_json: serde_json::Value =
            serde_json::from_slice(&fs::read(destination.join("theme.json")).unwrap()).unwrap();
        assert_eq!(copied_json["schemaVersion"], 5);
        assert!(copied_json["effects"]["inputOpacity"].is_number());
        assert_eq!(
            fs::read(source_theme.join("theme.json")).unwrap(),
            source_json_before
        );
        assert_eq!(
            fs::read(source_theme.join("art.jpg")).unwrap(),
            source_image_before
        );
    }
}
