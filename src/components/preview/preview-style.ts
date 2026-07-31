import type { ThemeDocument } from "../../domain/theme";

export type PreviewMode = "home" | "task";

export interface PreviewStyle {
  opacity: number;
  filter: string;
  maskStrength: number;
  interfaceOpacity: number;
  leftSidebarOpacity: number;
  topBarOpacity: number;
  rightSidebarOpacity: number;
  bottomBarOpacity: number;
  inputOpacity: number;
  homeCardOpacity: number;
  homeCardRadius: number;
  homeCardHoverBrightness: number;
  artworkVisible: boolean;
}

export function buildPreviewStyle(theme: ThemeDocument, mode: PreviewMode): PreviewStyle {
  const taskArtworkVisible = mode !== "task" || theme.art.taskMode !== "off";
  return {
    opacity: taskArtworkVisible
      ? mode === "home" ? theme.effects.homeOpacity : theme.effects.taskOpacity
      : 0,
    filter: `blur(${theme.effects.blur}px) saturate(${theme.effects.saturation}) brightness(${theme.effects.brightness})`,
    maskStrength: theme.effects.maskStrength,
    interfaceOpacity: theme.effects.interfaceOpacity,
    leftSidebarOpacity: theme.effects.leftSidebarOpacity,
    topBarOpacity: theme.effects.topBarOpacity,
    rightSidebarOpacity: theme.effects.rightSidebarOpacity,
    bottomBarOpacity: theme.effects.bottomBarOpacity,
    inputOpacity: theme.effects.inputOpacity,
    homeCardOpacity: theme.effects.homeCardOpacity,
    homeCardRadius: theme.effects.homeCardRadius,
    homeCardHoverBrightness: theme.effects.homeCardHoverBrightness,
    artworkVisible: taskArtworkVisible,
  };
}

export function stepPreviewScale(scale: number, deltaY: number): number {
  const current = clamp(scale, 1, 2.5);
  if (deltaY === 0) return current;
  const next = current + (deltaY < 0 ? 0.05 : -0.05);
  return clamp(Math.round(next * 20) / 20, 1, 2.5);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
