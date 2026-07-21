import type { StudioErrorPayload } from "../../lib/commands";

const ERROR_MESSAGES: Record<string, string> = {
  NODE_NOT_FOUND: "未找到 Node.js 22 或更高版本，请先安装或修复 PATH。",
  NODE_VERSION_UNSUPPORTED: "Node.js 版本过低，需要 22 或更高版本。",
  CODEX_NOT_FOUND: "未找到官方 Microsoft Store Codex 应用。",
  ENGINE_NOT_INSTALLED: "皮肤引擎尚未安装，请重新安装或修复应用。",
  RESTART_CONFIRMATION_REQUIRED: "启动皮肤前需要确认重启 Codex。",
  RESTORE_CONFIRMATION_REQUIRED: "恢复官方外观需要明确确认。",
  IMAGE_TOO_LARGE: "图片超过 16 MiB 限制，请选择较小文件。",
  IMAGE_DIMENSIONS_TOO_LARGE: "图片尺寸过大，最长边不能超过 16384 像素。",
  IMAGE_PIXEL_COUNT_TOO_LARGE: "图片总像素超过 5000 万限制。",
  IMAGE_FORMAT_UNSUPPORTED: "仅支持 PNG、JPEG 和 WebP 图片。",
  ENGINE_COMMAND_FAILED: "皮肤引擎执行失败，请重试或查看日志。",
  APPLY_FAILED: "应用主题失败，草稿和当前皮肤已保留。",
};

export interface StatusStripProps {
  error: StudioErrorPayload | null;
  onDismiss(): void;
  onOpenLogs(): void;
  onRetryEnvironment?(): void | Promise<unknown>;
  environmentRetryBusy?: boolean;
}

export function StatusStrip({ error, onDismiss, onOpenLogs, onRetryEnvironment, environmentRetryBusy = false }: StatusStripProps) {
  if (!error) return null;
  const known = ERROR_MESSAGES[error.code];
  const canRetryEnvironment = error.code === "NODE_NOT_FOUND" || error.code === "NODE_VERSION_UNSUPPORTED";
  return (
    <aside className="runtime-status-strip" role="alert">
      <span className="runtime-status-strip__code">{error.code}</span>
      <p>{known ?? error.message}</p>
      {canRetryEnvironment && onRetryEnvironment && (
        <button type="button" disabled={environmentRetryBusy} onClick={() => void onRetryEnvironment()}>重新检测环境</button>
      )}
      {!known && <button type="button" onClick={onOpenLogs}>打开日志</button>}
      <button type="button" aria-label="关闭错误" onClick={onDismiss}>×</button>
    </aside>
  );
}
