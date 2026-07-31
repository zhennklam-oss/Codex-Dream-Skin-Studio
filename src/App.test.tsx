// @ts-expect-error Node types are intentionally absent from the frontend build.
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { EnvironmentStatus, RuntimeStatus } from "./lib/commands";
import type { RuntimePollingOptions } from "./lib/runtime-polling";

const convertFileSrc = vi.hoisted(() => vi.fn((path: string) => `asset:${path}`));
const startSingleFlightPolling = vi.hoisted(() => vi.fn((_options: RuntimePollingOptions) => vi.fn()));

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc }));
vi.mock("./lib/runtime-polling", () => ({ startSingleFlightPolling }));

const initialize = vi.fn().mockResolvedValue(true);
const updateDraft = vi.fn();
const draft = {
  schemaVersion: 6 as const,
  id: "yingying",
  name: "萦萦",
  image: "art.jpg",
  appearance: "dark" as const,
  art: { focusX: 0.5, focusY: 0.46, scale: 1, safeArea: "auto" as const, taskMode: "auto" as const },
  effects: {
    homeOpacity: 1,
    taskOpacity: 0.18,
    blur: 0,
    saturation: 1,
    brightness: 1,
    maskStrength: 0.65,
    interfaceOpacity: 0.78,
    leftSidebarOpacity: 0.78,
    topBarOpacity: 0.78,
    rightSidebarOpacity: 0.78,
    bottomBarOpacity: 0.78,
    inputOpacity: 0.9,
    toneMode: "original" as const,
    toneStrength: 1,
    duotoneShadow: "#1C1B22",
    duotoneHighlight: "#F2E9DC",
    washColor: "#7D9FA5",
  },
  extra: {},
};
const storeState = {
  themes: [{ id: "yingying", name: "萦萦", imagePath: "C:\\themes\\yingying\\art.jpg", isBuiltIn: false, isDamaged: false }],
  selected: {
    theme: draft,
    imagePath: "C:\\themes\\yingying\\art.jpg",
    metadata: {
      path: "C:\\themes\\yingying\\art.jpg",
      format: "jpeg",
      width: 3840,
      height: 2160,
      bytes: 8_388_608,
      sha256: "abc",
    },
  } as { theme: typeof draft; imagePath: string; metadata: { path: string; format: string; width: number; height: number; bytes: number; sha256: string } } | null,
  draft: draft as typeof draft | null,
  runtime: {
    codexRunning: true,
    skinActive: true,
    starting: false,
    paused: false,
    port: 9335,
    activeThemeId: "yingying",
    activeThemeName: "萦萦",
    requiresRestartConfirmation: false,
    lastError: null,
  } as RuntimeStatus,
  environment: {
    windowsVersion: "11",
    nodePath: null,
    nodeVersion: null,
    nodeSource: null,
    codexPresent: true,
    codexVersion: "26.707.9981.0",
    engineInstalled: true,
    skinRuntimeReady: false,
    errorCodes: ["NODE_NOT_FOUND"],
  } as EnvironmentStatus,
  error: null as null | { code: string; message: string },
  busyAction: null as string | null,
  dirty: true,
  activationPending: false,
  stagedImage: null as null | { path: string; format: string; width: number; height: number; bytes: number; sha256: string },
  settings: { launchAtLogin: true, autoStartSkin: true, fontPreset: "poster" as const, window: null },
  initialize,
  refreshEnvironment: vi.fn().mockResolvedValue(true),
  refreshRuntime: vi.fn().mockResolvedValue(true),
  startSkin: vi.fn().mockResolvedValue(false),
  pauseSkin: vi.fn().mockResolvedValue(true),
  resumeSkin: vi.fn().mockResolvedValue(true),
  restoreOfficialAppearance: vi.fn().mockResolvedValue(true),
  openLogDirectory: vi.fn().mockResolvedValue(undefined),
  selectTheme: vi.fn().mockResolvedValue("selected"),
  resolvePendingSelection: vi.fn().mockResolvedValue("selected"),
  chooseImage: vi.fn().mockResolvedValue({ path: "image" }),
  createTheme: vi.fn().mockResolvedValue({}),
  duplicateTheme: vi.fn().mockResolvedValue({}),
  renameTheme: vi.fn().mockResolvedValue({}),
  deleteTheme: vi.fn().mockResolvedValue(true),
  applyDraft: vi.fn().mockResolvedValue(true),
  discardDraft: vi.fn(),
  stageDraftImage: vi.fn().mockResolvedValue({ path: "image" }),
  updateDraft,
  saveSettings: vi.fn().mockResolvedValue(true),
  reportExternalError: vi.fn(),
  clearError: vi.fn(),
};

vi.mock("./store/studio-store", () => ({
  useStudioStore: Object.assign(
    (selector: (state: typeof storeState) => unknown) => selector(storeState),
    { getState: () => storeState },
  ),
}));

afterEach(cleanup);

describe("App", () => {
  it("wires Node environment recovery to a fresh detection", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "重新检测环境" }));

    expect(storeState.refreshEnvironment).toHaveBeenCalledOnce();
  });

  it("disables environment recovery while a detection is in flight", () => {
    storeState.busyAction = "refresh-environment";
    render(<App />);
    const retry = screen.getByRole("button", { name: "重新检测环境" });
    storeState.busyAction = null;

    expect(retry).toBeDisabled();
  });

  it("renders the workbench identity", () => {
    render(<App />);
    expect(
      screen.getByRole("heading", { name: "Dream Skin Studio" }),
    ).toBeVisible();
  });

  it("applies the loaded font preset to the application root", () => {
    render(<App />);

    expect(document.documentElement).toHaveAttribute("data-font-preset", "poster");
  });

  it("uses bundled full-CJK font families without a Microsoft YaHei normal-path fallback", () => {
    const css = readFileSync("src/styles/app.css", "utf8");

    expect(css).toContain('font-family: "HarmonyOS Sans SC"');
    expect(css).toContain('font-family: "Smiley Sans"');
    expect(css).toContain('font-family: "Sarasa Mono SC"');
    expect(css).not.toContain("Microsoft YaHei UI");
  });

  it("uses the single-flight runtime poller while a watcher is starting", () => {
    const source = readFileSync("src/App.tsx", "utf8");

    expect(source).toMatch(/startSingleFlightPolling/);
    expect(source).toMatch(/runtime\?\.starting/);
    expect(source).not.toMatch(/setInterval\(/);
  });

  it("starts runtime polling only while starting and idle, then stops it on cleanup", () => {
    const previousRuntime = storeState.runtime;
    const stop = vi.fn();
    startSingleFlightPolling.mockReset();
    startSingleFlightPolling.mockReturnValue(stop);
    storeState.runtime = { ...previousRuntime, starting: true };

    const view = render(<App />);

    expect(startSingleFlightPolling).toHaveBeenCalledOnce();
    expect(startSingleFlightPolling).toHaveBeenCalledWith(expect.objectContaining({
      probe: storeState.refreshRuntime,
    }));
    view.unmount();
    expect(stop).toHaveBeenCalledOnce();

    startSingleFlightPolling.mockClear();
    storeState.busyAction = "start-skin";
    render(<App />);
    expect(startSingleFlightPolling).not.toHaveBeenCalled();

    storeState.busyAction = null;
    storeState.runtime = previousRuntime;
  });

  it("lets the runtime poller observe when starting has ended", () => {
    const previousRuntime = storeState.runtime;
    startSingleFlightPolling.mockReset();
    startSingleFlightPolling.mockReturnValue(vi.fn());
    storeState.runtime = { ...previousRuntime, starting: true };
    render(<App />);

    const options = startSingleFlightPolling.mock.calls[0]?.[0];
    expect(options?.shouldContinue()).toBe(true);

    storeState.runtime = previousRuntime;
    expect(options?.shouldContinue()).toBe(false);
  });

  it("wires runtime transition errors and log access into the shared dialog", async () => {
    const previousRuntime = storeState.runtime;
    const previousEnvironment = storeState.environment;
    const previousError = storeState.error;
    storeState.runtime = {
      ...previousRuntime,
      codexRunning: true,
      skinActive: false,
      requiresRestartConfirmation: true,
    };
    storeState.environment = {
      ...previousEnvironment,
      nodePath: "C:\\Program Files\\nodejs\\node.exe",
      nodeVersion: "24.18.0",
      nodeSource: "external",
      skinRuntimeReady: true,
      errorCodes: [],
    };
    storeState.error = { code: "PROCESS_TIMEOUT", message: "启动超时" };

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "启动皮肤" }));
    fireEvent.click(screen.getByRole("button", { name: "确认重启并启动" }));
    const dialog = await screen.findByRole("dialog", { name: "启动皮肤" });
    expect(within(dialog).getByText("启动超时")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "重试" })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "打开日志" }));

    expect(storeState.openLogDirectory).toHaveBeenCalledOnce();
    storeState.runtime = previousRuntime;
    storeState.environment = previousEnvironment;
    storeState.error = previousError;
  });

  it("applies a selected preset immediately and restores the persisted preset when saving fails", async () => {
    let finishSave: ((saved: boolean) => void) | undefined;
    storeState.saveSettings.mockReturnValueOnce(new Promise<boolean>((resolve) => { finishSave = resolve; }));
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "启动设置" }));
    fireEvent.click(screen.getByRole("radio", { name: "技术等宽" }));

    expect(document.documentElement).toHaveAttribute("data-font-preset", "mono");
    finishSave?.(false);
    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-font-preset", "poster"));
  });

  it("integrates the visual theme library with initialized store themes", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "主题库" })).toBeVisible();
    expect(screen.getByRole("button", { name: /选择主题 萦萦/ })).toBeVisible();
    expect(initialize).toHaveBeenCalled();
  });

  it("converts the selected managed image and integrates the interactive draft preview", () => {
    render(<App />);

    expect(convertFileSrc).toHaveBeenCalledWith("C:\\themes\\yingying\\art.jpg");
    expect(screen.getByRole("application", { name: "Codex 皮肤预览画布" })).toBeVisible();
    expect(screen.getByTestId("preview-artwork")).toHaveStyle({
      backgroundImage: 'url("asset:C:\\themes\\yingying\\art.jpg")',
    });
  });

  it("integrates the enhanced inspector and previews a staged validated image", () => {
    storeState.stagedImage = { path: "C:\\images\\replacement.webp", format: "webp", width: 1920, height: 1080, bytes: 1024, sha256: "abc" };
    render(<App />);

    expect(screen.getByRole("heading", { name: "图片" })).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "构图" }));
    expect(screen.getByRole("slider", { name: "X 位置" })).toBeVisible();
    expect(convertFileSrc).toHaveBeenCalledWith("C:\\images\\replacement.webp");
    storeState.stagedImage = null;
  });

  it("shows a clear preview empty state when no draft is selected", () => {
    const previousDraft = storeState.draft;
    const previousSelected = storeState.selected;
    storeState.draft = null;
    storeState.selected = null;

    render(<App />);
    storeState.draft = previousDraft;
    storeState.selected = previousSelected;

    expect(screen.getByText("选择一个主题以开始预览")).toBeVisible();
  });
});
