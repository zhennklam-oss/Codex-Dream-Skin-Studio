use codex_dream_skin_studio_lib::services::atomic_json::write_json;
use serde_json::json;

#[test]
fn writes_utf8_json_and_creates_parent_directories() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("nested").join("settings.json");

    write_json(&path, &json!({ "label": "萦萦" })).unwrap();

    let contents = std::fs::read_to_string(path).unwrap();
    assert!(contents.contains("萦萦"));
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&contents).unwrap(),
        json!({ "label": "萦萦" })
    );
}

#[test]
fn replaces_existing_json_when_writing_the_same_path_twice() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("settings.json");

    write_json(&path, &json!({ "version": 1, "label": "first" })).unwrap();
    write_json(&path, &json!({ "version": 2, "label": "second" })).unwrap();

    let contents = std::fs::read_to_string(&path).unwrap();
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&contents).unwrap(),
        json!({ "version": 2, "label": "second" })
    );
    assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 1);
}

#[test]
fn serialization_failure_preserves_existing_destination() {
    struct FailingValue;

    impl serde::Serialize for FailingValue {
        fn serialize<S>(&self, _serializer: S) -> Result<S::Ok, S::Error>
        where
            S: serde::Serializer,
        {
            Err(serde::ser::Error::custom(
                "intentional serialization failure",
            ))
        }
    }

    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("settings.json");
    std::fs::write(&path, "original").unwrap();

    let result = write_json(&path, &FailingValue);

    assert!(result.is_err());
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "original");
    assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 1);
}
