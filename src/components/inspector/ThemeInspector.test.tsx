import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_ART, DEFAULT_EFFECTS, type ThemeDocument } from "../../domain/theme";
import type { ImageMetadata } from "../../lib/commands";
import { DirtyThemeDialog } from "./DirtyThemeDialog";
import { LabeledRange } from "./LabeledRange";
import { ThemeInspector } from "./ThemeInspector";

afterEach(cleanup);

const draft: ThemeDocument = {
  schemaVersion: 4,
  id: "yingying",
  name: "萦萦",
  image: "art.jpg",
  appearance: "auto",
  art: { ...DEFAULT_ART },
  effects: { ...DEFAULT_EFFECTS },
  extra: {},
};

const metadata: ImageMetadata = {
  path: "C:\\themes\\yingying\\art.jpg",
  format: "jpeg",
  width: 3840,
  height: 2160,
  bytes: 8_388_608,
  sha256: "abc",
};

function renderInspector(overrides: Partial<React.ComponentProps<typeof ThemeInspector>> = {}) {
  const props: React.ComponentProps<typeof ThemeInspector> = {
    draft,
    imagePath: metadata.path,
    imageMetadata: metadata,
    stagedImage: null,
    dirty: true,
    busy: false,
    onUpdateDraft: vi.fn(),
    onStageImage: vi.fn().mockResolvedValue(metadata),
    onApply: vi.fn().mockResolvedValue(true),
    onDiscard: vi.fn(),
    pickImage: vi.fn().mockResolvedValue("C:\\images\\replacement.webp"),
    ...overrides,
  };
  return { ...render(<ThemeInspector {...props} />), props };
}

describe("LabeledRange", () => {
  it("synchronizes the range and number inputs and resets to the approved value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<LabeledRange label="模糊度" value={4} min={0} max={32} step={1} unit="px" resetValue={0} onChange={onChange} />);

    fireEvent.change(screen.getByRole("slider", { name: "模糊度" }), { target: { value: "12" } });
    expect(onChange).toHaveBeenLastCalledWith(12);

    const number = screen.getByRole("spinbutton", { name: "模糊度数值" });
    await user.clear(number);
    await user.type(number, "20");
    expect(onChange).toHaveBeenLastCalledWith(20);
    expect(screen.getByText("px")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "重置模糊度" }));
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it("keeps invalid typed text visible and does not dispatch it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<LabeledRange label="缩放" value={1} min={0.5} max={2.5} step={0.05} unit="×" resetValue={1} onChange={onChange} />);

    const number = screen.getByRole("spinbutton", { name: "缩放数值" });
    await user.clear(number);
    await user.type(number, "9");

    expect(number).toHaveValue(9);
    expect(number).toHaveAttribute("aria-invalid", "true");
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("ThemeInspector", () => {
  it("renders five pages with only the selected tabpanel visible", async () => {
    const user = userEvent.setup();
    renderInspector();

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["图片", "构图", "色调", "光效", "界面"]);
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("图片");
    expect(screen.getByRole("button", { name: "放弃更改" })).toBeVisible();
    expect(screen.getByRole("button", { name: "应用更改" })).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "光效" }));
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("光效");
    expect(screen.getByRole("button", { name: "放弃更改" })).toBeVisible();
    expect(screen.getByRole("button", { name: "应用更改" })).toBeVisible();
  });

  it("keeps calibrated controls on their approved pages", async () => {
    const user = userEvent.setup();
    renderInspector();

    await user.click(screen.getByRole("tab", { name: "构图" }));
    for (const [label, min, max, step] of [
      ["X 位置", "-100", "100", "1"], ["Y 位置", "-100", "100", "1"], ["缩放", "1", "2.5", "0.05"],
    ]) {
      expect(screen.getByRole("slider", { name: label })).toHaveAttribute("min", min);
      expect(screen.getByRole("slider", { name: label })).toHaveAttribute("max", max);
      expect(screen.getByRole("slider", { name: label })).toHaveAttribute("step", step);
    }

    await user.click(screen.getByRole("tab", { name: "光效" }));

    const controls = [
      ["主页背景", "0", "100", "1"], ["任务页背景", "0", "100", "1"], ["模糊度", "0", "32", "1"],
      ["饱和度", "0", "200", "5"], ["亮度", "50", "150", "5"], ["遮罩强度", "0", "100", "1"],
    ];
    for (const [label, min, max, step] of controls) {
      expect(screen.getByRole("slider", { name: label })).toHaveAttribute("min", min);
      expect(screen.getByRole("slider", { name: label })).toHaveAttribute("max", max);
      expect(screen.getByRole("slider", { name: label })).toHaveAttribute("step", step);
      expect(screen.getByRole("spinbutton", { name: `${label}数值` })).toBeVisible();
      expect(screen.getByRole("button", { name: `重置${label}` })).toBeVisible();
    }
  });

  it("dispatches converted nested patches for every numeric and enum field", async () => {
    const user = userEvent.setup();
    const onUpdateDraft = vi.fn();
    renderInspector({ onUpdateDraft });

    await user.click(screen.getByRole("tab", { name: "构图" }));
    const compositionChanges: Array<[string, string, unknown]> = [
      ["X 位置", "20", { art: { focusX: 0.4 } }],
      ["Y 位置", "-40", { art: { focusY: 0.7 } }],
      ["缩放", "1.25", { art: { scale: 1.25 } }],
    ];
    for (const [label, value, patch] of compositionChanges) {
      fireEvent.change(screen.getByRole("slider", { name: label }), { target: { value } });
      expect(onUpdateDraft).toHaveBeenCalledWith(patch);
    }

    await user.click(screen.getByRole("tab", { name: "光效" }));
    const effectChanges: Array<[string, string, unknown]> = [
      ["主页背景", "80", { effects: { homeOpacity: 0.8 } }],
      ["任务页背景", "42", { effects: { taskOpacity: 0.42 } }],
      ["模糊度", "8", { effects: { blur: 8 } }],
      ["饱和度", "125", { effects: { saturation: 1.25 } }],
      ["亮度", "125", { effects: { brightness: 1.25 } }],
      ["遮罩强度", "55", { effects: { maskStrength: 0.55 } }],
    ];
    for (const [label, value, patch] of effectChanges) {
      fireEvent.change(screen.getByRole("slider", { name: label }), { target: { value } });
      expect(onUpdateDraft).toHaveBeenCalledWith(patch);
    }

    await user.click(screen.getByRole("tab", { name: "界面" }));
    fireEvent.change(screen.getByRole("slider", { name: "界面背景透明度" }), { target: { value: "66" } });
    fireEvent.change(screen.getByRole("slider", { name: "左侧栏透明度" }), { target: { value: "44" } });
    expect(screen.queryByLabelText("水平焦点")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("垂直焦点")).not.toBeInTheDocument();

    expect(onUpdateDraft).toHaveBeenCalledWith({ effects: { interfaceOpacity: 0.66 } });
    expect(onUpdateDraft).toHaveBeenCalledWith({ effects: { leftSidebarOpacity: 0.44 } });
  });

  it("resets every numeric field to the schema default", async () => {
    const user = userEvent.setup();
    const onUpdateDraft = vi.fn();
    renderInspector({ onUpdateDraft });

    await user.click(screen.getByRole("tab", { name: "构图" }));
    const compositionResets: Array<[string, unknown]> = [
      ["X 位置", { art: { focusX: DEFAULT_ART.focusX } }],
      ["Y 位置", { art: { focusY: 0.5 } }],
      ["缩放", { art: { scale: DEFAULT_ART.scale } }],
    ];
    for (const [label, patch] of compositionResets) {
      await user.click(screen.getByRole("button", { name: `重置${label}` }));
      expect(onUpdateDraft).toHaveBeenCalledWith(patch);
    }

    await user.click(screen.getByRole("tab", { name: "光效" }));
    const effectResets: Array<[string, unknown]> = [
      ["主页背景", { effects: { homeOpacity: DEFAULT_EFFECTS.homeOpacity } }],
      ["任务页背景", { effects: { taskOpacity: DEFAULT_EFFECTS.taskOpacity } }],
      ["模糊度", { effects: { blur: DEFAULT_EFFECTS.blur } }],
      ["饱和度", { effects: { saturation: DEFAULT_EFFECTS.saturation } }],
      ["亮度", { effects: { brightness: DEFAULT_EFFECTS.brightness } }],
      ["遮罩强度", { effects: { maskStrength: DEFAULT_EFFECTS.maskStrength } }],
    ];
    for (const [label, patch] of effectResets) {
      await user.click(screen.getByRole("button", { name: `重置${label}` }));
      expect(onUpdateDraft).toHaveBeenCalledWith(patch);
    }

    await user.click(screen.getByRole("tab", { name: "界面" }));
    await user.click(screen.getByRole("button", { name: "重置界面背景透明度" }));
    expect(onUpdateDraft).toHaveBeenCalledWith({ effects: { interfaceOpacity: DEFAULT_EFFECTS.interfaceOpacity } });
    for (const [label, field, value] of [
      ["左侧栏透明度", "leftSidebarOpacity", DEFAULT_EFFECTS.leftSidebarOpacity],
      ["顶部栏透明度", "topBarOpacity", DEFAULT_EFFECTS.topBarOpacity],
      ["右侧栏透明度", "rightSidebarOpacity", DEFAULT_EFFECTS.rightSidebarOpacity],
      ["底部栏透明度", "bottomBarOpacity", DEFAULT_EFFECTS.bottomBarOpacity],
    ] as const) {
      await user.click(screen.getByRole("button", { name: `重置${label}` }));
      expect(onUpdateDraft).toHaveBeenCalledWith({ effects: { [field]: value } });
    }
  });

  it("dispatches tone mode, strength, and conditional color patches", async () => {
    const user = userEvent.setup();
    const onUpdateDraft = vi.fn();
    const { rerender, props } = renderInspector({ onUpdateDraft });

    await user.click(screen.getByRole("tab", { name: "色调" }));
    expect(screen.getAllByRole("radio").map((choice) => choice.getAttribute("aria-label"))).toEqual([
      "原始",
      "黑白",
      "双色调",
      "水洗色",
    ]);
    expect(screen.getByRole("slider", { name: "色调强度" })).toHaveAttribute("min", "0");
    expect(screen.getByRole("slider", { name: "色调强度" })).toHaveAttribute("max", "100");
    expect(screen.getByRole("slider", { name: "色调强度" })).toHaveValue("100");
    expect(screen.queryByLabelText("暗部颜色")).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "双色调" }));
    expect(onUpdateDraft).toHaveBeenLastCalledWith({ effects: { toneMode: "duotone" } });

    rerender(<ThemeInspector {...props} draft={{
      ...draft,
      effects: { ...draft.effects, toneMode: "duotone" },
    }} />);
    fireEvent.change(screen.getByRole("slider", { name: "色调强度" }), { target: { value: "37" } });
    fireEvent.change(screen.getByLabelText("暗部颜色"), { target: { value: "#102030" } });
    fireEvent.change(screen.getByLabelText("亮部颜色"), { target: { value: "#ddeeff" } });
    expect(onUpdateDraft).toHaveBeenCalledWith({ effects: { toneStrength: 0.37 } });
    expect(onUpdateDraft).toHaveBeenCalledWith({ effects: { duotoneShadow: "#102030" } });
    expect(onUpdateDraft).toHaveBeenCalledWith({ effects: { duotoneHighlight: "#ddeeff" } });

    await user.click(screen.getByRole("radio", { name: "水洗色" }));
    rerender(<ThemeInspector {...props} draft={{
      ...draft,
      effects: { ...draft.effects, toneMode: "wash" },
    }} />);
    expect(screen.getByLabelText("水洗颜色")).toHaveAttribute("type", "color");
    expect(screen.queryByLabelText("暗部颜色")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("水洗颜色"), { target: { value: "#71988f" } });
    expect(onUpdateDraft).toHaveBeenCalledWith({ effects: { washColor: "#71988f" } });
  });

  it("shows independent region opacity controls and can synchronize all four", async () => {
    const user = userEvent.setup();
    const onUpdateDraft = vi.fn();
    renderInspector({ onUpdateDraft });

    await user.click(screen.getByRole("tab", { name: "界面" }));
    const sliders = screen.getAllByRole("slider");
    expect(sliders).toHaveLength(5);
    expect(sliders.map((slider) => slider.getAttribute("aria-label"))).toEqual([
      "界面背景透明度",
      "左侧栏透明度",
      "顶部栏透明度",
      "右侧栏透明度",
      "底部栏透明度",
    ]);
    expect(screen.getByRole("checkbox", { name: "同步调整四个区域" })).not.toBeChecked();

    fireEvent.change(screen.getByRole("slider", { name: "界面背景透明度" }), { target: { value: "41" } });
    expect(onUpdateDraft).toHaveBeenLastCalledWith({ effects: { interfaceOpacity: 0.41 } });

    fireEvent.change(screen.getByRole("slider", { name: "右侧栏透明度" }), { target: { value: "53" } });
    expect(onUpdateDraft).toHaveBeenLastCalledWith({ effects: { rightSidebarOpacity: 0.53 } });

    await user.click(screen.getByRole("checkbox", { name: "同步调整四个区域" }));
    fireEvent.change(screen.getByRole("slider", { name: "底部栏透明度" }), { target: { value: "67" } });
    expect(onUpdateDraft).toHaveBeenLastCalledWith({
      effects: {
        leftSidebarOpacity: 0.67,
        topBarOpacity: 0.67,
        rightSidebarOpacity: 0.67,
        bottomBarOpacity: 0.67,
      },
    });
  });

  it("shows image metadata and stages a validated replacement without applying", async () => {
    const user = userEvent.setup();
    const onStageImage = vi.fn().mockResolvedValue({ ...metadata, path: "C:\\images\\replacement.webp", format: "webp" });
    const onApply = vi.fn();
    renderInspector({ onStageImage, onApply });

    expect(screen.getByText("3840 × 2160")).toBeVisible();
    expect(screen.getByText("8.0 MiB")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "替换图片" }));

    expect(onStageImage).toHaveBeenCalledWith("C:\\images\\replacement.webp");
    expect(onApply).not.toHaveBeenCalled();
  });

  it("shows a visible error when the replacement image picker cannot open", async () => {
    const user = userEvent.setup();
    renderInspector({ pickImage: vi.fn().mockRejectedValue(new Error("dialog permission denied")) });

    await user.click(screen.getByRole("button", { name: "替换图片" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "无法打开图片选择器：dialog permission denied",
    );
  });

  it("contains no content-avoidance controls or copy", () => {
    renderInspector();

    expect(screen.queryAllByText(/内容避让区/)).toHaveLength(0);
    expect(screen.queryByLabelText("内容避让区")).not.toBeInTheDocument();
  });

  it("disables Apply while clean or busy and leaves it enabled after a failed apply", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn().mockResolvedValue(false);
    const { rerender, props } = renderInspector({ dirty: false, onApply });
    expect(screen.getByRole("button", { name: "应用更改" })).toBeDisabled();

    rerender(<ThemeInspector {...props} dirty busy />);
    expect(screen.getByRole("button", { name: "应用更改" })).toBeDisabled();

    rerender(<ThemeInspector {...props} dirty busy={false} />);
    await user.click(screen.getByRole("button", { name: "应用更改" }));
    expect(onApply).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "应用更改" })).toBeEnabled();

    rerender(<ThemeInspector {...props} dirty canDiscard={false} busy={false} />);
    expect(screen.getByRole("button", { name: "应用更改" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "放弃更改" })).toBeDisabled();
  });
});

describe("DirtyThemeDialog", () => {
  it("offers the shared Apply, Discard, and Cancel resolution", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    render(<DirtyThemeDialog busy={false} onResolve={onResolve} />);
    const dialog = screen.getByRole("dialog", { name: "未应用的更改" });

    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    await user.click(within(dialog).getByRole("button", { name: "放弃更改" }));
    await user.click(within(dialog).getByRole("button", { name: "应用并切换" }));
    expect(onResolve.mock.calls.map(([resolution]) => resolution)).toEqual(["cancel", "discard", "apply"]);
  });
});
