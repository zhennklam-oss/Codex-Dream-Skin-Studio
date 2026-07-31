use crate::{
    error::StudioResult,
    services::engine::{EngineRuntime, EnvironmentStatus},
};
use tauri::State;

#[tauri::command]
pub fn get_environment_status(runtime: State<'_, EngineRuntime>) -> EnvironmentStatus {
    runtime.get_environment_status()
}

#[tauri::command]
pub fn open_log_directory(runtime: State<'_, EngineRuntime>) -> StudioResult<()> {
    runtime.open_log_directory()
}
