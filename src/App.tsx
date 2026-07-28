import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { StudioShell } from "./components/layout/StudioShell";
import { PreviewCanvas } from "./components/preview/PreviewCanvas";
import { ThemeInspector } from "./components/inspector/ThemeInspector";
import { ThemeLibrary } from "./components/themes/ThemeLibrary";
import { RuntimeBar } from "./components/runtime/RuntimeBar";
import { StatusStrip } from "./components/runtime/StatusStrip";
import { StartupSettings } from "./components/settings/StartupSettings";
import { WindowControls } from "./components/window/WindowControls";
import { useStudioStore } from "./store/studio-store";
import type { StudioErrorPayload } from "./lib/commands";
import type { AppSettings } from "./domain/settings";
import { startSingleFlightPolling } from "./lib/runtime-polling";
import { windowControlClient } from "./lib/window-controls";
import "./styles/app.css";

export function App() {
  const [requestedDialog, setRequestedDialog] = useState<"restart" | "restore" | null>(null);
  const themes = useStudioStore((state) => state.themes);
  const selected = useStudioStore((state) => state.selected);
  const draft = useStudioStore((state) => state.draft);
  const runtime = useStudioStore((state) => state.runtime);
  const environment = useStudioStore((state) => state.environment);
  const settings = useStudioStore((state) => state.settings);
  const error = useStudioStore((state) => state.error);
  const busyAction = useStudioStore((state) => state.busyAction);
  const dirty = useStudioStore((state) => state.dirty);
  const activationPending = useStudioStore((state) => state.activationPending);
  const stagedImage = useStudioStore((state) => state.stagedImage);
  const initialize = useStudioStore((state) => state.initialize);
  const refreshEnvironment = useStudioStore((state) => state.refreshEnvironment);
  const selectTheme = useStudioStore((state) => state.selectTheme);
  const resolvePendingSelection = useStudioStore((state) => state.resolvePendingSelection);
  const chooseImage = useStudioStore((state) => state.chooseImage);
  const createTheme = useStudioStore((state) => state.createTheme);
  const duplicateTheme = useStudioStore((state) => state.duplicateTheme);
  const renameTheme = useStudioStore((state) => state.renameTheme);
  const deleteTheme = useStudioStore((state) => state.deleteTheme);
  const applyDraft = useStudioStore((state) => state.applyDraft);
  const discardDraft = useStudioStore((state) => state.discardDraft);
  const stageDraftImage = useStudioStore((state) => state.stageDraftImage);
  const updateDraft = useStudioStore((state) => state.updateDraft);
  const startSkin = useStudioStore((state) => state.startSkin);
  const pauseSkin = useStudioStore((state) => state.pauseSkin);
  const resumeSkin = useStudioStore((state) => state.resumeSkin);
  const restoreOfficialAppearance = useStudioStore((state) => state.restoreOfficialAppearance);
  const refreshRuntime = useStudioStore((state) => state.refreshRuntime);
  const openLogDirectory = useStudioStore((state) => state.openLogDirectory);
  const saveSettings = useStudioStore((state) => state.saveSettings);
  const reportExternalError = useStudioStore((state) => state.reportExternalError);
  const clearError = useStudioStore((state) => state.clearError);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => {
    document.documentElement.dataset.fontPreset = settings?.fontPreset ?? "industrial";
  }, [settings?.fontPreset]);

  useEffect(() => {
    if (!runtime?.starting || busyAction !== null) return;
    return startSingleFlightPolling({
      probe: refreshRuntime,
      shouldContinue: () => useStudioStore.getState().runtime?.starting ?? false,
    });
  }, [busyAction, refreshRuntime, runtime?.starting]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const unlisteners = [
      listen("tray-start-requested", () => setRequestedDialog("restart")),
      listen("tray-restore-requested", () => setRequestedDialog("restore")),
      listen("tray-apply-requested", () => void applyDraft()),
      listen("runtime-status-changed", () => void refreshRuntime()),
      listen<StudioErrorPayload>("runtime-command-error", ({ payload }) => reportExternalError(payload)),
    ];
    return () => { void Promise.all(unlisteners).then((items) => items.forEach((unlisten) => unlisten())); };
  }, [applyDraft, refreshRuntime, reportExternalError]);

  const runtimeError = !error && runtime?.lastError
    ? { code: "RUNTIME_STATUS_ERROR", message: runtime.lastError }
    : null;
  const environmentError = !error && !runtimeError && environment?.errorCodes[0]
    ? { code: environment.errorCodes[0], message: environment.errorCodes[0] }
    : null;
  const handleSettingsChange = async (nextSettings: AppSettings) => {
    const persistedFontPreset = settings?.fontPreset ?? "industrial";
    document.documentElement.dataset.fontPreset = nextSettings.fontPreset;
    if (!(await saveSettings(nextSettings))) {
      document.documentElement.dataset.fontPreset = persistedFontPreset;
    }
  };
  const reportWindowControlError = (error: unknown) => reportExternalError({
    code: "WINDOW_CONTROL_FAILED",
    message: error instanceof Error ? error.message : String(error),
  });
  const hasPendingChanges = dirty || activationPending;
  const resolvedError = error ?? runtimeError ?? environmentError;

  return (
    <StudioShell
      runtime={
        <>
          <RuntimeBar
            runtime={runtime}
            environment={environment}
            dirty={hasPendingChanges}
            busy={busyAction !== null}
            error={resolvedError}
            requestedDialog={requestedDialog}
            onDialogHandled={() => setRequestedDialog(null)}
            onStart={startSkin}
            onPause={pauseSkin}
            onResume={resumeSkin}
            onApply={applyDraft}
            onRestore={restoreOfficialAppearance}
            onOpenLogs={openLogDirectory}
            onStartDragging={() => windowControlClient.startDragging().catch(reportWindowControlError)}
            onToggleMaximize={() => windowControlClient.toggleMaximize().catch(reportWindowControlError)}
            windowControls={<WindowControls client={windowControlClient} reportExternalError={reportExternalError} />}
            settings={settings ? <StartupSettings settings={settings} busy={busyAction === "save-settings"} onChange={handleSettingsChange} /> : null}
          />
          <StatusStrip
            error={resolvedError}
            onDismiss={clearError}
            onOpenLogs={openLogDirectory}
            onRetryEnvironment={refreshEnvironment}
            onRetryStart={() => setRequestedDialog("restart")}
            environmentRetryBusy={busyAction === "refresh-environment"}
          />
        </>
      }
      library={
        <ThemeLibrary
          themes={themes}
          selectedThemeId={selected?.theme.id ?? null}
          activeThemeId={runtime?.activeThemeId ?? null}
          busy={busyAction !== null}
          onSelect={selectTheme}
          onResolveSelection={resolvePendingSelection}
          onImport={async (name, sourceImage) => {
            if (!(await chooseImage(sourceImage))) return false;
            return (await createTheme(name, sourceImage)) !== null;
          }}
          onDuplicate={async (id, name) => (await duplicateTheme(id, name)) !== null}
          onRename={async (id, name) => (await renameTheme(id, name)) !== null}
          onDelete={deleteTheme}
          onReplaceImage={async (theme, sourceImage) => {
            if (selected?.theme.id !== theme.id) {
              const result = await selectTheme(theme.id);
              if (result !== "selected") return false;
            }
            return (await stageDraftImage(sourceImage)) !== null;
          }}
        />
      }
      preview={draft && (stagedImage?.path ?? selected?.imagePath) ? (
        <PreviewCanvas
          theme={draft}
          imageUrl={convertFileSrc(stagedImage?.path ?? selected!.imagePath)}
          imageMetadata={stagedImage ?? selected!.metadata}
          onFocusChange={(focusX, focusY) => updateDraft({ art: { focusX, focusY } })}
          onScaleChange={(scale) => updateDraft({ art: { scale } })}
        />
      ) : (
        <div className="preview-empty-state" role="status">
          <p className="workbench-placeholder__index">02 / LIVE PREVIEW</p>
          <h2>选择一个主题以开始预览</h2>
          <p>主题图片和参数将在这里即时显示，不会写入 Codex。</p>
        </div>
      )}
      inspector={draft && selected ? (
        <ThemeInspector
          draft={draft}
          imagePath={selected.imagePath}
          imageMetadata={selected.metadata}
          stagedImage={stagedImage}
          dirty={hasPendingChanges}
          canDiscard={dirty}
          busy={busyAction !== null}
          onUpdateDraft={updateDraft}
          onStageImage={stageDraftImage}
          onApply={applyDraft}
          onDiscard={discardDraft}
        />
      ) : (
        <div className="workbench-placeholder"><p className="workbench-placeholder__index">03</p><h2 className="workbench-placeholder__title">Theme Inspector</h2></div>
      )}
    />
  );
}
