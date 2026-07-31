export interface WindowPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

export type FontPreset = "industrial" | "poster" | "mono";

export interface AppSettings {
  launchAtLogin: boolean;
  autoStartSkin: boolean;
  fontPreset: FontPreset;
  window: WindowPlacement | null;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  launchAtLogin: true,
  autoStartSkin: true,
  fontPreset: "industrial",
  window: null,
};
