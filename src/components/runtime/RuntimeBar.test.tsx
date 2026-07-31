import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EnvironmentStatus, RuntimeStatus, StudioErrorPayload } from "../../lib/commands";
import { RuntimeBar } from "./RuntimeBar";
import { StatusStrip } from "./StatusStrip";

const closed: RuntimeStatus = {
  codexRunning: false,
  skinActive: false,
  starting: false,
  paused: false,
  port: null,
  activeThemeId: null,
  activeThemeName: null,
  requiresRestartConfirmation: false,
  lastError: null,
};

const ready: EnvironmentStatus = {
  windowsVersion: "11",
  nodePath: "C:\\Program Files\\nodejs\\node.exe",
  nodeVersion: "22.20.0",
  nodeSource: "external",
  codexPresent: true,
  codexVersion: "26.707.9981.0",
  engineInstalled: true,
  skinRuntimeReady: true,
  errorCodes: [],
};

function renderBar(runtime: RuntimeStatus = closed, overrides: Record<string, unknown> = {}) {
  const props = {
    runtime,
    environment: ready,
    dirty: false,
    busy: false,
    onStart: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onApply: vi.fn(),
    onRestore: vi.fn(),
    ...overrides,
  };
  render(<RuntimeBar {...props} />);
  return props;
}

afterEach(cleanup);

describe("RuntimeBar", () => {
  it("shows whether Studio selected bundled or external Node", () => {
    const { rerender } = render(<RuntimeBar
      runtime={closed}
      environment={{ ...ready, nodeVersion: "24.18.0", nodeSource: "bundled" }}
      dirty={false}
      busy={false}
      onStart={vi.fn()}
      onPause={vi.fn()}
      onResume={vi.fn()}
      onApply={vi.fn()}
      onRestore={vi.fn()}
    />);
    expect(screen.getByText("内置 Node 24.18.0")).toBeVisible();

    rerender(<RuntimeBar
      runtime={closed}
      environment={{ ...ready, nodeVersion: "24.18.0", nodeSource: "external" }}
      dirty={false}
      busy={false}
      onStart={vi.fn()}
      onPause={vi.fn()}
      onResume={vi.fn()}
      onApply={vi.fn()}
      onRestore={vi.fn()}
    />);
    expect(screen.getByText("系统 Node 24.18.0")).toBeVisible();
  });

  it("presents closed, running-normal, active, and paused states with stable commands", () => {
    const { rerender } = render(<RuntimeBar runtime={closed} environment={ready} dirty={false} busy={false} onStart={vi.fn()} onPause={vi.fn()} onResume={vi.fn()} onApply={vi.fn()} onRestore={vi.fn()} />);
    expect(screen.getByText("Codex 已关闭")).toBeVisible();
    expect(screen.getByRole("button", { name: "启动皮肤" })).toBeEnabled();

    rerender(<RuntimeBar runtime={{ ...closed, codexRunning: true, requiresRestartConfirmation: true }} environment={ready} dirty={false} busy={false} onStart={vi.fn()} onPause={vi.fn()} onResume={vi.fn()} onApply={vi.fn()} onRestore={vi.fn()} />);
    expect(screen.getByText("Codex 正常运行")).toBeVisible();

    rerender(<RuntimeBar runtime={{ ...closed, codexRunning: true, starting: true }} environment={ready} dirty={false} busy={false} onStart={vi.fn()} onPause={vi.fn()} onResume={vi.fn()} onApply={vi.fn()} onRestore={vi.fn()} />);
    expect(screen.getByText("正在等待 Codex 界面")).toBeVisible();
    expect(screen.getByRole("button", { name: "启动皮肤" })).toBeDisabled();

    rerender(<RuntimeBar runtime={{ ...closed, codexRunning: true, skinActive: true, activeThemeName: "萦萦" }} environment={ready} dirty={true} busy={false} onStart={vi.fn()} onPause={vi.fn()} onResume={vi.fn()} onApply={vi.fn()} onRestore={vi.fn()} />);
    expect(screen.getByText("皮肤已启动")).toBeVisible();
    expect(screen.getByText("有未应用更改")).toBeVisible();
    expect(screen.getByRole("button", { name: "暂停皮肤" })).toBeEnabled();

    rerender(<RuntimeBar runtime={{ ...closed, codexRunning: true, skinActive: true, paused: true }} environment={ready} dirty={false} busy={false} onStart={vi.fn()} onPause={vi.fn()} onResume={vi.fn()} onApply={vi.fn()} onRestore={vi.fn()} />);
    expect(screen.getByText("皮肤已暂停")).toBeVisible();
    expect(screen.getByRole("button", { name: "恢复皮肤" })).toBeEnabled();
  });

  it("blocks runtime commands while busy or Node is unavailable", () => {
    renderBar(closed, { environment: { ...ready, skinRuntimeReady: false, errorCodes: ["NODE_NOT_FOUND"] }, busy: true });
    expect(screen.getByText("正在处理…")).toBeVisible();
    expect(screen.getByRole("button", { name: "启动皮肤" })).toBeDisabled();
  });

  it("surfaces a runtime verification error state", () => {
    renderBar({ ...closed, lastError: "CDP endpoint did not verify" });
    expect(screen.getByText("运行状态异常")).toBeVisible();
  });

  it("starts without restart confirmation and keeps progress visible until the skin is active", async () => {
    const onStart = vi.fn().mockResolvedValue(true);
    const baseProps = {
      runtime: closed,
      environment: ready,
      dirty: false,
      busy: false,
      onStart,
      onPause: vi.fn(),
      onResume: vi.fn(),
      onApply: vi.fn(),
      onRestore: vi.fn(),
    };
    const { rerender } = render(<RuntimeBar {...baseProps} />);

    fireEvent.click(screen.getByRole("button", { name: "启动皮肤" }));

    expect(onStart).toHaveBeenCalledWith(false);
    expect(screen.getByRole("dialog", { name: "启动皮肤" })).toBeVisible();
    expect(screen.getByRole("button", { name: "正在启动皮肤…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();

    rerender(<RuntimeBar {...baseProps} runtime={{ ...closed, codexRunning: true, skinActive: true }} />);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "启动皮肤" })).not.toBeInTheDocument());
  });

  it("keeps restart progress visible while the watcher waits for the renderer", async () => {
    let finish: ((succeeded: boolean) => void) | undefined;
    const onStart = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const baseProps = {
      environment: ready,
      dirty: false,
      busy: false,
      onStart,
      onPause: vi.fn(),
      onResume: vi.fn(),
      onApply: vi.fn(),
      onRestore: vi.fn(),
    };
    const { rerender } = render(<RuntimeBar
      {...baseProps}
      runtime={{ ...closed, codexRunning: true, requiresRestartConfirmation: true }}
    />);
    fireEvent.click(screen.getByRole("button", { name: "启动皮肤" }));
    expect(screen.getByText(/未发送的输入/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "确认重启并启动" }));
    expect(onStart).toHaveBeenCalledWith(true);
    expect(screen.getByRole("button", { name: "正在重启并启动…" })).toBeDisabled();
    expect(screen.getByRole("dialog", { name: "启动皮肤" })).toBeVisible();

    finish?.(true);
    rerender(<RuntimeBar
      {...baseProps}
      runtime={{ ...closed, codexRunning: true, starting: true }}
    />);
    const waitingDialog = screen.getByRole("dialog", { name: "启动皮肤" });
    expect(within(waitingDialog).getByRole("button", { name: "正在等待 Codex 界面" })).toBeDisabled();

    rerender(<RuntimeBar
      {...baseProps}
      runtime={{ ...closed, codexRunning: true, skinActive: true }}
    />);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "启动皮肤" })).not.toBeInTheDocument());
  });

  it("turns a new polling error into a retryable failure after startup entered the waiting phase", async () => {
    const staleError = { code: "OLD_WARNING", message: "上一次运行的旧错误" };
    const onStart = vi.fn().mockResolvedValue(true);
    const baseProps = {
      environment: ready,
      dirty: false,
      busy: false,
      onStart,
      onPause: vi.fn(),
      onResume: vi.fn(),
      onApply: vi.fn(),
      onRestore: vi.fn(),
    };
    const { rerender } = render(<RuntimeBar
      {...baseProps}
      runtime={{ ...closed, codexRunning: true, requiresRestartConfirmation: true }}
      error={staleError}
    />);
    fireEvent.click(screen.getByRole("button", { name: "启动皮肤" }));
    fireEvent.click(screen.getByRole("button", { name: "确认重启并启动" }));
    await waitFor(() => expect(onStart).toHaveBeenCalledOnce());

    rerender(<RuntimeBar
      {...baseProps}
      runtime={{ ...closed, codexRunning: true, starting: true }}
      error={staleError}
    />);
    expect(screen.getByRole("button", { name: "正在等待 Codex 界面" })).toBeDisabled();

    rerender(<RuntimeBar
      {...baseProps}
      runtime={{ ...closed, codexRunning: true, starting: true }}
      error={{ code: "PROCESS_TIMEOUT", message: "轮询验证超时" }}
    />);
    await waitFor(() => expect(screen.getByText("轮询验证超时")).toBeVisible());
    expect(screen.getByRole("button", { name: "重试" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "打开日志" })).toBeEnabled();
  });

  it("keeps restore visible with progress until official appearance succeeds", async () => {
    let finish: ((succeeded: boolean) => void) | undefined;
    const onRestore = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    renderBar({ ...closed, codexRunning: true, skinActive: true }, { onRestore });
    fireEvent.click(screen.getByRole("button", { name: "恢复官方外观" }));
    expect(screen.getByRole("dialog", { name: "恢复官方外观" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "确认恢复官方外观" }));
    expect(onRestore).toHaveBeenCalledWith(true);
    expect(screen.getByRole("dialog", { name: "恢复官方外观" })).toBeVisible();
    expect(screen.getByRole("button", { name: "正在恢复官方外观…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();

    finish?.(true);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "恢复官方外观" })).not.toBeInTheDocument());
  });

  it("keeps a failed restore open for logs and retries the same official target", async () => {
    const onRestore = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const onOpenLogs = vi.fn();
    renderBar({ ...closed, codexRunning: true, skinActive: true }, {
      onRestore,
      onOpenLogs,
      error: { code: "RESTORE_FAILED", message: "恢复失败" },
    });
    fireEvent.click(screen.getByRole("button", { name: "恢复官方外观" }));
    fireEvent.click(screen.getByRole("button", { name: "确认恢复官方外观" }));

    await waitFor(() => expect(screen.getByText("恢复失败")).toBeVisible());
    fireEvent.click(screen.getByRole("button", { name: "打开日志" }));
    expect(onOpenLogs).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    expect(onRestore).toHaveBeenNthCalledWith(1, true);
    expect(onRestore).toHaveBeenNthCalledWith(2, true);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "恢复官方外观" })).not.toBeInTheDocument());
  });

  it("keeps a failed transition retryable with log access and a close action", async () => {
    const onStart = vi.fn().mockResolvedValue(false);
    const onOpenLogs = vi.fn();
    renderBar({ ...closed, codexRunning: true, requiresRestartConfirmation: true }, {
      onStart,
      onOpenLogs,
      error: { code: "PROCESS_TIMEOUT", message: "启动超时" },
    });

    fireEvent.click(screen.getByRole("button", { name: "启动皮肤" }));
    fireEvent.click(screen.getByRole("button", { name: "确认重启并启动" }));

    await waitFor(() => expect(screen.getByText("启动超时")).toBeVisible());
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("dialog", { name: "启动皮肤" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "启动皮肤" }));
    fireEvent.click(screen.getByRole("button", { name: "确认重启并启动" }));
    await waitFor(() => expect(screen.getByText("启动超时")).toBeVisible());
    const retry = screen.getByRole("button", { name: "重试" });
    expect(retry).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "打开日志" }));
    expect(onOpenLogs).toHaveBeenCalledOnce();

    onStart.mockResolvedValueOnce(true);
    fireEvent.click(retry);
    expect(onStart).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole("button", { name: "正在重启并启动…" })).toBeDisabled();

    await waitFor(() => expect(onStart).toHaveBeenCalledTimes(3));
  });

  it("keeps modal focus inside the dialog and restores focus when confirmation closes", () => {
    renderBar({ ...closed, codexRunning: true, requiresRestartConfirmation: true });
    const trigger = screen.getByRole("button", { name: "启动皮肤" });
    trigger.focus();
    fireEvent.click(trigger);

    const cancel = screen.getByRole("button", { name: "取消" });
    const confirm = screen.getByRole("button", { name: "确认重启并启动" });
    expect(cancel).toHaveFocus();

    confirm.focus();
    fireEvent.keyDown(confirm, { key: "Tab" });
    expect(cancel).toHaveFocus();

    fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
    expect(confirm).toHaveFocus();

    fireEvent.keyDown(confirm, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "启动皮肤" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("bounds dragging to noninteractive brand and readout space and toggles maximize on double-click", () => {
    const onStartDragging = vi.fn();
    const onToggleMaximize = vi.fn();
    const windowControls = <button type="button" aria-label="最小化">_</button>;
    const { container } = render(<RuntimeBar
      runtime={closed}
      environment={ready}
      dirty={false}
      busy={false}
      onStart={vi.fn()}
      onPause={vi.fn()}
      onResume={vi.fn()}
      onApply={vi.fn()}
      onRestore={vi.fn()}
      onStartDragging={onStartDragging}
      onToggleMaximize={onToggleMaximize}
      windowControls={windowControls}
    />);

    const dragRegion = container.querySelector("[data-tauri-drag-region]");
    expect(dragRegion).toHaveClass("runtime-bar__drag-region");
    expect(dragRegion).toContainElement(screen.getByText("Dream Skin Studio"));
    expect(dragRegion).toContainElement(screen.getByText("Codex 已关闭"));
    expect(dragRegion).not.toContainElement(screen.getByRole("button", { name: "启动皮肤" }));
    expect(dragRegion).not.toContainElement(screen.getByRole("button", { name: "最小化" }));

    fireEvent.mouseDown(dragRegion!, { button: 0, detail: 1 });
    expect(onStartDragging).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(dragRegion!, { button: 2, detail: 1 });
    fireEvent.mouseDown(dragRegion!, { button: 0, detail: 2 });
    expect(onStartDragging).toHaveBeenCalledTimes(1);

    fireEvent.doubleClick(dragRegion!);
    expect(onToggleMaximize).toHaveBeenCalledTimes(1);
  });

  it("expands startup settings below the runtime bar and closes them with Escape", () => {
    const settings = <div>Settings content</div>;
    const { container } = render(<RuntimeBar
      runtime={closed}
      environment={ready}
      dirty={false}
      busy={false}
      settings={settings}
      onStart={vi.fn()}
      onPause={vi.fn()}
      onResume={vi.fn()}
      onApply={vi.fn()}
      onRestore={vi.fn()}
    />);

    const toggle = screen.getByRole("button", { name: "启动设置" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);

    const band = screen.getByRole("region", { name: "应用设置" });
    const runtimeBar = container.querySelector(".runtime-bar");
    const runtimeActions = container.querySelector(".runtime-bar__actions");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(runtimeActions).not.toContainElement(band);
    expect(runtimeBar?.nextElementSibling).toBe(band);

    fireEvent.click(toggle);
    expect(screen.queryByRole("region", { name: "应用设置" })).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByRole("region", { name: "应用设置" })).toBeVisible();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "应用设置" })).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});

describe("StatusStrip", () => {
  it("offers environment re-detection for Node discovery failures", () => {
    const onRetryEnvironment = vi.fn();
    render(<StatusStrip
      error={{ code: "NODE_NOT_FOUND", message: "missing" }}
      onDismiss={vi.fn()}
      onOpenLogs={vi.fn()}
      onRetryEnvironment={onRetryEnvironment}
    />);
    fireEvent.click(screen.getByRole("button", { name: "重新检测环境" }));
    expect(onRetryEnvironment).toHaveBeenCalledOnce();
  });

  it("offers environment re-detection for unsupported Node versions", () => {
    const onRetryEnvironment = vi.fn();
    render(<StatusStrip
      error={{ code: "NODE_VERSION_UNSUPPORTED", message: "too old" }}
      onDismiss={vi.fn()}
      onOpenLogs={vi.fn()}
      onRetryEnvironment={onRetryEnvironment}
    />);
    fireEvent.click(screen.getByRole("button", { name: "重新检测环境" }));
    expect(onRetryEnvironment).toHaveBeenCalledOnce();
  });

  it("disables environment re-detection while a probe is already running", () => {
    render(<StatusStrip
      error={{ code: "NODE_NOT_FOUND", message: "missing" }}
      onDismiss={vi.fn()}
      onOpenLogs={vi.fn()}
      onRetryEnvironment={vi.fn()}
      environmentRetryBusy
    />);
    expect(screen.getByRole("button", { name: "重新检测环境" })).toBeDisabled();
  });

  it("maps stable errors to concise Chinese guidance", () => {
    render(<StatusStrip error={{ code: "NODE_NOT_FOUND", message: "node missing" }} onDismiss={vi.fn()} onOpenLogs={vi.fn()} />);
    expect(screen.getByText("未找到 Node.js 22 或更高版本，请先安装或修复 PATH。" )).toBeVisible();
  });

  it("shows unknown backend messages and Open Logs", () => {
    const onOpenLogs = vi.fn();
    const error: StudioErrorPayload = { code: "SOMETHING_NEW", message: "backend detail" };
    render(<StatusStrip error={error} onDismiss={vi.fn()} onOpenLogs={onOpenLogs} />);
    expect(screen.getByText("backend detail")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "打开日志" }));
    expect(onOpenLogs).toHaveBeenCalled();
  });
});
