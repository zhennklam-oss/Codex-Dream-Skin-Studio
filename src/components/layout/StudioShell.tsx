import { useState, type ReactNode } from "react";

export interface StudioShellProps {
  library: ReactNode;
  preview: ReactNode;
  inspector: ReactNode;
  runtime: ReactNode;
}

export function StudioShell({
  library,
  preview,
  inspector,
  runtime,
}: StudioShellProps) {
  const [isInspectorOpen, setInspectorOpen] = useState(false);

  return (
    <main className="studio-shell grid h-full w-full overflow-hidden">
      <section
        aria-label="Runtime Controls"
        className="studio-shell__runtime brutal-surface min-h-0 min-w-0"
      >
        {runtime}
      </section>

      <section
        aria-label="Theme Library"
        className="studio-shell__library brutal-surface min-h-0 min-w-0"
      >
        {library}
      </section>

      <section
        aria-label="Preview Canvas"
        className="studio-shell__preview brutal-surface min-h-0 min-w-0"
      >
        <button
          type="button"
          className="brutal-button brutal-button--secondary studio-shell__inspector-toggle"
          aria-controls="theme-inspector"
          aria-expanded={isInspectorOpen}
          onClick={() => setInspectorOpen((open) => !open)}
        >
          打开主题检查器
        </button>
        {preview}
      </section>

      <section
        id="theme-inspector"
        aria-label="Theme Inspector"
        className="studio-shell__inspector brutal-surface min-h-0 min-w-0"
        data-drawer-open={isInspectorOpen}
      >
        <button
          type="button"
          className="brutal-button brutal-button--quiet studio-shell__inspector-close"
          onClick={() => setInspectorOpen(false)}
        >
          关闭主题检查器
        </button>
        {inspector}
      </section>

      {isInspectorOpen ? (
        <button
          type="button"
          className="studio-shell__drawer-scrim"
          aria-label="关闭主题检查器背景"
          tabIndex={-1}
          onClick={() => setInspectorOpen(false)}
        />
      ) : null}
    </main>
  );
}
