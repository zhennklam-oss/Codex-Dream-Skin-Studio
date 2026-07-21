import { describe, expect, it } from "vitest";

import { DEFAULT_EFFECTS } from "../../domain/theme";
import { buildToneStyle } from "./tone-style";

describe("buildToneStyle", () => {
  it.each([
    ["original", false, false, false],
    ["grayscale", true, false, false],
    ["duotone", true, true, false],
    ["wash", false, false, true],
  ] as const)("maps %s to the expected tone layer stack", (toneMode, grayscaleVisible, duotoneVisible, washVisible) => {
    expect(buildToneStyle({ ...DEFAULT_EFFECTS, toneMode, toneStrength: 0.64 })).toEqual({
      variables: {
        "--preview-tone-strength": "0.64",
        "--preview-duotone-shadow": DEFAULT_EFFECTS.duotoneShadow,
        "--preview-duotone-highlight": DEFAULT_EFFECTS.duotoneHighlight,
        "--preview-wash-color": DEFAULT_EFFECTS.washColor,
      },
      grayscaleVisible,
      duotoneVisible,
      washVisible,
    });
  });

  it("preserves the selected colors in constrained CSS variables", () => {
    expect(buildToneStyle({
      ...DEFAULT_EFFECTS,
      toneMode: "duotone",
      toneStrength: 0.25,
      duotoneShadow: "#102030",
      duotoneHighlight: "#DDEEFF",
      washColor: "#71988F",
    }).variables).toEqual({
      "--preview-tone-strength": "0.25",
      "--preview-duotone-shadow": "#102030",
      "--preview-duotone-highlight": "#DDEEFF",
      "--preview-wash-color": "#71988F",
    });
  });
});
