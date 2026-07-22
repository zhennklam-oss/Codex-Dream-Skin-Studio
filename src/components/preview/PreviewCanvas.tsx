import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import type { ThemeDocument } from "../../domain/theme";
import type { ImageMetadata } from "../../lib/commands";
import {
  calculateCropGeometry,
  cropOffsetToFocus,
  dragCrop,
  focusToCropOffset,
  type CropGeometry,
  type CropOffset,
} from "./crop-geometry";
import { buildPreviewStyle, stepPreviewScale, type PreviewMode } from "./preview-style";
import { focusToPosition } from "./position-math";
import { buildToneStyle } from "./tone-style";

export interface PreviewCanvasProps {
  theme: ThemeDocument;
  imageUrl: string;
  imageMetadata: ImageMetadata;
  onFocusChange(focusX: number, focusY: number): void;
  onScaleChange(scale: number): void;
}

export function PreviewCanvas({ theme, imageUrl, imageMetadata, onFocusChange, onScaleChange }: PreviewCanvasProps) {
  const [mode, setMode] = useState<PreviewMode>("home");
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);
  const draggingPointer = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    offset: CropOffset;
    geometry: CropGeometry;
  } | null>(null);
  const style = buildPreviewStyle(theme, mode);
  const toneStyle = buildToneStyle(theme.effects);
  const artworkPosition = focusToPosition(theme.art.focusX, theme.art.focusY);
  const cropGeometry = useMemo(
    () => calculateCropGeometry(imageMetadata, viewport, theme.art.scale),
    [imageMetadata.height, imageMetadata.width, theme.art.scale, viewport],
  );
  const cropOffset = focusToCropOffset(
    { focusX: theme.art.focusX, focusY: theme.art.focusY },
    cropGeometry,
  );
  const fixedAxes = cropGeometry.renderedWidth > 0
    ? [
        cropGeometry.maxOffsetX === 0 ? "X 轴固定居中" : null,
        cropGeometry.maxOffsetY === 0 ? "Y 轴固定居中" : null,
      ].filter((value): value is string => value !== null)
    : [];
  const artworkStyle: CSSProperties = {
    backgroundImage: `url("${imageUrl}")`,
    width: `${cropGeometry.renderedWidth}px`,
    height: `${cropGeometry.renderedHeight}px`,
    left: "50%",
    top: "50%",
    transform: `translate(calc(-50% + ${cropOffset.x}px), calc(-50% + ${cropOffset.y}px))`,
    opacity: style.opacity,
    filter: style.filter,
    ...toneStyle.variables,
  };
  const gridStyle = {
    gridTemplateAreas:
      '"title title title" "nav route right" "nav main right" "nav composer right" "nav bottom right"',
    "--preview-interface-opacity": String(style.interfaceOpacity),
    "--preview-left-opacity": String(style.leftSidebarOpacity),
    "--preview-top-opacity": String(style.topBarOpacity),
    "--preview-right-opacity": String(style.rightSidebarOpacity),
    "--preview-bottom-opacity": String(style.bottomBarOpacity),
    "--preview-input-opacity": String(style.inputOpacity),
  } as CSSProperties;

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const updateViewport = (width: number, height: number) => {
      setViewport((current) => current.width === width && current.height === height
        ? current
        : { width, height });
    };
    const bounds = canvas.getBoundingClientRect();
    updateViewport(bounds.width, bounds.height);

    if (typeof ResizeObserver === "undefined") {
      const handleResize = () => {
        const nextBounds = canvas.getBoundingClientRect();
        updateViewport(nextBounds.width, nextBounds.height);
      };
      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }

    const observer = new ResizeObserver(([entry]) => {
      if (entry) updateViewport(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (cropGeometry.renderedWidth <= 0 || cropGeometry.renderedHeight <= 0) return;
    const clampedFocus = cropOffsetToFocus(cropOffset, cropGeometry);
    if (
      Math.abs(clampedFocus.focusX - theme.art.focusX) > 0.000_001
      || Math.abs(clampedFocus.focusY - theme.art.focusY) > 0.000_001
    ) {
      onFocusChange(clampedFocus.focusX, clampedFocus.focusY);
    }
  }, [cropGeometry, cropOffset.x, cropOffset.y, onFocusChange, theme.art.focusX, theme.art.focusY]);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    draggingPointer.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      offset: cropOffset,
      geometry: cropGeometry,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = draggingPointer.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const nextOffset = dragCrop(
      drag.offset,
      { x: event.clientX - drag.clientX, y: event.clientY - drag.clientY },
      drag.geometry,
    );
    const next = cropOffsetToFocus(nextOffset, drag.geometry);
    onFocusChange(next.focusX, next.focusY);
  };

  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (draggingPointer.current?.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    draggingPointer.current = null;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleWheel = (event: globalThis.WheelEvent) => {
      if (event.deltaY === 0) return;
      event.preventDefault();
      onScaleChange(stepPreviewScale(theme.art.scale, event.deltaY));
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [onScaleChange, theme.art.scale]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const pixelStep = event.shiftKey ? 10 : 2;
    let delta: CropOffset | null = null;
    if (event.key === "ArrowLeft") delta = { x: -pixelStep, y: 0 };
    if (event.key === "ArrowRight") delta = { x: pixelStep, y: 0 };
    if (event.key === "ArrowUp") delta = { x: 0, y: -pixelStep };
    if (event.key === "ArrowDown") delta = { x: 0, y: pixelStep };
    if (delta) {
      event.preventDefault();
      const nextFocus = cropOffsetToFocus(dragCrop(cropOffset, delta, cropGeometry), cropGeometry);
      onFocusChange(nextFocus.focusX, nextFocus.focusY);
      return;
    }
    if (["+", "=", "-", "_"].includes(event.key)) {
      event.preventDefault();
      onScaleChange(stepPreviewScale(theme.art.scale, event.key === "+" || event.key === "=" ? -1 : 1));
    }
  };

  return (
    <div className="preview-workbench">
      <header className="preview-workbench__header">
        <div>
          <p className="preview-workbench__index">02 / LIVE PREVIEW</p>
          <h2>{theme.name}</h2>
        </div>
        <div className="preview-mode-tabs" role="tablist" aria-label="预览页面">
          <button type="button" role="tab" aria-selected={mode === "home"} onClick={() => setMode("home")}>主页</button>
          <button type="button" role="tab" aria-selected={mode === "task"} onClick={() => setMode("task")}>任务页</button>
        </div>
      </header>

      <div className="preview-stage">
        <div
          ref={canvasRef}
          className="preview-canvas"
          role="application"
          aria-label="Codex 皮肤预览画布"
          aria-describedby="preview-canvas-help"
          tabIndex={0}
          data-appearance={theme.appearance}
          data-mode={mode}
          data-task-mode={theme.art.taskMode}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onDoubleClick={() => onFocusChange(0.5, 0.5)}
          onKeyDown={handleKeyDown}
        >
          <div
            data-testid="preview-artwork-layer"
            data-full-canvas="true"
            className="preview-art-layer"
            aria-hidden="true"
          >
            <div data-testid="preview-artwork" className="preview-artwork" style={artworkStyle}>
              <div
                data-testid="preview-tone-grayscale"
                data-active={toneStyle.grayscaleVisible}
                className="preview-tone-layer preview-tone-grayscale"
              />
              <div
                data-testid="preview-tone-duotone"
                data-active={toneStyle.duotoneVisible}
                className="preview-tone-layer preview-tone-duotone"
              >
                <span className="preview-tone-duotone__shadow" />
                <span className="preview-tone-duotone__highlight" />
              </div>
              <div
                data-testid="preview-tone-wash"
                data-active={toneStyle.washVisible}
                className="preview-tone-layer preview-tone-wash"
              />
            </div>
          </div>
          <div data-testid="preview-mask" className="preview-mask" aria-hidden="true" style={{ opacity: style.maskStrength }} />

          <div data-testid="preview-codex-grid" className="preview-codex-grid" style={gridStyle}>
            <header data-testid="preview-title-bar" data-transparent="true" className="preview-title-bar">
              <span>CODEX</span>
              <small>LOCAL</small>
            </header>

            <nav
              data-testid="preview-left-navigation"
              data-starts-below-title-bar="true"
              className="preview-left-navigation"
              aria-label="模拟 Codex 侧栏"
            >
              <strong>CODEX</strong>
              <span className="preview-left-navigation__new">＋ 新任务</span>
              <span>主页</span>
              <span>任务</span>
              <span>工作区</span>
              <i />
              <small>本地工作区</small>
              <span>Dream Skin Studio</span>
            </nav>

            <section data-testid="preview-route-header" className="preview-route-header">
              <span>{mode === "home" ? "主页" : "任务"}</span>
              <small>{theme.name}</small>
            </section>

            <main data-testid="preview-main-content" className="preview-main-content" aria-live="polite">
              {mode === "home" ? <HomeSimulation /> : <TaskSimulation taskMode={theme.art.taskMode} />}
            </main>

            <aside
              data-testid="preview-right-panel"
              className="preview-right-panel"
              aria-label="模拟 Codex 审阅面板"
            >
              <header><span>审阅</span><small>TOGGLE REVIEW PANEL</small></header>
              <div><span>theme.ts</span><span>+18 −4</span></div>
              <div><span>renderer-inject.js</span><span>+32 −2</span></div>
            </aside>

            <section
              data-testid="preview-bottom-panel"
              className="preview-bottom-panel"
              aria-label="模拟 Codex 终端面板"
            >
              <header><span>TERMINAL</span><small>TOGGLE BOTTOM PANEL</small></header>
              <code>PS C:\Projects\Codex&gt;</code>
            </section>

            <section data-testid="preview-composer" className="preview-composer" aria-label="模拟 Codex 输入框">
              <span>向 Codex 发送消息</span>
              <span className="preview-composer__send">↑</span>
            </section>
          </div>
        </div>
      </div>

      <footer id="preview-canvas-help" className="preview-workbench__help">
        拖动图片改变位置 · 双击恢复居中 · 滚轮缩放 · 方向键移动
        {fixedAxes.length > 0 ? (
          <span data-testid="preview-crop-limits" className="preview-crop-limits">{fixedAxes.join(" · ")}</span>
        ) : null}
        <output>X {artworkPosition.x} / Y {artworkPosition.y} / {theme.art.scale.toFixed(2)}×</output>
      </footer>
    </div>
  );
}

function HomeSimulation() {
  return (
    <section className="preview-home" aria-label="模拟 Codex 主页">
      <p>CODEX DESKTOP</p>
      <h3>开始一个任务</h3>
      <div className="preview-suggestions">
        <span>解释这个代码库</span>
        <span>检查最近的更改</span>
        <span>规划下一项工作</span>
      </div>
    </section>
  );
}

function TaskSimulation({ taskMode }: { taskMode: ThemeDocument["art"]["taskMode"] }) {
  return (
    <section className="preview-task" aria-label="模拟 Codex 任务页">
      <header><span>TASK</span><small>{taskMode === "off" ? "背景已关闭" : "LOCAL PREVIEW"}</small></header>
      <div
        data-testid="preview-task-activity"
        className="preview-task-activity"
        aria-label="匿名任务活动占位"
      >
        <span className="preview-activity-label">ACTIVITY</span>
        <span className="preview-activity-line" />
        <span className="preview-activity-line preview-activity-line--medium" />
        <span className="preview-activity-line preview-activity-line--short" />
      </div>
    </section>
  );
}
