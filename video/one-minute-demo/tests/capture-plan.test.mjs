import {describe, expect, it} from "vitest";
import {REQUIRED_CAPTURES} from "../scripts/capture-plan.mjs";

describe("capture plan", () => {
  it("contains every approved live-demo shot exactly once", () => {
    expect(REQUIRED_CAPTURES).toEqual([
      "codex-opening.png",
      "studio-overview.png",
      "studio-theme-1.png",
      "codex-theme-1.png",
      "studio-theme-2.png",
      "codex-theme-2.png",
      "studio-theme-3.png",
      "codex-theme-3.png",
      "studio-tone-original.png",
      "studio-tone-grayscale.png",
      "studio-tone-duotone.png",
      "studio-tone-wash.png",
      "studio-opacity.png",
      "codex-final.png",
    ]);
    expect(new Set(REQUIRED_CAPTURES).size).toBe(REQUIRED_CAPTURES.length);
  });
});
