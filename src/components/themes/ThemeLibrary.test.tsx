import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ThemeSummary } from "../../lib/commands";
import { ThemeLibrary } from "./ThemeLibrary";

const convertFileSrc = vi.hoisted(() => vi.fn((path: string) => `asset:${path}`));

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc }));

afterEach(cleanup);

const themes: ThemeSummary[] = [
  {
    id: "paper-grid",
    name: "纸面网格",
    imagePath: "C:\\themes\\paper-grid\\art.webp",
    isBuiltIn: true,
    isDamaged: false,
  },
  {
    id: "yingying",
    name: "萦萦",
    imagePath: "C:\\themes\\yingying\\art.jpg",
    isBuiltIn: false,
    isDamaged: false,
  },
  {
    id: "damaged",
    name: "待修复主题",
    imagePath: null,
    isBuiltIn: false,
    isDamaged: true,
  },
];

function renderLibrary(overrides: Partial<React.ComponentProps<typeof ThemeLibrary>> = {}) {
  const props: React.ComponentProps<typeof ThemeLibrary> = {
    themes,
    selectedThemeId: "yingying",
    activeThemeId: "yingying",
    busy: false,
    onSelect: vi.fn().mockResolvedValue("selected"),
    onResolveSelection: vi.fn().mockResolvedValue("selected"),
    onImport: vi.fn().mockResolvedValue(true),
    onDuplicate: vi.fn().mockResolvedValue(true),
    onRename: vi.fn().mockResolvedValue(true),
    onDelete: vi.fn().mockResolvedValue(true),
    onReplaceImage: vi.fn().mockResolvedValue(true),
    pickImage: vi.fn().mockResolvedValue("C:\\images\\new-skin.jpg"),
    toAssetUrl: vi.fn((path) => `asset://localhost/${encodeURIComponent(path)}`),
    ...overrides,
  };
  return { ...render(<ThemeLibrary {...props} />), props };
}

describe("ThemeLibrary", () => {
  it("groups built-in and user themes, renders 萦萦, and converts managed image paths", () => {
    renderLibrary({ toAssetUrl: undefined });

    expect(screen.getByRole("heading", { name: "内置主题" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "我的主题" })).toBeVisible();
    expect(screen.getByRole("button", { name: /选择主题 萦萦/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByText("正在使用")).toBeVisible();
    expect(convertFileSrc).toHaveBeenCalledWith("C:\\themes\\yingying\\art.jpg");
    expect(screen.getByRole("img", { name: "萦萦 缩略图" })).toHaveAttribute(
      "src",
      "asset:C:\\themes\\yingying\\art.jpg",
    );
  });

  it("supports keyboard selection and resolves a dirty selection in-app", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn().mockResolvedValue("decision-required");
    const onResolveSelection = vi.fn().mockResolvedValue("selected");
    renderLibrary({ onSelect, onResolveSelection });

    const builtIn = screen.getByRole("button", { name: /选择主题 纸面网格/ });
    builtIn.focus();
    await user.keyboard("{Enter}");

    expect(onSelect).toHaveBeenCalledWith("paper-grid");
    expect(screen.getByRole("dialog", { name: "未应用的更改" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "放弃更改" }));
    expect(onResolveSelection).toHaveBeenCalledWith("discard");
  });

  it("keeps the dirty dialog open when Apply cannot complete", async () => {
    const user = userEvent.setup();
    renderLibrary({
      onSelect: vi.fn().mockResolvedValue("decision-required"),
      onResolveSelection: vi.fn().mockResolvedValue("failed"),
    });

    await user.click(screen.getByRole("button", { name: /选择主题 纸面网格/ }));
    await user.click(screen.getByRole("button", { name: "应用并切换" }));

    expect(screen.getByRole("dialog", { name: "未应用的更改" })).toBeVisible();
  });

  it("allows deleting built-in, active, and damaged themes with an active-skin warning", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockResolvedValue(true);
    renderLibrary({ onDelete });

    expect(screen.getByRole("button", { name: "删除 纸面网格" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "删除 萦萦" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "删除 待修复主题" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "删除 萦萦" }));
    const dialog = screen.getByRole("dialog", { name: "删除主题" });
    expect(within(dialog).getByText(/Codex 当前皮肤暂时保持不变/)).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "确认删除" }));

    expect(onDelete).toHaveBeenCalledWith("yingying");
  });

  it("duplicates and renames themes through compact dialogs", async () => {
    const user = userEvent.setup();
    const onDuplicate = vi.fn().mockResolvedValue(true);
    const onRename = vi.fn().mockResolvedValue(true);
    renderLibrary({ onDuplicate, onRename });

    await user.click(screen.getByRole("button", { name: "复制 萦萦" }));
    const duplicateDialog = screen.getByRole("dialog", { name: "复制主题" });
    const duplicateName = within(duplicateDialog).getByLabelText("新主题名称");
    await user.clear(duplicateName);
    await user.type(duplicateName, "萦萦 夜间");
    await user.click(within(duplicateDialog).getByRole("button", { name: "创建副本" }));
    expect(onDuplicate).toHaveBeenCalledWith("yingying", "萦萦 夜间");

    await user.click(screen.getByRole("button", { name: "重命名 萦萦" }));
    const renameDialog = screen.getByRole("dialog", { name: "重命名主题" });
    const renameInput = within(renameDialog).getByLabelText("主题名称");
    await user.clear(renameInput);
    await user.type(renameInput, "萦萦 新版");
    await user.click(within(renameDialog).getByRole("button", { name: "保存名称" }));
    expect(onRename).toHaveBeenCalledWith("yingying", "萦萦 新版");
  });

  it("imports only after picking an image and sends the chosen file to validation", async () => {
    const user = userEvent.setup();
    const onImport = vi.fn().mockResolvedValue(true);
    const pickImage = vi.fn().mockResolvedValue("C:\\images\\new-skin.jpg");
    renderLibrary({ onImport, pickImage });

    await user.click(screen.getByRole("button", { name: "导入图片" }));
    const dialog = screen.getByRole("dialog", { name: "新建主题" });
    await user.type(within(dialog).getByLabelText("主题名称"), "蓝色时刻");
    await user.click(within(dialog).getByRole("button", { name: "选择图片" }));
    expect(pickImage).toHaveBeenCalledOnce();
    await user.click(within(dialog).getByRole("button", { name: "创建主题" }));

    expect(onImport).toHaveBeenCalledWith("蓝色时刻", "C:\\images\\new-skin.jpg");
  });

  it("shows a visible error when the native image picker cannot open", async () => {
    const user = userEvent.setup();
    renderLibrary({ pickImage: vi.fn().mockRejectedValue(new Error("dialog.open not allowed")) });

    await user.click(screen.getByRole("button", { name: "导入图片" }));
    const dialog = screen.getByRole("dialog", { name: "新建主题" });
    await user.click(within(dialog).getByRole("button", { name: "选择图片" }));

    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "无法打开图片选择器：dialog.open not allowed",
    );
  });

  it("shows a repair fallback when an image fails and forwards Replace Image", async () => {
    const user = userEvent.setup();
    const onReplaceImage = vi.fn().mockResolvedValue(true);
    const pickImage = vi.fn().mockResolvedValue("C:\\images\\replacement.webp");
    renderLibrary({ onReplaceImage, pickImage });

    fireEvent.error(screen.getByRole("img", { name: "萦萦 缩略图" }));
    expect(screen.getAllByText("图片不可用").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "替换 萦萦 的图片" }));
    await waitFor(() => {
      expect(onReplaceImage).toHaveBeenCalledWith(
        expect.objectContaining({ id: "yingying" }),
        "C:\\images\\replacement.webp",
      );
    });
  });

  it("shows a visible error when a theme replacement picker cannot open", async () => {
    const user = userEvent.setup();
    renderLibrary({ pickImage: vi.fn().mockRejectedValue(new Error("replacement dialog blocked")) });

    await user.click(screen.getByRole("button", { name: "替换 待修复主题 的图片" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "无法打开图片选择器：replacement dialog blocked",
    );
  });
});
