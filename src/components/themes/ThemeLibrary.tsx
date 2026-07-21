import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";

import type { DirtyResolution, SelectionResult } from "../../store/studio-store";
import type { ThemeSummary } from "../../lib/commands";
import { DirtyThemeDialog } from "../inspector/DirtyThemeDialog";
import { ThemeThumbnail } from "./ThemeThumbnail";

type TextDialog =
  | { kind: "import"; name: string; imagePath: string | null }
  | { kind: "duplicate"; theme: ThemeSummary; name: string }
  | { kind: "rename"; theme: ThemeSummary; name: string };

export interface ThemeLibraryProps {
  themes: ThemeSummary[];
  selectedThemeId: string | null;
  activeThemeId: string | null;
  busy: boolean;
  onSelect(id: string): Promise<SelectionResult>;
  onResolveSelection(resolution: DirtyResolution): Promise<SelectionResult>;
  onImport(name: string, sourceImage: string): Promise<boolean>;
  onDuplicate(id: string, name: string): Promise<boolean>;
  onRename(id: string, name: string): Promise<boolean>;
  onDelete(id: string): Promise<boolean>;
  onReplaceImage(theme: ThemeSummary, sourceImage: string): Promise<boolean>;
  pickImage?: () => Promise<string | null>;
  toAssetUrl?: (path: string) => string;
}

async function pickThemeImage(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "皮肤图片", extensions: ["png", "jpg", "jpeg", "webp"] }],
  });
  return typeof selected === "string" ? selected : null;
}

export function ThemeLibrary({
  themes,
  selectedThemeId,
  activeThemeId,
  busy,
  onSelect,
  onResolveSelection,
  onImport,
  onDuplicate,
  onRename,
  onDelete,
  onReplaceImage,
  pickImage = pickThemeImage,
  toAssetUrl,
}: ThemeLibraryProps) {
  const [textDialog, setTextDialog] = useState<TextDialog | null>(null);
  const [deleteTheme, setDeleteTheme] = useState<ThemeSummary | null>(null);
  const [dirtyDialogOpen, setDirtyDialogOpen] = useState(false);
  const [imagePickerError, setImagePickerError] = useState<string | null>(null);

  const builtIn = themes.filter((theme) => theme.isBuiltIn);
  const userThemes = themes.filter((theme) => !theme.isBuiltIn);

  async function requestSelection(id: string) {
    const result = await onSelect(id);
    if (result === "decision-required") setDirtyDialogOpen(true);
  }

  async function resolveSelection(resolution: DirtyResolution) {
    const result = await onResolveSelection(resolution);
    if (result !== "failed") setDirtyDialogOpen(false);
  }

  async function replaceImage(theme: ThemeSummary) {
    const path = await requestImage();
    if (path) await onReplaceImage(theme, path);
  }

  async function requestImage(): Promise<string | null> {
    setImagePickerError(null);
    try {
      return await pickImage();
    } catch (error) {
      setImagePickerError(error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  async function submitTextDialog() {
    if (!textDialog || !textDialog.name.trim()) return;
    let succeeded = false;
    if (textDialog.kind === "import" && textDialog.imagePath) {
      succeeded = await onImport(textDialog.name.trim(), textDialog.imagePath);
    } else if (textDialog.kind === "duplicate") {
      succeeded = await onDuplicate(textDialog.theme.id, textDialog.name.trim());
    } else if (textDialog.kind === "rename") {
      succeeded = await onRename(textDialog.theme.id, textDialog.name.trim());
    }
    if (succeeded) setTextDialog(null);
  }

  return (
    <div className="theme-library">
      <header className="theme-library__header">
        <div>
          <p className="theme-library__index">01 / THEMES</p>
          <h2>主题库</h2>
        </div>
        <button
          type="button"
          className="brutal-button theme-library__import"
          disabled={busy}
          onClick={() => {
            setImagePickerError(null);
            setTextDialog({ kind: "import", name: "", imagePath: null });
          }}
        >
          导入图片
        </button>
      </header>

      <div className="theme-library__groups">
        <ThemeGroup
          title="内置主题"
          themes={builtIn}
          {...{ selectedThemeId, activeThemeId, busy, requestSelection, replaceImage, toAssetUrl }}
          onDuplicate={(theme) => setTextDialog({ kind: "duplicate", theme, name: `${theme.name} 副本` })}
          onRename={(theme) => setTextDialog({ kind: "rename", theme, name: theme.name })}
          onDelete={setDeleteTheme}
        />
        <ThemeGroup
          title="我的主题"
          themes={userThemes}
          {...{ selectedThemeId, activeThemeId, busy, requestSelection, replaceImage, toAssetUrl }}
          onDuplicate={(theme) => setTextDialog({ kind: "duplicate", theme, name: `${theme.name} 副本` })}
          onRename={(theme) => setTextDialog({ kind: "rename", theme, name: theme.name })}
          onDelete={setDeleteTheme}
        />
      </div>

      {imagePickerError && !textDialog ? (
        <p className="library-dialog__error theme-library__picker-error" role="alert">
          无法打开图片选择器：{imagePickerError}
        </p>
      ) : null}

      {textDialog ? (
        <TextActionDialog
          dialog={textDialog}
          busy={busy}
          onChange={setTextDialog}
          onPickImage={async () => {
            const imagePath = await requestImage();
            if (imagePath && textDialog.kind === "import") setTextDialog({ ...textDialog, imagePath });
          }}
          imagePickerError={imagePickerError}
          onSubmit={submitTextDialog}
          onCancel={() => {
            setImagePickerError(null);
            setTextDialog(null);
          }}
        />
      ) : null}

      {deleteTheme ? (
        <LibraryDialog title="删除主题" onCancel={() => setDeleteTheme(null)}>
          <p>将删除“{deleteTheme.name}”的主题文件。Codex 当前皮肤暂时保持不变，直到应用其他主题或恢复官方外观。</p>
          <div className="library-dialog__actions">
            <button type="button" className="brutal-button brutal-button--quiet" onClick={() => setDeleteTheme(null)}>取消</button>
            <button
              type="button"
              className="brutal-button theme-action--danger"
              disabled={busy}
              onClick={async () => {
                if (await onDelete(deleteTheme.id)) setDeleteTheme(null);
              }}
            >
              确认删除
            </button>
          </div>
        </LibraryDialog>
      ) : null}

      {dirtyDialogOpen ? (
        <DirtyThemeDialog busy={busy} onResolve={resolveSelection} />
      ) : null}
    </div>
  );
}

interface ThemeGroupProps {
  title: string;
  themes: ThemeSummary[];
  selectedThemeId: string | null;
  activeThemeId: string | null;
  busy: boolean;
  requestSelection(id: string): void;
  replaceImage(theme: ThemeSummary): void;
  onDuplicate(theme: ThemeSummary): void;
  onRename(theme: ThemeSummary): void;
  onDelete(theme: ThemeSummary): void;
  toAssetUrl?: (path: string) => string;
}

function ThemeGroup({
  title,
  themes,
  selectedThemeId,
  activeThemeId,
  busy,
  requestSelection,
  replaceImage,
  onDuplicate,
  onRename,
  onDelete,
  toAssetUrl,
}: ThemeGroupProps) {
  return (
    <section className="theme-group" aria-labelledby={`theme-group-${title}`}>
      <h3 id={`theme-group-${title}`}>{title}</h3>
      {themes.length === 0 ? <p className="theme-group__empty">暂无主题</p> : null}
      <div className="theme-group__list">
        {themes.map((theme) => {
          const active = theme.id === activeThemeId;
          const selected = theme.id === selectedThemeId;
          return (
            <article
              key={theme.id}
              className="theme-card"
              data-selected={selected}
              data-active={active}
              data-damaged={theme.isDamaged}
            >
              <div className="theme-card__body">
                <ThemeThumbnail
                  theme={theme}
                  onReplace={() => replaceImage(theme)}
                  {...(toAssetUrl ? { toAssetUrl } : {})}
                />
                <button
                  type="button"
                  className="theme-card__select"
                  aria-label={`选择主题 ${theme.name}`}
                  aria-current={selected ? "true" : undefined}
                  disabled={busy || theme.isDamaged}
                  onClick={() => requestSelection(theme.id)}
                >
                  <span className="theme-card__meta">
                  <strong>{theme.name}</strong>
                  <span>{theme.isDamaged ? "需要修复" : active ? "正在使用" : selected ? "已选择" : "可用"}</span>
                  </span>
                </button>
              </div>
              <div className="theme-card__actions" aria-label={`${theme.name} 主题操作`}>
                <button type="button" disabled={busy} aria-label={`复制 ${theme.name}`} onClick={() => onDuplicate(theme)}>复制</button>
                <button type="button" disabled={busy || theme.isBuiltIn || theme.isDamaged} aria-label={`重命名 ${theme.name}`} onClick={() => onRename(theme)}>改名</button>
                <button type="button" disabled={busy} aria-label={`删除 ${theme.name}`} onClick={() => onDelete(theme)}>删除</button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function TextActionDialog({
  dialog,
  busy,
  onChange,
  onPickImage,
  imagePickerError,
  onSubmit,
  onCancel,
}: {
  dialog: TextDialog;
  busy: boolean;
  onChange(dialog: TextDialog): void;
  onPickImage(): void;
  imagePickerError: string | null;
  onSubmit(): void;
  onCancel(): void;
}) {
  const title = dialog.kind === "import" ? "新建主题" : dialog.kind === "duplicate" ? "复制主题" : "重命名主题";
  const inputLabel = dialog.kind === "duplicate" ? "新主题名称" : "主题名称";
  const submitLabel = dialog.kind === "import" ? "创建主题" : dialog.kind === "duplicate" ? "创建副本" : "保存名称";
  return (
    <LibraryDialog title={title} onCancel={onCancel}>
      <label className="library-dialog__field">
        <span>{inputLabel}</span>
        <input
          autoFocus
          value={dialog.name}
          onChange={(event) => onChange({ ...dialog, name: event.target.value })}
        />
      </label>
      {dialog.kind === "import" ? (
        <>
          <div className="library-dialog__image-row">
            <button type="button" className="brutal-button brutal-button--quiet" onClick={onPickImage}>选择图片</button>
            <span title={dialog.imagePath ?? undefined}>{dialog.imagePath ? dialog.imagePath.split(/[\\/]/).pop() : "尚未选择"}</span>
          </div>
          {imagePickerError ? <p className="library-dialog__error" role="alert">无法打开图片选择器：{imagePickerError}</p> : null}
        </>
      ) : null}
      <div className="library-dialog__actions">
        <button type="button" className="brutal-button brutal-button--quiet" onClick={onCancel}>取消</button>
        <button
          type="button"
          className="brutal-button brutal-button--secondary"
          disabled={busy || !dialog.name.trim() || (dialog.kind === "import" && !dialog.imagePath)}
          onClick={onSubmit}
        >
          {submitLabel}
        </button>
      </div>
    </LibraryDialog>
  );
}

function LibraryDialog({ title, children, onCancel }: { title: string; children: React.ReactNode; onCancel(): void }) {
  return (
    <div className="library-dialog__backdrop" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <section className="library-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <header className="library-dialog__header">
          <h3>{title}</h3>
          <button type="button" aria-label={`关闭${title}`} onClick={onCancel}>×</button>
        </header>
        {children}
      </section>
    </div>
  );
}
