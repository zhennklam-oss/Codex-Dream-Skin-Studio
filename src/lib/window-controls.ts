import { getCurrentWindow, type Window } from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";

export interface WindowControlClient {
  minimize(): Promise<void>;
  startDragging(): Promise<void>;
  toggleMaximize(): Promise<void>;
  isMaximized(): Promise<boolean>;
  close(): Promise<void>;
  onResized(handler: () => void): Promise<UnlistenFn>;
}

export function createWindowControlClient(getWindow: () => Window = getCurrentWindow): WindowControlClient {
  return {
    minimize: () => getWindow().minimize(),
    startDragging: () => getWindow().startDragging(),
    toggleMaximize: () => getWindow().toggleMaximize(),
    isMaximized: () => getWindow().isMaximized(),
    close: () => getWindow().close(),
    onResized: (handler) => getWindow().onResized(() => handler()),
  };
}

export const windowControlClient = createWindowControlClient();
