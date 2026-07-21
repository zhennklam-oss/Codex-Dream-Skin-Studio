use crate::error::{StudioError, StudioResult};
use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

pub trait StartupService {
    fn sync(&self, enabled: bool) -> StudioResult<()>;
}

pub struct TauriStartupService<'app> {
    app: &'app AppHandle,
}

impl<'app> TauriStartupService<'app> {
    pub fn new(app: &'app AppHandle) -> Self {
        Self { app }
    }
}

impl StartupService for TauriStartupService<'_> {
    fn sync(&self, enabled: bool) -> StudioResult<()> {
        let autostart = self.app.autolaunch();
        let result = if enabled {
            autostart.enable()
        } else {
            autostart.disable()
        };
        result.map_err(|error| {
            StudioError::new(
                "STARTUP_SYNC_FAILED",
                "failed to synchronize sign-in startup registration",
            )
            .with_detail(error.to_string())
        })
    }
}
