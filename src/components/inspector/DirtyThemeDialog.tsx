import { useEffect, useRef } from "react";

import type { DirtyResolution } from "../../store/studio-store";

export interface DirtyThemeDialogProps {
  busy: boolean;
  onResolve(resolution: DirtyResolution): void | Promise<void>;
}

export function DirtyThemeDialog({ busy, onResolve }: DirtyThemeDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <div className="library-dialog__backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && void onResolve("cancel")}>
      <section
        ref={dialogRef}
        className="library-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="未应用的更改"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) void onResolve("cancel");
        }}
      >
        <header className="library-dialog__header">
          <h3>未应用的更改</h3>
          <button type="button" disabled={busy} aria-label="关闭未应用的更改" onClick={() => void onResolve("cancel")}>×</button>
        </header>
        <p>当前主题还有未应用的调整。先处理这些更改，再切换主题。</p>
        <div className="library-dialog__actions library-dialog__actions--three">
          <button type="button" className="brutal-button brutal-button--quiet" disabled={busy} onClick={() => void onResolve("cancel")}>取消</button>
          <button type="button" className="brutal-button theme-action--danger" disabled={busy} onClick={() => void onResolve("discard")}>放弃更改</button>
          <button type="button" className="brutal-button brutal-button--secondary" disabled={busy} onClick={() => void onResolve("apply")}>应用并切换</button>
        </div>
      </section>
    </div>
  );
}
