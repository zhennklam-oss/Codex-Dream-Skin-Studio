import { useEffect, useRef, useState, type ReactNode } from "react";

import type { EnvironmentStatus, RuntimeStatus, StudioErrorPayload } from "../../lib/commands";
import { RuntimeTransitionDialog } from "./RuntimeTransitionDialog";

type Transition = {
  mode: "start" | "restore";
  stage: "confirm" | "progress" | "failed";
  confirmRestart: boolean;
} | null;

interface ActiveAttempt {
  mode: "start" | "restore";
  baselineError: string | null;
  sawErrorClear: boolean;
  waitingForTarget: boolean;
}

export interface RuntimeBarProps {
  runtime: RuntimeStatus | null;
  environment: EnvironmentStatus | null;
  dirty: boolean;
  busy: boolean;
  error?: StudioErrorPayload | null;
  requestedDialog?: "restart" | "restore" | null;
  settings?: ReactNode;
  windowControls?: ReactNode;
  onDialogHandled?(): void;
  onStartDragging?(): void | Promise<unknown>;
  onToggleMaximize?(): void | Promise<unknown>;
  onStart(confirmRestart: boolean): boolean | Promise<boolean>;
  onPause(): void | Promise<unknown>;
  onResume(): void | Promise<unknown>;
  onApply(): void | Promise<unknown>;
  onRestore(confirmed: boolean): boolean | Promise<boolean>;
  onOpenLogs?(): void | Promise<unknown>;
}

export function RuntimeBar({ runtime, environment, dirty, busy, error = null, requestedDialog = null, settings, windowControls, onDialogHandled, onStartDragging, onToggleMaximize, onStart, onPause, onResume, onApply, onRestore, onOpenLogs }: RuntimeBarProps) {
  const [transition, setTransition] = useState<Transition>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const latestErrorRef = useRef(error);
  const activeAttemptRef = useRef<ActiveAttempt | null>(null);
  latestErrorRef.current = error;
  useEffect(() => {
    if (requestedDialog === "restart") {
      setTransition({ mode: "start", stage: "confirm", confirmRestart: true });
    } else if (requestedDialog === "restore") {
      setTransition({ mode: "restore", stage: "confirm", confirmRestart: false });
    }
  }, [requestedDialog]);
  useEffect(() => {
    if (transition?.mode !== "start" || transition.stage !== "progress" || !runtime?.skinActive) return;
    activeAttemptRef.current = null;
    setTransition(null);
    onDialogHandled?.();
  }, [onDialogHandled, runtime?.skinActive, transition?.mode, transition?.stage]);
  useEffect(() => {
    const attempt = activeAttemptRef.current;
    const currentError = errorSignature(error);
    if (attempt && currentError === null) attempt.sawErrorClear = true;
    if (
      transition?.mode === "start"
      && transition.stage === "progress"
      && attempt?.mode === "start"
      && attempt.waitingForTarget
      && isNewAttemptError(attempt, currentError)
    ) {
      setTransition((current) => current?.mode === "start" && current.stage === "progress"
        ? { ...current, stage: "failed" }
        : current);
    }
  }, [error, transition?.mode, transition?.stage]);
  useEffect(() => {
    if (!settingsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettingsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [settingsOpen]);

  const runtimeReady = environment?.skinRuntimeReady ?? false;
  const active = runtime?.skinActive ?? false;
  const starting = runtime?.starting ?? false;
  const paused = runtime?.paused ?? false;
  const stateLabel = busy ? "正在处理…" : runtimeLabel(runtime);
  const closeDialog = () => {
    activeAttemptRef.current = null;
    setTransition(null);
    onDialogHandled?.();
  };
  const runTransition = async (mode: "start" | "restore", confirmRestart: boolean) => {
    activeAttemptRef.current = {
      mode,
      baselineError: errorSignature(latestErrorRef.current),
      sawErrorClear: latestErrorRef.current === null,
      waitingForTarget: false,
    };
    setTransition({ mode, stage: "progress", confirmRestart });
    let succeeded = false;
    try {
      succeeded = mode === "start"
        ? await onStart(confirmRestart)
        : await onRestore(true);
    } catch {
      succeeded = false;
    }

    if (!succeeded) {
      setTransition((current) => current?.mode === mode && current.stage === "progress"
        ? { ...current, stage: "failed" }
        : current);
      return;
    }
    if (mode === "start") {
      const attempt = activeAttemptRef.current;
      if (attempt?.mode === "start") {
        attempt.waitingForTarget = true;
        if (isNewAttemptError(attempt, errorSignature(latestErrorRef.current))) {
          setTransition((current) => current?.mode === "start" && current.stage === "progress"
            ? { ...current, stage: "failed" }
            : current);
        }
      }
      return;
    }
    if (mode === "restore") {
      activeAttemptRef.current = null;
      setTransition((current) => current?.mode === "restore" && current.stage === "progress" ? null : current);
      onDialogHandled?.();
    }
  };
  const requestStart = () => {
    const confirmRestart = runtime?.requiresRestartConfirmation ?? false;
    if (confirmRestart) {
      setTransition({ mode: "start", stage: "confirm", confirmRestart: true });
    } else {
      void runTransition("start", false);
    }
  };

  return (
    <>
      <div className="runtime-bar">
        <div
          className="runtime-bar__drag-region"
          data-tauri-drag-region
          onMouseDown={(event) => {
            if (event.button === 0 && event.detail === 1) void onStartDragging?.();
          }}
          onDoubleClick={() => void onToggleMaximize?.()}
        >
          <div className="runtime-bar__brand">
            <p>01 / RUNTIME</p>
            <h1>Dream Skin Studio</h1>
          </div>
          <div className="runtime-bar__readouts" aria-live="polite">
            <strong>{stateLabel}</strong>
            <span>{runtime?.activeThemeName ?? "未选择主题"}</span>
            {environment?.nodeVersion && environment.nodeSource && (
              <span>{environment.nodeSource === "bundled" ? "内置" : "系统"} Node {environment.nodeVersion}</span>
            )}
            <span className="runtime-bar__dirty" data-dirty={dirty}>{dirty ? "有未应用更改" : "更改已同步"}</span>
          </div>
        </div>
        <div className="runtime-bar__actions">
          <button type="button" className="brutal-button" disabled={busy || active || starting || !runtimeReady} onClick={requestStart}>启动皮肤</button>
          <button type="button" className="brutal-button" disabled={busy || !active} onClick={() => void (paused ? onResume() : onPause())}>{paused ? "恢复皮肤" : "暂停皮肤"}</button>
          <button type="button" className="brutal-button brutal-button--primary" disabled={busy || !dirty} onClick={() => void onApply()}>应用更改</button>
          <button type="button" className="brutal-button brutal-button--danger" disabled={busy} onClick={() => setTransition({ mode: "restore", stage: "confirm", confirmRestart: false })}>恢复官方外观</button>
          {settings && (
            <button
              type="button"
              className="runtime-settings-toggle"
              aria-expanded={settingsOpen}
              aria-controls="runtime-settings-band"
              onClick={() => setSettingsOpen((open) => !open)}
            >
              {settingsOpen ? "收起设置" : "启动设置"}
            </button>
          )}
        </div>
        {windowControls}
      </div>
      {settings && settingsOpen ? (
        <section id="runtime-settings-band" className="runtime-settings-band" aria-label="应用设置">
          {settings}
        </section>
      ) : null}
      {transition && (
        <RuntimeTransitionDialog
          mode={transition.mode}
          stage={transition.stage}
          requiresRestart={transition.confirmRestart}
          runtimeStarting={runtime?.starting ?? false}
          errorMessage={error?.message ?? runtime?.lastError}
          onCancel={closeDialog}
          onConfirm={() => void runTransition(transition.mode, transition.confirmRestart)}
          onRetry={() => void runTransition(transition.mode, transition.confirmRestart)}
          onOpenLogs={() => void onOpenLogs?.()}
        />
      )}
    </>
  );
}

function errorSignature(error: StudioErrorPayload | null | undefined): string | null {
  return error ? `${error.code}\u0000${error.message}` : null;
}

function isNewAttemptError(attempt: ActiveAttempt, currentError: string | null): boolean {
  return currentError !== null && (attempt.sawErrorClear || currentError !== attempt.baselineError);
}

function runtimeLabel(runtime: RuntimeStatus | null): string {
  if (!runtime) return "正在读取状态";
  if (runtime.starting) return "正在等待 Codex 界面";
  if (runtime.lastError) return "运行状态异常";
  if (runtime.paused) return "皮肤已暂停";
  if (runtime.skinActive) return "皮肤已启动";
  if (runtime.codexRunning) return "Codex 正常运行";
  return "Codex 已关闭";
}
