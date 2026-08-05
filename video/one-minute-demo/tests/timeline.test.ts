import {describe, expect, it} from "vitest";
import {compositionConfig} from "../src/Root";
import {COPY, FPS, HEIGHT, SCENES, THEME_SHOTS, TONE_MODES, TOTAL_FRAMES, WIDTH} from "../src/timeline";

describe("demo timeline", () => {
  it("matches the approved 60-second 1080p specification", () => {
    expect({FPS, WIDTH, HEIGHT, TOTAL_FRAMES}).toEqual({
      FPS: 30,
      WIDTH: 1920,
      HEIGHT: 1080,
      TOTAL_FRAMES: 1800,
    });
    expect(SCENES).toEqual({
      opening: {from: 0, duration: 240},
      studioIntro: {from: 240, duration: 240},
      themeSwitches: {from: 480, duration: 780},
      tone: {from: 1260, duration: 450},
      endCard: {from: 1710, duration: 90},
    });
  });

  it("registers the approved Remotion composition metadata", () => {
    expect(compositionConfig).toEqual({
      id: "DreamSkinDemo",
      durationInFrames: 1800,
      fps: 30,
      width: 1920,
      height: 1080,
    });
  });

  it("contains the approved copy and visual sequence", () => {
    expect(COPY).toEqual({
      title: "Codex Dream Skin Studio",
      studio: "可视化设计，一键配置你的专属 Codex 皮肤",
      platform: "Windows · Open Source",
      attribution: "Inspired by the open-source project Codex Dream Skin on GitHub",
    });
    expect(THEME_SHOTS).toHaveLength(3);
    expect(TONE_MODES.map((item) => item.id)).toEqual(["original", "grayscale", "duotone", "wash"]);
  });
});
