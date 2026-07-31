import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";

export interface RuntimeTransitionDialogProps {
  mode: "start" | "restore";
  stage: "confirm" | "progress" | "failed";
  requiresRestart?: boolean;
  runtimeStarting?: boolean;
  errorMessage?: string | null;
  onCancel(): void;
  onConfirm(): void;
  onRetry(): void;
  onOpenLogs(): void;
}

export function RuntimeTransitionDialog({
  mode,
  stage,
  requiresRestart = false,
  runtimeStarting = false,
  errorMessage,
  onCancel,
  onConfirm,
  onRetry,
  onOpenLogs,
}: RuntimeTransitionDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus();
    };
  }, []);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const controls = enabledButtons(dialog);
    if (stage === "progress" || controls.length === 0) dialog.focus();
    else controls[0].focus();
  }, [stage]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && stage !== "progress") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const controls = enabledButtons(dialog);
    if (controls.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const title = mode === "start" ? "启动皮肤" : "恢复官方外观";
  const progressLabel = mode === "restore"
    ? "正在恢复官方外观…"
    : runtimeStarting
      ? "正在等待 Codex 界面"
      : requiresRestart
        ? "正在重启并启动…"
        : "正在启动皮肤…";
  const dialogClass = mode === "restore" || stage === "failed"
    ? "runtime-dialog runtime-dialog--danger"
    : "runtime-dialog";

  return (
    <div className="runtime-dialog-backdrop">
      <section
        ref={dialogRef}
        className={dialogClass}
        role="dialog"
        aria-modal="true"
        aria-labelledby="runtime-transition-title"
        aria-busy={stage === "progress"}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <p className="runtime-dialog__index">{dialogIndex(mode, stage)}</p>
        <h2 id="runtime-transition-title">{title}</h2>
        <div aria-live="polite">
          {stage === "confirm" ? (
            <p>{confirmMessage(mode, requiresRestart)}</p>
          ) : stage === "progress" ? (
            <p>{progressLabel}</p>
          ) : (
            <p>{errorMessage || `${title}失败，请重试或打开日志查看详情。`}</p>
          )}
        </div>
        <div className="runtime-dialog__actions">
          {stage === "confirm" ? (
            <>
              <button type="button" className="brutal-button" onClick={onCancel}>取消</button>
              <button
                type="button"
                className={`brutal-button ${mode === "restore" ? "brutal-button--danger" : "brutal-button--primary"}`}
                onClick={onConfirm}
              >
                {mode === "restore" ? "确认恢复官方外观" : "确认重启并启动"}
              </button>
            </>
          ) : stage === "progress" ? (
            <>
              <button type="button" className="brutal-button" disabled>取消</button>
              <button
                type="button"
                className={`brutal-button ${mode === "restore" ? "brutal-button--danger" : "brutal-button--primary"}`}
                disabled
              >
                {progressLabel}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="brutal-button" onClick={onCancel}>关闭</button>
              <button type="button" className="brutal-button" onClick={onOpenLogs}>打开日志</button>
              <button
                type="button"
                className={`brutal-button ${mode === "restore" ? "brutal-button--danger" : "brutal-button--primary"}`}
                onClick={onRetry}
              >
                重试
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function enabledButtons(dialog: HTMLElement): HTMLButtonElement[] {
  return Array.from(dialog.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
}

function dialogIndex(mode: "start" | "restore", stage: "confirm" | "progress" | "failed"): string {
  const action = mode === "start" ? "START" : "RESTORE";
  return `${action} / ${stage.toUpperCase()}`;
}

function confirmMessage(mode: "start" | "restore", requiresRestart: boolean): string {
  if (mode === "restore") {
    return "这会停止 Dream Skin 会话并让 Codex 返回官方外观。主题文件不会被删除。";
  }
  if (requiresRestart) {
    return "Codex 当前以普通模式运行。重启会关闭当前窗口，未发送的输入可能丢失。";
  }
  return "Studio 将启动 Dream Skin，并等待 Codex 界面确认皮肤已生效。";
}
