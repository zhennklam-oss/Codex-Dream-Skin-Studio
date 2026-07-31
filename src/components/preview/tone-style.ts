import type { EffectSettings } from "../../domain/theme";

export interface ToneStyle {
  variables: {
    "--preview-tone-strength": string;
    "--preview-duotone-shadow": string;
    "--preview-duotone-highlight": string;
    "--preview-wash-color": string;
  };
  grayscaleVisible: boolean;
  duotoneVisible: boolean;
  washVisible: boolean;
}

export function buildToneStyle(effects: EffectSettings): ToneStyle {
  return {
    variables: {
      "--preview-tone-strength": String(effects.toneStrength),
      "--preview-duotone-shadow": effects.duotoneShadow,
      "--preview-duotone-highlight": effects.duotoneHighlight,
      "--preview-wash-color": effects.washColor,
    },
    grayscaleVisible: effects.toneMode === "grayscale" || effects.toneMode === "duotone",
    duotoneVisible: effects.toneMode === "duotone",
    washVisible: effects.toneMode === "wash",
  };
}
