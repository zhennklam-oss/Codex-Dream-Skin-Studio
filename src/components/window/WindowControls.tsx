import { useEffect, useState } from "react";

import type { StudioErrorPayload } from "../../lib/commands";
import { windowControlClient, type WindowControlClient } from "../../lib/window-controls";

export interface WindowControlsProps {
  client?: WindowControlClient;
  reportExternalError(error: StudioErrorPayload): void;
}

type WindowAction = "minimize" | "maximize" | "close";

export function WindowControls({ client = windowControlClient, reportExternalError }: WindowControlsProps) {
  const [maximized, setMaximized] = useState(false);
  const [busyAction, setBusyAction] = useState<WindowAction | null>(null);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    const refresh = async () => {
      try {
        const next = await client.isMaximized();
        if (active) setMaximized(next);
      } catch (error) {
        if (active) reportExternalError(toWindowControlError(error));
      }
    };

    const subscribe = async () => {
      try {
        const dispose = await client.onResized(refresh);
        if (active) unlisten = dispose;
        else dispose();
      } catch (error) {
        if (active) reportExternalError(toWindowControlError(error));
      }
    };

    void refresh();
    void subscribe();

    return () => {
      active = false;
      unlisten?.();
    };
  }, [client, reportExternalError]);

  const run = async (action: WindowAction, operation: () => Promise<void>) => {
    setBusyAction(action);
    try {
      await operation();
      if (action === "maximize") setMaximized(await client.isMaximized());
    } catch (error) {
      reportExternalError(toWindowControlError(error));
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="window-controls" aria-label="窗口控制">
      <button
        type="button"
        className="window-control"
        aria-label="最小化"
        disabled={busyAction !== null}
        onClick={() => void run("minimize", () => client.minimize())}
      >
        <svg aria-hidden="true" viewBox="0 0 12 12"><path d="M2 8.5h8" /></svg>
      </button>
      <button
        type="button"
        className="window-control"
        aria-label={maximized ? "还原" : "最大化"}
        disabled={busyAction !== null}
        onClick={() => void run("maximize", () => client.toggleMaximize())}
      >
        {maximized ? (
          <svg aria-hidden="true" viewBox="0 0 12 12"><path d="M3.5 4.5h5v5h-5zM5 2.5h4.5V7" /></svg>
        ) : (
          <svg aria-hidden="true" viewBox="0 0 12 12"><path d="M2.5 2.5h7v7h-7z" /></svg>
        )}
      </button>
      <button
        type="button"
        className="window-control window-control--close"
        aria-label="关闭到托盘"
        disabled={busyAction !== null}
        onClick={() => void run("close", () => client.close())}
      >
        <svg aria-hidden="true" viewBox="0 0 12 12"><path d="m3 3 6 6m0-6L3 9" /></svg>
      </button>
    </div>
  );
}

function toWindowControlError(error: unknown): StudioErrorPayload {
  return {
    code: "WINDOW_CONTROL_FAILED",
    message: error instanceof Error ? error.message : String(error),
  };
}
