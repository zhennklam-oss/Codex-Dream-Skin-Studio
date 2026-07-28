import type { StudioErrorPayload } from "../../lib/commands";

export interface ErrorPresentation {
  cause: string;
  guidance: string;
  retryEnvironment?: boolean;
  retryStart?: boolean;
  openLogs?: boolean;
}

const IMAGE_PIXEL_LIMIT_PRESENTATION: ErrorPresentation = {
  cause: "图片总像素超过 5000 万。",
  guidance: "请降低图片分辨率后重新导入。",
};

const PRESENTATIONS: Record<string, ErrorPresentation> = {
  NODE_NOT_FOUND: {
    cause: "未找到可用的 Node.js 运行环境。",
    guidance: "请重新检测环境；如果仍失败，请重新安装 Studio。",
    retryEnvironment: true,
  },
  NODE_VERSION_UNSUPPORTED: {
    cause: "检测到的 Node.js 版本不受支持。",
    guidance: "请重新检测环境；Studio 会优先使用内置运行时。",
    retryEnvironment: true,
  },
  CODEX_NOT_FOUND: {
    cause: "未找到官方 Microsoft Store Codex 应用。",
    guidance: "请先安装或更新官方 Codex，然后重新检测环境。",
  },
  ENGINE_NOT_INSTALLED: {
    cause: "皮肤引擎未正确安装。",
    guidance: "请重新安装 Studio；现有主题和图片不会被删除。",
    openLogs: true,
  },
  RESTART_CONFIRMATION_REQUIRED: {
    cause: "启动皮肤需要重新启动 Codex。",
    guidance: "请确认已保存未发送的输入，然后在确认窗口中继续。",
  },
  RESTORE_CONFIRMATION_REQUIRED: {
    cause: "恢复官方外观需要再次确认。",
    guidance: "确认后 Studio 会停止受管皮肤会话并重新打开 Codex。",
  },
  IMAGE_TOO_LARGE: {
    cause: "图片文件超过 16 MiB 限制。",
    guidance: "请压缩图片或选择较小的 PNG、JPEG 或 WebP 文件。",
  },
  IMAGE_DIMENSIONS_TOO_LARGE: {
    cause: "图片尺寸超过支持范围。",
    guidance: "请将最长边缩小到 16384 像素以内。",
  },
  IMAGE_TOO_MANY_PIXELS: IMAGE_PIXEL_LIMIT_PRESENTATION,
  IMAGE_PIXEL_COUNT_TOO_LARGE: IMAGE_PIXEL_LIMIT_PRESENTATION,
  IMAGE_FORMAT_UNSUPPORTED: {
    cause: "图片格式不受支持。",
    guidance: "请选择 PNG、JPEG 或 WebP 图片。",
  },
  CODEX_STOP_TIMEOUT: {
    cause: "Codex 后台进程仍在退出，皮肤未能启动。",
    guidance: "请等待几秒后重试；如果仍失败，请先完全关闭 Codex。",
    retryStart: true,
    openLogs: true,
  },
  CDP_ENDPOINT_TIMEOUT: {
    cause: "Codex 未能建立皮肤连接。",
    guidance: "请关闭 Codex 后重新启动皮肤；若再次失败，请打开日志。",
    retryStart: true,
    openLogs: true,
  },
  PORT_IN_USE: {
    cause: "皮肤连接端口被其他程序占用。",
    guidance: "请关闭占用程序或重新启动电脑后再试。",
    retryStart: true,
    openLogs: true,
  },
  ENGINE_COMMAND_FAILED: {
    cause: "皮肤引擎未完成操作。",
    guidance: "请重试；如果再次出现，请打开日志。",
    openLogs: true,
  },
  RUNTIME_TARGET_NOT_REACHED: {
    cause: "命令已结束，但皮肤没有达到请求的状态。",
    guidance: "请重新检测运行状态；如果仍失败，请打开日志。",
    openLogs: true,
  },
  PROCESS_TIMEOUT: {
    cause: "皮肤操作等待超时。",
    guidance: "请等待 Codex 完成加载后重试；如果再次超时，请打开日志。",
    openLogs: true,
  },
  APPLY_FAILED: {
    cause: "主题更改未能应用。",
    guidance: "草稿和当前皮肤已保留，请重新检测状态后再试。",
    openLogs: true,
  },
};

const FALLBACK: ErrorPresentation = {
  cause: "操作未完成。",
  guidance: "请重试；如果再次出现，请打开日志。",
  openLogs: true,
};

export function presentStudioError(error: StudioErrorPayload): ErrorPresentation {
  return PRESENTATIONS[error.code] ?? FALLBACK;
}

export function formatStudioError(error: StudioErrorPayload | null | undefined): string | null {
  if (!error) return null;
  const presentation = presentStudioError(error);
  return `${presentation.cause} ${presentation.guidance}`;
}
