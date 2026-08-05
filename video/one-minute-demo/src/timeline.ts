export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const TOTAL_FRAMES = 1800;

export const SCENES = {
  opening: {from: 0, duration: 240},
  studioIntro: {from: 240, duration: 240},
  themeSwitches: {from: 480, duration: 780},
  tone: {from: 1260, duration: 450},
  endCard: {from: 1710, duration: 90},
} as const;

export const COPY = {
  title: "Codex Dream Skin Studio",
  studio: "可视化设计，一键配置你的专属 Codex 皮肤",
  platform: "Windows · Open Source",
  attribution: "Inspired by the open-source project Codex Dream Skin on GitHub",
} as const;

export const THEME_SHOTS = [
  {studio: "captures/studio-theme-1.png", codex: "captures/codex-theme-1.png", label: "主题 01"},
  {studio: "captures/studio-theme-2.png", codex: "captures/codex-theme-2.png", label: "主题 02"},
  {studio: "captures/studio-theme-3.png", codex: "captures/codex-theme-3.png", label: "主题 03"},
] as const;

export const TONE_MODES = [
  {id: "original", label: "原色", source: "captures/studio-tone-original.png"},
  {id: "grayscale", label: "黑白", source: "captures/studio-tone-grayscale.png"},
  {id: "duotone", label: "双色调", source: "captures/studio-tone-duotone.png"},
  {id: "wash", label: "Wash", source: "captures/studio-tone-wash.png"},
] as const;
