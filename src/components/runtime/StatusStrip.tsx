import type { StudioErrorPayload } from "../../lib/commands";
import { presentStudioError } from "./error-presentation";

export interface StatusStripProps {
  error: StudioErrorPayload | null;
  onDismiss(): void;
  onOpenLogs(): void;
  onRetryEnvironment?(): void | Promise<unknown>;
  onRetryStart?(): void | Promise<unknown>;
  environmentRetryBusy?: boolean;
}

export function StatusStrip({ error, onDismiss, onOpenLogs, onRetryEnvironment, onRetryStart, environmentRetryBusy = false }: StatusStripProps) {
  if (!error) return null;
  const presentation = presentStudioError(error);
  return (
    <aside className="runtime-status-strip" role="alert">
      <span className="runtime-status-strip__code">{error.code}</span>
      <p>
        <strong>{presentation.cause}</strong>
        <span>{presentation.guidance}</span>
      </p>
      {presentation.retryEnvironment && onRetryEnvironment && (
        <button type="button" disabled={environmentRetryBusy} onClick={() => void onRetryEnvironment()}>重新检测环境</button>
      )}
      {presentation.retryStart && onRetryStart && (
        <button type="button" onClick={() => void onRetryStart()}>重试启动</button>
      )}
      {presentation.openLogs && <button type="button" onClick={onOpenLogs}>打开日志</button>}
      <button type="button" aria-label="关闭错误" onClick={onDismiss}>×</button>
    </aside>
  );
}
