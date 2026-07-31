use crate::{
    error::StudioResult,
    services::engine::{EngineRuntime, RuntimeStatus},
};
use tauri::State;

#[tauri::command]
pub fn get_runtime_status(runtime: State<'_, EngineRuntime>) -> StudioResult<RuntimeStatus> {
    runtime.get_runtime_status()
}

#[tauri::command]
pub async fn reconcile_runtime(runtime: State<'_, EngineRuntime>) -> StudioResult<RuntimeStatus> {
    runtime.reconcile_runtime().await
}

#[tauri::command]
pub async fn start_skin(
    runtime: State<'_, EngineRuntime>,
    confirm_restart: bool,
) -> StudioResult<RuntimeStatus> {
    runtime.start_skin(confirm_restart).await
}

#[tauri::command]
pub async fn pause_skin(runtime: State<'_, EngineRuntime>) -> StudioResult<RuntimeStatus> {
    runtime.pause_skin().await
}

#[tauri::command]
pub async fn resume_skin(runtime: State<'_, EngineRuntime>) -> StudioResult<RuntimeStatus> {
    runtime.resume_skin().await
}

#[tauri::command]
pub async fn stop_skin(runtime: State<'_, EngineRuntime>) -> StudioResult<RuntimeStatus> {
    runtime.stop_skin().await
}

#[tauri::command]
pub async fn restore_official_appearance(
    runtime: State<'_, EngineRuntime>,
    confirmed: bool,
) -> StudioResult<RuntimeStatus> {
    runtime.restore_official_appearance(confirmed).await
}
