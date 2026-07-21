import { beforeEach, describe, expect, it, vi } from "vitest";

const windowApi = vi.hoisted(() => ({
  minimize: vi.fn(),
  startDragging: vi.fn(),
  toggleMaximize: vi.fn(),
  isMaximized: vi.fn(),
  close: vi.fn(),
  onResized: vi.fn(),
}));
const getCurrentWindow = vi.hoisted(() => vi.fn(() => windowApi));

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow }));

import { windowControlClient } from "./window-controls";

describe("windowControlClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    windowApi.minimize.mockResolvedValue(undefined);
    windowApi.startDragging.mockResolvedValue(undefined);
    windowApi.toggleMaximize.mockResolvedValue(undefined);
    windowApi.isMaximized.mockResolvedValue(false);
    windowApi.close.mockResolvedValue(undefined);
  });

  it("forwards dragging and window controls once to the current window", async () => {
    await windowControlClient.minimize();
    await windowControlClient.startDragging();
    await windowControlClient.toggleMaximize();
    await expect(windowControlClient.isMaximized()).resolves.toBe(false);
    await windowControlClient.close();

    expect(getCurrentWindow).toHaveBeenCalledTimes(5);
    expect(windowApi.minimize).toHaveBeenCalledTimes(1);
    expect(windowApi.startDragging).toHaveBeenCalledTimes(1);
    expect(windowApi.toggleMaximize).toHaveBeenCalledTimes(1);
    expect(windowApi.isMaximized).toHaveBeenCalledTimes(1);
    expect(windowApi.close).toHaveBeenCalledTimes(1);
  });

  it("forwards resize subscriptions and returns the native unlisten function", async () => {
    const handler = vi.fn();
    const unlisten = vi.fn();
    windowApi.onResized.mockResolvedValue(unlisten);

    await expect(windowControlClient.onResized(handler)).resolves.toBe(unlisten);
    expect(getCurrentWindow).toHaveBeenCalledTimes(1);
    expect(windowApi.onResized).toHaveBeenCalledTimes(1);
    expect(windowApi.onResized).toHaveBeenCalledWith(expect.any(Function));

    windowApi.onResized.mock.calls[0][0]({ payload: { width: 1280, height: 820 } });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
