use crate::{
    error::{StudioError, StudioResult},
    services::engine::{EngineRuntime, RuntimeStatus},
};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    App, AppHandle, Emitter, Manager, WindowEvent,
};

pub const TRAY_MENU_IDS: [&str; 6] = ["open", "start", "pause_resume", "apply", "restore", "quit"];
pub const TRAY_START_REQUESTED: &str = "tray-start-requested";
pub const TRAY_APPLY_REQUESTED: &str = "tray-apply-requested";
pub const TRAY_RESTORE_REQUESTED: &str = "tray-restore-requested";
const RUNTIME_STATUS_CHANGED: &str = "runtime-status-changed";
const RUNTIME_COMMAND_ERROR: &str = "runtime-command-error";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeAction {
    Start,
    Pause,
    Resume,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayDispatch {
    None,
    Show,
    ShowAndEmit(&'static str),
    Runtime(RuntimeAction),
    Quit,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MenuResolution {
    Dispatch(TrayDispatch),
    Error(StudioError),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseDecision {
    Hide,
    AllowClose,
}

#[derive(Debug, Clone, Default)]
pub struct ExitState(Arc<AtomicBool>);

impl ExitState {
    pub fn request(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn is_requested(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

pub fn close_decision(exit_requested: bool) -> CloseDecision {
    if exit_requested {
        CloseDecision::AllowClose
    } else {
        CloseDecision::Hide
    }
}

pub fn tray_dispatch(id: &str, status: &RuntimeStatus) -> TrayDispatch {
    match id {
        "open" => TrayDispatch::Show,
        "start" if status.skin_active => TrayDispatch::None,
        "start" if status.requires_restart_confirmation => {
            TrayDispatch::ShowAndEmit(TRAY_START_REQUESTED)
        }
        "start" => TrayDispatch::Runtime(RuntimeAction::Start),
        "pause_resume" if status.skin_active && status.paused => {
            TrayDispatch::Runtime(RuntimeAction::Resume)
        }
        "pause_resume" if status.skin_active => TrayDispatch::Runtime(RuntimeAction::Pause),
        "pause_resume" => TrayDispatch::None,
        "apply" => TrayDispatch::ShowAndEmit(TRAY_APPLY_REQUESTED),
        "restore" => TrayDispatch::ShowAndEmit(TRAY_RESTORE_REQUESTED),
        "quit" => TrayDispatch::Quit,
        _ => TrayDispatch::None,
    }
}

pub fn resolve_menu(id: &str, status: StudioResult<RuntimeStatus>) -> MenuResolution {
    if !menu_requires_status(id) {
        return MenuResolution::Dispatch(tray_dispatch(id, &RuntimeStatus::default()));
    }
    match status {
        Ok(status) => MenuResolution::Dispatch(tray_dispatch(id, &status)),
        Err(error) => MenuResolution::Error(error),
    }
}

fn menu_requires_status(id: &str) -> bool {
    matches!(id, "start" | "pause_resume")
}

pub fn setup(app: &mut App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, TRAY_MENU_IDS[0], "打开面板", true, None::<&str>)?;
    let start = MenuItem::with_id(app, TRAY_MENU_IDS[1], "启动皮肤", true, None::<&str>)?;
    let pause_resume = MenuItem::with_id(app, TRAY_MENU_IDS[2], "暂停 / 恢复", true, None::<&str>)?;
    let apply = MenuItem::with_id(app, TRAY_MENU_IDS[3], "应用当前主题", true, None::<&str>)?;
    let restore = MenuItem::with_id(app, TRAY_MENU_IDS[4], "恢复官方外观", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, TRAY_MENU_IDS[5], "彻底退出", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&open, &start, &pause_resume, &apply, &restore, &quit],
    )?;

    let mut tray = TrayIconBuilder::new()
        .menu(&menu)
        .on_menu_event(|app, event| {
            handle_menu_event(app, event.id().as_ref());
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;

    if let Some(window) = app.get_webview_window("main") {
        let close_window = window.clone();
        let handle = app.handle().clone();
        window.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let exit = handle.state::<ExitState>();
                if close_decision(exit.is_requested()) == CloseDecision::Hide {
                    api.prevent_close();
                    let _ = close_window.hide();
                }
            }
        });
    }
    Ok(())
}

fn handle_menu_event(app: &AppHandle, id: &str) {
    let status = if menu_requires_status(id) {
        app.state::<EngineRuntime>().get_runtime_status()
    } else {
        Ok(RuntimeStatus::default())
    };
    let dispatch = match resolve_menu(id, status) {
        MenuResolution::Dispatch(dispatch) => dispatch,
        MenuResolution::Error(error) => {
            show_main_window(app);
            let _ = app.emit(RUNTIME_COMMAND_ERROR, error);
            return;
        }
    };
    match dispatch {
        TrayDispatch::None => {}
        TrayDispatch::Show => show_main_window(app),
        TrayDispatch::ShowAndEmit(event) => {
            show_main_window(app);
            let _ = app.emit(event, ());
        }
        TrayDispatch::Runtime(action) => {
            let handle = app.clone();
            tauri::async_runtime::spawn(async move {
                let runtime = handle.state::<EngineRuntime>();
                let result = match action {
                    RuntimeAction::Start => runtime.start_skin(false).await,
                    RuntimeAction::Pause => runtime.pause_skin().await,
                    RuntimeAction::Resume => runtime.resume_skin().await,
                };
                match result {
                    Ok(status) => {
                        let _ = handle.emit(RUNTIME_STATUS_CHANGED, status);
                    }
                    Err(error) => {
                        let _ = handle.emit(RUNTIME_COMMAND_ERROR, error);
                    }
                }
            });
        }
        TrayDispatch::Quit => {
            app.state::<ExitState>().request();
            app.exit(0);
        }
    }
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::engine::RuntimeStatus;

    fn status() -> RuntimeStatus {
        RuntimeStatus::default()
    }

    #[test]
    fn tray_menu_ids_are_stable() {
        assert_eq!(
            TRAY_MENU_IDS,
            ["open", "start", "pause_resume", "apply", "restore", "quit"]
        );
    }

    #[test]
    fn dispatch_never_bypasses_restart_or_restore_confirmation() {
        let restart = RuntimeStatus {
            codex_running: true,
            requires_restart_confirmation: true,
            ..status()
        };
        assert_eq!(
            tray_dispatch("start", &restart),
            TrayDispatch::ShowAndEmit(TRAY_START_REQUESTED)
        );
        assert_eq!(
            tray_dispatch("restore", &status()),
            TrayDispatch::ShowAndEmit(TRAY_RESTORE_REQUESTED)
        );
        assert_eq!(
            tray_dispatch("apply", &status()),
            TrayDispatch::ShowAndEmit(TRAY_APPLY_REQUESTED)
        );
    }

    #[test]
    fn pause_resume_dispatches_against_current_runtime_state() {
        let active = RuntimeStatus {
            skin_active: true,
            ..status()
        };
        let paused = RuntimeStatus {
            skin_active: true,
            paused: true,
            ..status()
        };
        assert_eq!(
            tray_dispatch("pause_resume", &active),
            TrayDispatch::Runtime(RuntimeAction::Pause)
        );
        assert_eq!(
            tray_dispatch("pause_resume", &paused),
            TrayDispatch::Runtime(RuntimeAction::Resume)
        );
    }

    #[test]
    fn failed_status_probe_never_dispatches_start_or_pause_resume_runtime_actions() {
        for id in ["start", "pause_resume"] {
            let error = crate::error::StudioError::new(
                "RUNTIME_STATUS_FAILED",
                "runtime status could not be verified",
            );
            assert_eq!(
                resolve_menu(id, Err(error.clone())),
                MenuResolution::Error(error)
            );
        }
    }

    #[test]
    fn close_hides_until_explicit_quit_sets_exit_flag() {
        let exit = ExitState::default();
        assert_eq!(close_decision(exit.is_requested()), CloseDecision::Hide);
        exit.request();
        assert_eq!(
            close_decision(exit.is_requested()),
            CloseDecision::AllowClose
        );
    }
}
