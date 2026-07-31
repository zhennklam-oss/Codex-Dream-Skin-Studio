import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";

import {
  DEFAULT_ART,
  DEFAULT_EFFECTS,
  type EffectSettings,
  type ThemeDocument,
  type ToneMode,
} from "../../domain/theme";
import type { ImageMetadata } from "../../lib/commands";
import type { ThemePatch } from "../../store/studio-store";
import { focusToPosition, positionToFocus } from "../preview/position-math";
import { InspectorTabs, type InspectorPage, type InspectorTabDefinition } from "./InspectorTabs";
import { LabeledRange } from "./LabeledRange";

const INSPECTOR_PAGES: InspectorTabDefinition[] = [
  { id: "image", label: "图片" },
  { id: "composition", label: "构图" },
  { id: "tone", label: "色调" },
  { id: "effects", label: "光效" },
  { id: "interface", label: "界面" },
];

export interface ThemeInspectorProps {
  draft: ThemeDocument;
  imagePath: string;
  imageMetadata?: ImageMetadata;
  stagedImage: ImageMetadata | null;
  dirty: boolean;
  canDiscard?: boolean;
  busy: boolean;
  onUpdateDraft(patch: ThemePatch): void;
  onStageImage(path: string): Promise<ImageMetadata | null>;
  onApply(): Promise<boolean>;
  onDiscard(): void;
  pickImage?: () => Promise<string | null>;
}

async function pickReplacementImage(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "皮肤图片", extensions: ["png", "jpg", "jpeg", "webp"] }],
  });
  return typeof selected === "string" ? selected : null;
}

export function ThemeInspector({
  draft,
  imagePath,
  imageMetadata,
  stagedImage,
  dirty,
  canDiscard = dirty,
  busy,
  onUpdateDraft,
  onStageImage,
  onApply,
  onDiscard,
  pickImage = pickReplacementImage,
}: ThemeInspectorProps) {
  const [activePage, setActivePage] = useState<InspectorPage>("image");
  const [synchronizeRegions, setSynchronizeRegions] = useState(false);
  const [imagePickerError, setImagePickerError] = useState<string | null>(null);
  const visibleImage = stagedImage ?? imageMetadata;
  const visiblePath = stagedImage?.path ?? imagePath;
  const artworkPosition = focusToPosition(draft.art.focusX, draft.art.focusY);

  return (
    <aside className="theme-inspector" aria-label="主题参数检查器">
      <header className="theme-inspector__header">
        <div>
          <p>03 / INSPECTOR</p>
          <h2>{draft.name}</h2>
        </div>
        <span data-dirty={dirty}>{dirty ? "未应用" : "已同步"}</span>
      </header>

      <InspectorTabs pages={INSPECTOR_PAGES} activePage={activePage} onPageChange={setActivePage} />

      <div className="theme-inspector__page-scroll">
        <section
          id={`inspector-panel-${activePage}`}
          role="tabpanel"
          aria-labelledby={`inspector-tab-${activePage}`}
          className="inspector-page"
        >
          {activePage === "image" ? renderImagePage() : null}
          {activePage === "composition" ? renderCompositionPage() : null}
          {activePage === "tone" ? renderTonePage() : null}
          {activePage === "effects" ? renderEffectsPage() : null}
          {activePage === "interface" ? renderInterfacePage() : null}
        </section>
      </div>

      <footer className="theme-inspector__footer theme-inspector__actions">
        <button type="button" className="brutal-button brutal-button--quiet" disabled={!canDiscard || busy} onClick={onDiscard}>放弃更改</button>
        <button type="button" className="brutal-button brutal-button--secondary" disabled={!dirty || busy} onClick={() => void onApply()}>应用更改</button>
      </footer>
    </aside>
  );

  function renderImagePage() {
    return (
      <InspectorSection title="图片" index="A">
        <div className="image-specimen">
          <dl>
            <div><dt>文件</dt><dd title={visiblePath}>{fileName(visiblePath)}</dd></div>
            <div><dt>尺寸</dt><dd>{visibleImage ? `${visibleImage.width} × ${visibleImage.height}` : "—"}</dd></div>
            <div><dt>大小</dt><dd>{visibleImage ? formatBytes(visibleImage.bytes) : "—"}</dd></div>
            <div><dt>格式</dt><dd>{visibleImage?.format.toUpperCase() ?? "—"}</dd></div>
          </dl>
          {stagedImage ? <p className="image-specimen__staged">待应用的新图片</p> : null}
          <button
            type="button"
            className="brutal-button brutal-button--quiet"
            disabled={busy}
            onClick={async () => {
              setImagePickerError(null);
              try {
                const path = await pickImage();
                if (path) await onStageImage(path);
              } catch (error) {
                setImagePickerError(error instanceof Error ? error.message : String(error));
              }
            }}
          >
            替换图片
          </button>
          {imagePickerError ? <p className="library-dialog__error" role="alert">无法打开图片选择器：{imagePickerError}</p> : null}
        </div>
      </InspectorSection>
    );
  }

  function renderCompositionPage() {
    return (
      <InspectorSection title="构图" index="B">
        <LabeledRange label="X 位置" value={artworkPosition.x} min={-100} max={100} step={1} unit="" resetValue={0} disabled={busy} onChange={(x) => onUpdateDraft({ art: { focusX: positionToFocus(x, artworkPosition.y).focusX } })} />
        <LabeledRange label="Y 位置" value={artworkPosition.y} min={-100} max={100} step={1} unit="" resetValue={0} disabled={busy} onChange={(y) => onUpdateDraft({ art: { focusY: positionToFocus(artworkPosition.x, y).focusY } })} />
        <LabeledRange label="缩放" value={Math.max(1, draft.art.scale)} min={1} max={2.5} step={0.05} unit="×" resetValue={DEFAULT_ART.scale} disabled={busy} onChange={(scale) => onUpdateDraft({ art: { scale } })} />
      </InspectorSection>
    );
  }

  function renderTonePage() {
    return (
      <InspectorSection title="色调" index="C">
        <div className="tone-mode-grid" role="radiogroup" aria-label="色调模式">
          {([
            ["original", "原始", "ORIGINAL"],
            ["grayscale", "黑白", "MONO"],
            ["duotone", "双色调", "DUO"],
            ["wash", "水洗色", "WASH"],
          ] as const).map(([value, label, code]) => (
            <label key={value} className="tone-mode-choice" data-selected={draft.effects.toneMode === value}>
              <input
                type="radio"
                name="tone-mode"
                aria-label={label}
                value={value}
                checked={draft.effects.toneMode === value}
                disabled={busy}
                onChange={() => onUpdateDraft({ effects: { toneMode: value as ToneMode } })}
              />
              <span>{label}</span>
              <small>{code}</small>
            </label>
          ))}
        </div>
        <PercentRange label="色调强度" value={draft.effects.toneStrength} resetValue={DEFAULT_EFFECTS.toneStrength} disabled={busy} onChange={(toneStrength) => onUpdateDraft({ effects: { toneStrength } })} />
        {draft.effects.toneMode === "duotone" ? (
          <div className="tone-color-pair">
            <ColorField label="暗部颜色" value={draft.effects.duotoneShadow} disabled={busy} onChange={(duotoneShadow) => onUpdateDraft({ effects: { duotoneShadow } })} />
            <ColorField label="亮部颜色" value={draft.effects.duotoneHighlight} disabled={busy} onChange={(duotoneHighlight) => onUpdateDraft({ effects: { duotoneHighlight } })} />
          </div>
        ) : null}
        {draft.effects.toneMode === "wash" ? (
          <ColorField label="水洗颜色" value={draft.effects.washColor} disabled={busy} onChange={(washColor) => onUpdateDraft({ effects: { washColor } })} />
        ) : null}
      </InspectorSection>
    );
  }

  function renderEffectsPage() {
    return (
      <InspectorSection title="光效" index="D">
        <PercentRange label="主页背景" value={draft.effects.homeOpacity} resetValue={DEFAULT_EFFECTS.homeOpacity} disabled={busy} onChange={(homeOpacity) => onUpdateDraft({ effects: { homeOpacity } })} />
        <PercentRange label="任务页背景" value={draft.effects.taskOpacity} resetValue={DEFAULT_EFFECTS.taskOpacity} disabled={busy} onChange={(taskOpacity) => onUpdateDraft({ effects: { taskOpacity } })} />
        <LabeledRange label="模糊度" value={draft.effects.blur} min={0} max={32} step={1} unit="px" resetValue={DEFAULT_EFFECTS.blur} disabled={busy} onChange={(blur) => onUpdateDraft({ effects: { blur } })} />
        <ScaledPercentRange label="饱和度" value={draft.effects.saturation} min={0} max={200} resetValue={DEFAULT_EFFECTS.saturation} disabled={busy} onChange={(saturation) => onUpdateDraft({ effects: { saturation } })} />
        <ScaledPercentRange label="亮度" value={draft.effects.brightness} min={50} max={150} resetValue={DEFAULT_EFFECTS.brightness} disabled={busy} onChange={(brightness) => onUpdateDraft({ effects: { brightness } })} />
        <PercentRange label="遮罩强度" value={draft.effects.maskStrength} resetValue={DEFAULT_EFFECTS.maskStrength} disabled={busy} onChange={(maskStrength) => onUpdateDraft({ effects: { maskStrength } })} />
      </InspectorSection>
    );
  }

  function renderInterfacePage() {
    return (
      <>
        <InspectorSection title="界面" index="E">
          <PercentRange
            label="界面背景透明度"
            value={draft.effects.interfaceOpacity}
            resetValue={DEFAULT_EFFECTS.interfaceOpacity}
            disabled={busy}
            onChange={(value) => onUpdateDraft(buildInterfaceOpacityPatch("interfaceOpacity", value, synchronizeRegions))}
          />
          <label className="region-sync-toggle">
            <input
              type="checkbox"
              aria-label="同步调整全部界面区域"
              checked={synchronizeRegions}
              disabled={busy}
              onChange={(event) => setSynchronizeRegions(event.target.checked)}
            />
            <span>同步调整全部界面区域</span>
            <small>{synchronizeRegions ? "任一滑块将同时更新全部区域" : "每个区域保持独立"}</small>
          </label>
          <PercentRange label="左侧栏透明度" value={draft.effects.leftSidebarOpacity} resetValue={DEFAULT_EFFECTS.leftSidebarOpacity} disabled={busy} onChange={(value) => onUpdateDraft(buildInterfaceOpacityPatch("leftSidebarOpacity", value, synchronizeRegions))} />
          <PercentRange label="顶栏透明度" value={draft.effects.topBarOpacity} resetValue={DEFAULT_EFFECTS.topBarOpacity} disabled={busy} onChange={(value) => onUpdateDraft(buildInterfaceOpacityPatch("topBarOpacity", value, synchronizeRegions))} />
          <PercentRange label="右侧栏（审阅面板）透明度" value={draft.effects.rightSidebarOpacity} resetValue={DEFAULT_EFFECTS.rightSidebarOpacity} disabled={busy} onChange={(value) => onUpdateDraft(buildInterfaceOpacityPatch("rightSidebarOpacity", value, synchronizeRegions))} />
          <PercentRange label="底栏（终端面板）透明度" value={draft.effects.bottomBarOpacity} resetValue={DEFAULT_EFFECTS.bottomBarOpacity} disabled={busy} onChange={(value) => onUpdateDraft(buildInterfaceOpacityPatch("bottomBarOpacity", value, synchronizeRegions))} />
          <PercentRange label="输入区透明度" value={draft.effects.inputOpacity} resetValue={DEFAULT_EFFECTS.inputOpacity} disabled={busy} onChange={(value) => onUpdateDraft(buildInterfaceOpacityPatch("inputOpacity", value, synchronizeRegions))} />
        </InspectorSection>

        <InspectorSection title="主页卡片" index="F">
          <BoundedPercentRange label="卡片透明度" value={draft.effects.homeCardOpacity} min={25} max={95} resetValue={DEFAULT_EFFECTS.homeCardOpacity} disabled={busy} onChange={(homeCardOpacity) => onUpdateDraft({ effects: { homeCardOpacity } })} />
          <LabeledRange label="卡片圆角" value={draft.effects.homeCardRadius} min={6} max={28} step={1} unit="px" resetValue={DEFAULT_EFFECTS.homeCardRadius} disabled={busy} onChange={(homeCardRadius) => onUpdateDraft({ effects: { homeCardRadius } })} />
          <BoundedPercentRange label="悬停提亮" value={draft.effects.homeCardHoverBrightness} min={100} max={125} resetValue={DEFAULT_EFFECTS.homeCardHoverBrightness} disabled={busy} onChange={(homeCardHoverBrightness) => onUpdateDraft({ effects: { homeCardHoverBrightness } })} />
        </InspectorSection>
      </>
    );
  }
}

type InterfaceOpacityField =
  | "interfaceOpacity"
  | "leftSidebarOpacity"
  | "topBarOpacity"
  | "rightSidebarOpacity"
  | "bottomBarOpacity"
  | "inputOpacity";

export function buildInterfaceOpacityPatch(
  changedField: InterfaceOpacityField,
  value: number,
  synchronized: boolean,
): ThemePatch {
  if (!synchronized) {
    return { effects: { [changedField]: value } as Partial<EffectSettings> };
  }
  return {
    effects: {
      interfaceOpacity: value,
      leftSidebarOpacity: value,
      topBarOpacity: value,
      rightSidebarOpacity: value,
      bottomBarOpacity: value,
      inputOpacity: value,
    },
  };
}

function InspectorSection({ title, index, children }: { title: string; index: string; children: React.ReactNode }) {
  return <section className="inspector-section"><header><span>{index}</span><h3>{title}</h3></header><div className="inspector-section__body">{children}</div></section>;
}

function ColorField({ label, value, disabled, onChange }: { label: string; value: string; disabled: boolean; onChange(value: string): void }) {
  return (
    <label className="inspector-color-field">
      <span>{label}</span>
      <input type="color" aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
      <output>{value.toUpperCase()}</output>
    </label>
  );
}

function PercentRange({ label, value, resetValue, disabled, onChange }: { label: string; value: number; resetValue: number; disabled: boolean; onChange(value: number): void }) {
  return <LabeledRange label={label} value={Math.round(value * 100)} min={0} max={100} step={1} unit="%" resetValue={Math.round(resetValue * 100)} disabled={disabled} onChange={(next) => onChange(next / 100)} />;
}

function ScaledPercentRange({ label, value, min, max, resetValue, disabled, onChange }: { label: string; value: number; min: number; max: number; resetValue: number; disabled: boolean; onChange(value: number): void }) {
  return <LabeledRange label={label} value={Math.round(value * 100)} min={min} max={max} step={5} unit="%" resetValue={Math.round(resetValue * 100)} disabled={disabled} onChange={(next) => onChange(next / 100)} />;
}

function BoundedPercentRange({ label, value, min, max, resetValue, disabled, onChange }: { label: string; value: number; min: number; max: number; resetValue: number; disabled: boolean; onChange(value: number): void }) {
  return <LabeledRange label={label} value={Math.round(value * 100)} min={min} max={max} step={1} unit="%" resetValue={Math.round(resetValue * 100)} disabled={disabled} onChange={(next) => onChange(next / 100)} />;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
