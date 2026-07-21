import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error Node types are intentionally absent from the frontend build.
import { readFileSync } from "node:fs";

import { DEFAULT_EFFECTS, type ThemeDocument } from "../../domain/theme";
import type { ImageMetadata } from "../../lib/commands";
import { PreviewCanvas } from "./PreviewCanvas";
import { buildPreviewStyle, stepPreviewScale } from "./preview-style";

class TestPointerEvent extends MouseEvent {
  pointerId: number;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
  }
}

Object.defineProperty(window, "PointerEvent", { configurable: true, value: TestPointerEvent });

class TestResizeObserver {
  static latest: TestResizeObserver | null = null;
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    TestResizeObserver.latest = this;
  }

  observe() {}
  unobserve() {}
  disconnect = vi.fn();

  emit(target: Element, width: number, height: number) {
    this.callback([
      {
        target,
        contentRect: { width, height } as DOMRectReadOnly,
      } as ResizeObserverEntry,
    ], this as unknown as ResizeObserver);
  }
}

Object.defineProperty(window, "ResizeObserver", { configurable: true, value: TestResizeObserver });

afterEach(cleanup);

const theme: ThemeDocument = {
  schemaVersion: 4,
  id: "yingying",
  name: "萦萦",
  image: "art.jpg",
  appearance: "dark",
  art: {
    focusX: 0.37,
    focusY: 0.68,
    scale: 1.35,
    safeArea: "right",
    taskMode: "ambient",
  },
  effects: {
    ...DEFAULT_EFFECTS,
    homeOpacity: 0.84,
    taskOpacity: 0.42,
    blur: 8,
    saturation: 1.25,
    brightness: 0.9,
    maskStrength: 0.55,
    interfaceOpacity: 0.61,
    leftSidebarOpacity: 0.21,
    topBarOpacity: 0.32,
    rightSidebarOpacity: 0.43,
    bottomBarOpacity: 0.54,
  },
  extra: {},
};

const appCss = readFileSync("src/styles/app.css", "utf8");
const imageMetadata: ImageMetadata = {
  path: "C:\\themes\\yingying\\art.jpg",
  format: "jpeg",
  width: 3840,
  height: 2160,
  bytes: 8_388_608,
  sha256: "abc",
};

function renderPreview(overrides: Partial<React.ComponentProps<typeof PreviewCanvas>> = {}) {
  return render(
    <PreviewCanvas
      theme={theme}
      imageUrl="asset://localhost/yingying.jpg"
      imageMetadata={imageMetadata}
      onFocusChange={vi.fn()}
      onScaleChange={vi.fn()}
      {...overrides}
    />,
  );
}

function resizeCanvas(width = 1296, height = 830) {
  const canvas = screen.getByRole("application");
  act(() => TestResizeObserver.latest?.emit(canvas, width, height));
  return canvas;
}

describe("preview style", () => {
  it("keeps only the structural workbench border and no preview canvas shadow", () => {
    expect(appCss).toContain(".preview-stage");
    const stageRule = appCss.match(/\.preview-stage\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    const canvasRule = appCss.match(/\.preview-canvas\s*\{([\s\S]*?)\}/)?.[1] ?? "";

    expect(stageRule).toContain("border: var(--brutal-border)");
    expect(stageRule).toContain("aspect-ratio: 1296 / 830");
    expect(stageRule).toContain("width: 100%");
    expect(stageRule).not.toMatch(/background:\s*rgb\(30 31 34\)/);
    expect(canvasRule).toContain("width: 100%");
    expect(canvasRule).toContain("height: 100%");
    expect(canvasRule).not.toContain("box-shadow");
    expect(canvasRule).not.toMatch(/\bborder:/);
    const workbenchRule = appCss.match(/\.preview-workbench\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    expect(workbenchRule).not.toContain("minmax(0, 1fr)");
  });

  it("maps every enhanced visual field to exact Home and Task style values", () => {
    expect(buildPreviewStyle(theme, "home")).toEqual({
      opacity: 0.84,
      filter: "blur(8px) saturate(1.25) brightness(0.9)",
      maskStrength: 0.55,
      interfaceOpacity: 0.61,
      leftSidebarOpacity: 0.21,
      topBarOpacity: 0.32,
      rightSidebarOpacity: 0.43,
      bottomBarOpacity: 0.54,
      artworkVisible: true,
    });
    expect(buildPreviewStyle(theme, "task")).toEqual({
      opacity: 0.42,
      filter: "blur(8px) saturate(1.25) brightness(0.9)",
      maskStrength: 0.55,
      interfaceOpacity: 0.61,
      leftSidebarOpacity: 0.21,
      topBarOpacity: 0.32,
      rightSidebarOpacity: 0.43,
      bottomBarOpacity: 0.54,
      artworkVisible: true,
    });
  });

  it("turns Task artwork fully off when taskMode is off", () => {
    expect(
      buildPreviewStyle({ ...theme, art: { ...theme.art, taskMode: "off" } }, "task"),
    ).toMatchObject({ artworkVisible: false, opacity: 0 });
  });

  it("clamps wheel scale to supported ranges", () => {
    expect(stepPreviewScale(2.49, -120)).toBe(2.5);
    expect(stepPreviewScale(1.01, 120)).toBe(1);
    expect(stepPreviewScale(0.5, 120)).toBe(1);
    expect(stepPreviewScale(0.5, -120)).toBe(1.05);
  });
});

describe("PreviewCanvas", () => {
  it("uses one grid with full-window artwork behind a transparent interface", () => {
    const { rerender } = render(
      <PreviewCanvas
        theme={theme}
        imageUrl="asset://localhost/yingying.jpg"
        imageMetadata={imageMetadata}
        onFocusChange={vi.fn()}
        onScaleChange={vi.fn()}
      />,
    );

    const canvas = screen.getByRole("application", { name: "Codex 皮肤预览画布" });
    expect(canvas.firstElementChild).toBe(screen.getByTestId("preview-artwork-layer"));
    expect(screen.getByTestId("preview-artwork-layer")).toHaveAttribute("data-full-canvas", "true");
    expect(screen.getByTestId("preview-title-bar")).toHaveAttribute("data-transparent", "true");
    expect(screen.getByTestId("preview-left-navigation")).toHaveAttribute("data-starts-below-title-bar", "true");
    expect(screen.getByTestId("preview-codex-grid")).toHaveStyle({ "--preview-interface-opacity": "0.61" });

    expect(canvas).toHaveAttribute("data-mode", "home");
    fireEvent.click(screen.getByRole("tab", { name: "任务页" }));
    expect(canvas).toHaveAttribute("data-mode", "task");
    expect(screen.getByTestId("preview-left-navigation")).toHaveAttribute("data-starts-below-title-bar", "true");

    rerender(
      <PreviewCanvas
        theme={{ ...theme, effects: { ...theme.effects, taskOpacity: 0.28 } }}
        imageUrl="asset://localhost/yingying.jpg"
        imageMetadata={imageMetadata}
        onFocusChange={vi.fn()}
        onScaleChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("preview-artwork")).toHaveStyle({ opacity: "0.28" });
  });

  it("uses anonymous task geometry without a fake OS frame or preview shadow hook", async () => {
    const user = userEvent.setup();
    render(
      <PreviewCanvas
        theme={theme}
        imageUrl="asset://localhost/yingying.jpg"
        imageMetadata={imageMetadata}
        onFocusChange={vi.fn()}
        onScaleChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "任务页" }));
    expect(screen.queryByText("检查当前界面并保持主题设置。")).not.toBeInTheDocument();
    expect(screen.queryByText("Dream Skin Preview")).not.toBeInTheDocument();
    expect(screen.getByTestId("preview-task-activity")).toHaveAttribute("aria-label", "匿名任务活动占位");
    expect(screen.getByRole("application", { name: "Codex 皮肤预览画布" })).not.toHaveClass("preview-canvas--shadow");
    expect(document.querySelector(".preview-window-controls")).not.toBeInTheDocument();
  });

  it("switches modes without content-avoidance overlays and renders representative Codex surfaces", async () => {
    const user = userEvent.setup();
    render(
      <PreviewCanvas
        theme={theme}
        imageUrl="asset://localhost/yingying.jpg"
        imageMetadata={imageMetadata}
        onFocusChange={vi.fn()}
        onScaleChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("application", { name: "Codex 皮肤预览画布" })).toBeVisible();
    expect(screen.getByText("开始一个任务")) .toBeVisible();
    expect(screen.queryByTestId("safe-area")).not.toBeInTheDocument();
    expect(screen.queryByTestId("focus-crosshair")).not.toBeInTheDocument();
    expect(screen.getByTestId("preview-codex-grid")).toHaveStyle({ "--preview-interface-opacity": "0.61" });

    await user.click(screen.getByRole("tab", { name: "任务页" }));
    expect(screen.getByTestId("preview-task-activity")).toBeVisible();
    expect(screen.getByTestId("preview-artwork")).toHaveStyle({ opacity: "0.42" });
  });

  it("renders one normal-flow grid without region layers or a right panel", () => {
    renderPreview();

    const grid = screen.getByTestId("preview-codex-grid");
    expect(within(grid).getByTestId("preview-title-bar")).toBeInTheDocument();
    expect(within(grid).getByTestId("preview-left-navigation")).toBeInTheDocument();
    expect(within(grid).getByTestId("preview-route-header")).toBeInTheDocument();
    expect(within(grid).getByTestId("preview-main-content")).toBeInTheDocument();
    expect(within(grid).getByTestId("preview-composer")).toBeInTheDocument();
    expect(grid).toHaveStyle({
      gridTemplateAreas: '"title title" "nav route" "nav main" "nav composer"',
      "--preview-interface-opacity": "0.61",
    });
    expect(Array.from(grid.children).map((element) => element.getAttribute("data-testid"))).toEqual([
      "preview-title-bar",
      "preview-left-navigation",
      "preview-route-header",
      "preview-main-content",
      "preview-composer",
    ]);
    expect(document.querySelector('[class*="preview-region-"]')).toBeNull();
    expect(screen.queryByTestId("preview-right-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("preview-bottom-fade")).not.toBeInTheDocument();
    expect(screen.queryByTestId("preview-bottom-actions")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("preview-title-bar")).getByText("CODEX")).not.toHaveStyle({ opacity: "0.61" });
  });

  it.each([
    ["original", "false", "false", "false"],
    ["grayscale", "true", "false", "false"],
    ["duotone", "true", "true", "false"],
    ["wash", "false", "false", "true"],
  ] as const)("renders the %s tone layer stack before mask", (toneMode, grayscale, duotone, wash) => {
    renderPreview({
      theme: {
        ...theme,
        effects: { ...theme.effects, toneMode, toneStrength: 0.58 },
      },
    });

    const artwork = screen.getByTestId("preview-artwork");
    expect(artwork).toHaveStyle({
      "--preview-tone-strength": "0.58",
      "--preview-duotone-shadow": theme.effects.duotoneShadow,
      "--preview-duotone-highlight": theme.effects.duotoneHighlight,
      "--preview-wash-color": theme.effects.washColor,
    });
    expect(screen.getByTestId("preview-tone-grayscale")).toHaveAttribute("data-active", grayscale);
    expect(screen.getByTestId("preview-tone-duotone")).toHaveAttribute("data-active", duotone);
    expect(screen.getByTestId("preview-tone-wash")).toHaveAttribute("data-active", wash);
    expect(
      screen.getByTestId("preview-artwork-layer").compareDocumentPosition(screen.getByTestId("preview-mask"))
        & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("moves the artwork by exact pointer pixels without a pointer-down jump and clamps at crop bounds", () => {
    const onFocusChange = vi.fn();
    const onScaleChange = vi.fn();
    renderPreview({ onFocusChange, onScaleChange });

    const canvas = screen.getByRole("application", { name: "Codex 皮肤预览画布" });
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    Object.defineProperty(canvas, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 1296, height: 830, right: 1296, bottom: 830, x: 0, y: 0, toJSON: () => ({}) }),
    });
    Object.defineProperty(canvas, "setPointerCapture", { value: setPointerCapture });
    Object.defineProperty(canvas, "releasePointerCapture", { value: releasePointerCapture });
    resizeCanvas();

    const artwork = screen.getByTestId("preview-artwork");
    expect(artwork.style.width).toBe("1992px");
    expect(artwork.style.height).toBe("1120.5px");

    fireEvent.pointerDown(canvas, { pointerId: 7, clientX: 200, clientY: 100 });
    expect(onFocusChange).not.toHaveBeenCalled();
    fireEvent.pointerMove(canvas, { pointerId: 7, clientX: 240, clientY: 120 });
    expect(onFocusChange.mock.lastCall?.[0]).toBeCloseTo(0.3125, 4);
    expect(onFocusChange.mock.lastCall?.[1]).toBeCloseTo(0.6112, 4);
    fireEvent.pointerMove(canvas, { pointerId: 7, clientX: 2200, clientY: 2100 });
    expect(onFocusChange).toHaveBeenLastCalledWith(0, 0);
    fireEvent.pointerUp(canvas, { pointerId: 7 });
    expect(setPointerCapture).toHaveBeenCalledWith(7);
    expect(releasePointerCapture).toHaveBeenCalledWith(7);

    const wheel = new WheelEvent("wheel", { deltaY: -100, cancelable: true });
    canvas.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(onScaleChange).toHaveBeenCalledWith(1.4);
  });

  it("reclamps a cropped axis when scale removes its movement range", () => {
    const onFocusChange = vi.fn();
    const zoomedTheme = { ...theme, art: { ...theme.art, scale: 1.2, focusY: 0 } };
    const { rerender } = renderPreview({ theme: zoomedTheme, onFocusChange });
    resizeCanvas();
    onFocusChange.mockClear();

    rerender(
      <PreviewCanvas
        theme={{ ...zoomedTheme, art: { ...zoomedTheme.art, scale: 1 } }}
        imageUrl="asset://localhost/yingying.jpg"
        imageMetadata={imageMetadata}
        onFocusChange={onFocusChange}
        onScaleChange={vi.fn()}
      />,
    );

    expect(onFocusChange.mock.lastCall?.[0]).toBeCloseTo(0.37, 2);
    expect(onFocusChange.mock.lastCall?.[1]).toBe(0.5);
  });

  it("explains when an axis has no crop movement range", () => {
    renderPreview({ theme: { ...theme, art: { ...theme.art, scale: 1 } } });
    resizeCanvas();

    expect(screen.getByTestId("preview-crop-limits")).toHaveTextContent("Y 轴固定居中");
    expect(screen.getByTestId("preview-crop-limits")).not.toHaveTextContent("X 轴固定居中");
  });

  it("disconnects crop size observation when the preview unmounts", () => {
    const { unmount } = renderPreview();
    const observer = TestResizeObserver.latest;

    unmount();

    expect(observer?.disconnect).toHaveBeenCalledOnce();
  });

  it("renders a legacy sub-cover scale at cover and keeps wheel and keyboard edits above one", () => {
    const onScaleChange = vi.fn();
    const onFocusChange = vi.fn();
    const legacyTheme = { ...theme, art: { ...theme.art, scale: 0.5 } };
    const { rerender } = renderPreview({
      theme: legacyTheme,
      onFocusChange,
      onScaleChange,
    });
    const canvas = resizeCanvas();

    expect(screen.getByTestId("preview-artwork").style.width).toBe("1475.5555555555554px");
    expect(screen.getByTestId("preview-artwork").style.height).toBe("830px");
    expect(onScaleChange).not.toHaveBeenCalled();
    expect(onFocusChange).toHaveBeenCalledOnce();

    rerender(
      <PreviewCanvas
        theme={{ ...legacyTheme, art: { ...legacyTheme.art, focusY: 0.5 } }}
        imageUrl="asset://localhost/yingying.jpg"
        imageMetadata={imageMetadata}
        onFocusChange={onFocusChange}
        onScaleChange={onScaleChange}
      />,
    );
    expect(onFocusChange).toHaveBeenCalledOnce();

    canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, cancelable: true }));
    fireEvent.keyDown(canvas, { key: "-" });
    expect(onScaleChange).toHaveBeenNthCalledWith(1, 1);
    expect(onScaleChange).toHaveBeenNthCalledWith(2, 1);
  });

  it("moves artwork in the arrow direction, resets on double-click, and calibrates scale", () => {
    const onFocusChange = vi.fn();
    const onScaleChange = vi.fn();
    render(
      <PreviewCanvas
        theme={theme}
        imageUrl="asset://localhost/yingying.jpg"
        imageMetadata={imageMetadata}
        onFocusChange={onFocusChange}
        onScaleChange={onScaleChange}
      />,
    );

    const canvas = screen.getByRole("application", { name: "Codex 皮肤预览画布" });
    resizeCanvas();
    fireEvent.keyDown(canvas, { key: "ArrowRight" });
    fireEvent.keyDown(canvas, { key: "ArrowDown" });
    fireEvent.doubleClick(canvas);
    fireEvent.keyDown(canvas, { key: "+" });
    expect(onFocusChange.mock.calls[0][0]).toBeLessThan(theme.art.focusX);
    expect(onFocusChange.mock.calls[0][1]).toBe(theme.art.focusY);
    expect(onFocusChange.mock.calls[1][0]).toBe(theme.art.focusX);
    expect(onFocusChange.mock.calls[1][1]).toBeLessThan(theme.art.focusY);
    expect(onFocusChange).toHaveBeenNthCalledWith(3, 0.5, 0.5);
    expect(onScaleChange).toHaveBeenCalledWith(1.4);
  });
});
