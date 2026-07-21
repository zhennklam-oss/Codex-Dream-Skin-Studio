import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StudioErrorPayload } from "../../lib/commands";
import type { WindowControlClient } from "../../lib/window-controls";
import { WindowControls } from "./WindowControls";

function createClient(maximized = false) {
  let resizeHandler: (() => void) | null = null;
  const client: WindowControlClient = {
    minimize: vi.fn().mockResolvedValue(undefined),
    startDragging: vi.fn().mockResolvedValue(undefined),
    toggleMaximize: vi.fn().mockResolvedValue(undefined),
    isMaximized: vi.fn().mockResolvedValue(maximized),
    close: vi.fn().mockResolvedValue(undefined),
    onResized: vi.fn(async (handler) => {
      resizeHandler = handler;
      return vi.fn();
    }),
  };
  return { client, resize: () => resizeHandler?.() };
}

afterEach(cleanup);

describe("WindowControls", () => {
  it("offers accessible non-draggable minimize, maximize, and close-to-tray buttons", async () => {
    const { client } = createClient();
    render(<WindowControls client={client} reportExternalError={vi.fn()} />);

    const minimize = screen.getByRole("button", { name: "最小化" });
    const maximize = await screen.findByRole("button", { name: "最大化" });
    const close = screen.getByRole("button", { name: "关闭到托盘" });
    for (const button of [minimize, maximize, close]) {
      expect(button).not.toHaveAttribute("data-tauri-drag-region");
    }

    fireEvent.click(minimize);
    await waitFor(() => expect(client.minimize).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(minimize).toBeEnabled());
    fireEvent.click(maximize);
    await waitFor(() => expect(client.toggleMaximize).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(maximize).toBeEnabled());
    fireEvent.click(close);
    await waitFor(() => expect(client.close).toHaveBeenCalledTimes(1));
  });

  it("refreshes maximize state after resize and exposes the restore label", async () => {
    const { client, resize } = createClient();
    render(<WindowControls client={client} reportExternalError={vi.fn()} />);
    await screen.findByRole("button", { name: "最大化" });

    vi.mocked(client.isMaximized).mockResolvedValue(true);
    resize();

    expect(await screen.findByRole("button", { name: "还原" })).toBeVisible();
    expect(client.isMaximized).toHaveBeenCalledTimes(2);
  });

  it("reports native failures without leaving a window button busy", async () => {
    const { client } = createClient();
    const reportExternalError = vi.fn<(error: StudioErrorPayload) => void>();
    vi.mocked(client.minimize).mockRejectedValue(new Error("native minimize failed"));
    render(<WindowControls client={client} reportExternalError={reportExternalError} />);

    const minimize = screen.getByRole("button", { name: "最小化" });
    fireEvent.click(minimize);
    await waitFor(() => expect(reportExternalError).toHaveBeenCalledWith({
      code: "WINDOW_CONTROL_FAILED",
      message: "native minimize failed",
    }));
    expect(minimize).toBeEnabled();
  });

  it("reports a synchronous native resize subscription failure", async () => {
    const { client } = createClient();
    const reportExternalError = vi.fn<(error: StudioErrorPayload) => void>();
    vi.mocked(client.onResized).mockImplementation(() => {
      throw new Error("native window unavailable");
    });

    render(<WindowControls client={client} reportExternalError={reportExternalError} />);

    await waitFor(() => expect(reportExternalError).toHaveBeenCalledWith({
      code: "WINDOW_CONTROL_FAILED",
      message: "native window unavailable",
    }));
  });
});
