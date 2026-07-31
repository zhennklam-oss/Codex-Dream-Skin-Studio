pub mod commands;
pub mod error;
pub mod model;
pub mod services;
pub mod tray;

use commands::runtime::{
    get_runtime_status, pause_skin, reconcile_runtime, restore_official_appearance, resume_skin,
    start_skin, stop_skin,
};
use commands::settings::{get_app_settings, update_app_settings};
use commands::system::{get_environment_status, open_log_directory};
use commands::themes::{
    apply_theme, choose_image, create_theme, delete_theme, duplicate_theme, list_themes,
    read_theme, rename_theme,
};
use services::{
    bootstrap::synchronize_bundled_engine,
    engine::{EngineRuntime, EngineService},
    paths::StudioPaths,
    settings_repository::SettingsRepository,
    theme_repository::ThemeRepository,
};
use tauri::Manager;
use tray::ExitState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let paths = StudioPaths::discover().expect("failed to discover Dream Skin Studio paths");
    let theme_repository = ThemeRepository::new(paths.dream_skin_root.clone())
        .expect("failed to initialize Dream Skin theme library");
    let runtime = EngineRuntime::new(
        paths.dream_skin_root.join("engine"),
        paths.dream_skin_root.clone(),
    );
    let bootstrap_paths = paths.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .manage(ExitState::default())
        .manage(SettingsRepository::new(paths.settings_file))
        .manage(theme_repository)
        .manage(runtime)
        .setup(move |app| {
            let resource_dir = app.path().resource_dir()?;
            synchronize_bundled_engine(&resource_dir, &bootstrap_paths)?;
            EngineService::retire_legacy_tray()?;
            tray::setup(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_environment_status,
            get_runtime_status,
            reconcile_runtime,
            start_skin,
            pause_skin,
            resume_skin,
            stop_skin,
            restore_official_appearance,
            open_log_directory,
            get_app_settings,
            update_app_settings,
            list_themes,
            read_theme,
            apply_theme,
            create_theme,
            duplicate_theme,
            rename_theme,
            delete_theme,
            choose_image
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Dream Skin Studio");
}
