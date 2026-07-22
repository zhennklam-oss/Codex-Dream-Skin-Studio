import { describe, expect, it } from "vitest";
import {
  DEFAULT_ART,
  DEFAULT_EFFECTS,
  normalizeTheme,
  validateTheme,
  type ThemeDocument,
} from "./theme";

describe("normalizeTheme", () => {
  it.each([
    [{ leftSidebarOpacity: 0.2, topBarOpacity: 0.4, rightSidebarOpacity: 0.6, bottomBarOpacity: 0.8 }, 0.5, [0.2, 0.4, 0.6, 0.5], 0.8],
    [{ leftSidebarOpacity: 0.2, rightSidebarOpacity: 0.7 }, 0.45, [0.2, 0.45, 0.7, 0.45], 0.9],
    [{ sidebarOpacity: 0.31, composerOpacity: 0.47 }, 0.39, [0.31, 0.39, 0.39, 0.39], 0.47],
    [{ composerOpacity: 0.33339 }, 0.3334, [0.3334, 0.3334, 0.3334, 0.3334], 0.33339],
    [{}, 0.78, [0.78, 0.78, 0.78, 0.78], 0.9],
  ])("migrates legacy opacity fields into schema five regions", (effects, expected, regions, inputOpacity) => {
    const theme = normalizeTheme({ schemaVersion: 2, id: "legacy", name: "Legacy", image: "art.jpg", effects });
    expect(theme.schemaVersion).toBe(5);
    expect(theme.effects.interfaceOpacity).toBe(expected);
    expect([
      theme.effects.leftSidebarOpacity,
      theme.effects.topBarOpacity,
      theme.effects.rightSidebarOpacity,
      theme.effects.bottomBarOpacity,
    ]).toEqual(regions);
    expect(theme.effects.inputOpacity).toBe(inputOpacity);
    for (const removed of ["sidebarOpacity", "composerOpacity"]) {
      expect(theme.effects).not.toHaveProperty(removed);
    }
  });

  it("migrates schema 4 composer-backed bottom opacity into input opacity", () => {
    const theme = normalizeTheme({
      schemaVersion: 4,
      id: "schema-four",
      name: "Schema Four",
      image: "art.jpg",
      effects: {
        interfaceOpacity: 0.61,
        leftSidebarOpacity: 0.2,
        topBarOpacity: 0.3,
        rightSidebarOpacity: 0.4,
        bottomBarOpacity: 0.27,
      },
    });

    expect(theme.schemaVersion).toBe(5);
    expect(theme.effects.inputOpacity).toBe(0.27);
    expect(theme.effects.bottomBarOpacity).toBe(0.61);
  });

  it("preserves independent schema 5 bottom and input opacity", () => {
    const theme = normalizeTheme({
      schemaVersion: 5,
      id: "schema-five",
      name: "Schema Five",
      image: "art.jpg",
      effects: {
        interfaceOpacity: 0.61,
        bottomBarOpacity: 0.42,
        inputOpacity: 0.83,
      },
    });

    expect(theme.effects.bottomBarOpacity).toBe(0.42);
    expect(theme.effects.inputOpacity).toBe(0.83);
  });

  it("uses composerOpacity as legacy input opacity", () => {
    const theme = normalizeTheme({
      schemaVersion: 2,
      id: "legacy-composer",
      name: "Legacy Composer",
      image: "art.jpg",
      effects: { sidebarOpacity: 0.31, composerOpacity: 0.47 },
    });

    expect(theme.effects.interfaceOpacity).toBe(0.39);
    expect(theme.effects.inputOpacity).toBe(0.47);
    expect(theme.effects.bottomBarOpacity).toBe(0.39);
  });

  it("rejects schema 5 input opacity outside the valid range", () => {
    expect(() => normalizeTheme({
      schemaVersion: 5,
      id: "bad-input",
      name: "Bad Input",
      image: "art.jpg",
      effects: { inputOpacity: 1.01 },
    })).toThrow(/inputOpacity/);
  });

  it("rejects out-of-range schema four interface and region opacity", () => {
    expect(() => normalizeTheme({
      schemaVersion: 4,
      id: "invalid",
      name: "Invalid",
      image: "art.jpg",
      effects: { ...DEFAULT_EFFECTS, interfaceOpacity: 1.01 },
    })).toThrow(/interfaceOpacity/);
    expect(() => normalizeTheme({
      schemaVersion: 4,
      id: "invalid-region",
      name: "Invalid Region",
      image: "art.jpg",
      effects: { ...DEFAULT_EFFECTS, rightSidebarOpacity: -0.01 },
    })).toThrow(/rightSidebarOpacity/);
  });

  it("prefers present region fields over legacy aliases", () => {
    const theme = normalizeTheme({
      schemaVersion: 2,
      id: "mixed",
      name: "Mixed",
      image: "art.jpg",
      effects: { leftSidebarOpacity: 0.2, topBarOpacity: 0.4, sidebarOpacity: 1, composerOpacity: 1 },
    });
    expect(theme.effects.interfaceOpacity).toBe(0.3);
    expect(theme.effects.leftSidebarOpacity).toBe(0.2);
    expect(theme.effects.topBarOpacity).toBe(0.4);
  });

  it.each([
    ["tone mode", { toneMode: "sepia" }, /toneMode/],
    ["shadow color", { duotoneShadow: "#123" }, /duotoneShadow/],
    ["highlight color", { duotoneHighlight: "red" }, /duotoneHighlight/],
    ["wash color", { washColor: "#12345G" }, /washColor/],
    ["tone strength", { toneStrength: 1.01 }, /toneStrength/],
  ])("rejects invalid %s", (_name, effects, expected) => {
    expect(() => normalizeTheme({
      schemaVersion: 2,
      id: "invalid",
      name: "Invalid",
      image: "art.jpg",
      effects: { ...DEFAULT_EFFECTS, ...effects },
    })).toThrow(expected);
  });

  it("normalizes schema one without losing metadata", () => {
    const theme = normalizeTheme({
      schemaVersion: 1,
      id: "preset-a",
      name: "A",
      image: "art.jpg",
      appearance: "auto",
      art: { focusX: 0.4, focusY: 0.6, safeArea: "left", taskMode: "ambient" },
      quote: "KEEP ME",
    });

    expect(theme.schemaVersion).toBe(5);
    expect(theme.art).toEqual({ ...DEFAULT_ART, focusX: 0.4, focusY: 0.6, safeArea: "left", taskMode: "ambient" });
    expect(theme.effects).toEqual(DEFAULT_EFFECTS);
    expect(theme.extra.quote).toBe("KEEP ME");
  });

  it("treats a missing schema version as schema one", () => {
    const theme = normalizeTheme({
      id: "custom-yingying",
      name: "Yingying",
      image: "art.jpg",
      appearance: "auto",
      art: { focusX: 0.5, focusY: 0.46, safeArea: "auto", taskMode: "auto" },
    });

    expect(theme.schemaVersion).toBe(5);
    expect(theme.art.scale).toBe(1);
  });

  it("defaults new and legacy themes without safe-area data to none", () => {
    const theme = normalizeTheme({
      schemaVersion: 2,
      id: "new-theme",
      name: "New Theme",
      image: "art.jpg",
      appearance: "auto",
      art: {},
    });

    expect(DEFAULT_ART.safeArea).toBe("none");
    expect(theme.art.safeArea).toBe("none");
  });

  it("migrates schema four values and merges existing extra metadata", () => {
    const theme = normalizeTheme({
      schemaVersion: 4,
      id: "complete",
      name: "Complete",
      image: "art.webp",
      appearance: "dark",
      art: { ...DEFAULT_ART, scale: 2.5, safeArea: "none", taskMode: "off" },
      effects: { ...DEFAULT_EFFECTS, blur: 32, saturation: 2, brightness: 1.5 },
      extra: { author: "A" },
      quote: "B",
    });

    expect(theme.appearance).toBe("dark");
    expect(theme.effects.blur).toBe(32);
    expect(theme.extra).toEqual({ author: "A", quote: "B" });
  });

  it("rejects unsupported schemas, enums, and malformed input", () => {
    const base = {
      schemaVersion: 2,
      id: "a",
      name: "A",
      image: "a.jpg",
      appearance: "auto",
      art: DEFAULT_ART,
      effects: DEFAULT_EFFECTS,
    };

    expect(() => normalizeTheme({ ...base, schemaVersion: 6 })).toThrow(/schemaVersion/);
    expect(() => normalizeTheme({ ...base, appearance: "sepia" })).toThrow(/appearance/);
    expect(() => normalizeTheme({ ...base, art: { ...DEFAULT_ART, safeArea: "top" } })).toThrow(/safeArea/);
    expect(() => normalizeTheme({ ...base, art: { ...DEFAULT_ART, taskMode: "full" } })).toThrow(/taskMode/);
    expect(() => normalizeTheme({ ...base, appearance: null })).toThrow(/appearance/);
    expect(() => normalizeTheme({ ...base, effects: { ...DEFAULT_EFFECTS, blur: null } })).toThrow(/blur/);
    expect(() => normalizeTheme(null)).toThrow(/object/);
  });
});

describe("validateTheme", () => {
  const validTheme = (): ThemeDocument => normalizeTheme({
    schemaVersion: 5,
    id: "id",
    name: "Name",
    image: "art.jpg",
    appearance: "light",
    art: DEFAULT_ART,
    effects: DEFAULT_EFFECTS,
  });

  it("accepts every inclusive numeric boundary", () => {
    const theme = validTheme();
    theme.art = { ...theme.art, focusX: 0, focusY: 1, scale: 0.5 };
    theme.effects = {
      homeOpacity: 0,
      taskOpacity: 1,
      blur: 32,
      saturation: 2,
      brightness: 1.5,
      maskStrength: 0,
      interfaceOpacity: 1,
      leftSidebarOpacity: 0,
      topBarOpacity: 1,
      rightSidebarOpacity: 0.5,
      bottomBarOpacity: 1,
      inputOpacity: 0,
      toneMode: "wash",
      toneStrength: 0,
      duotoneShadow: "#000000",
      duotoneHighlight: "#FFFFFF",
      washColor: "#123ABC",
    };

    expect(validateTheme(theme)).toEqual([]);
  });

  it.each([
    ["focus", (theme: ThemeDocument) => { theme.art.focusX = -0.01; }],
    ["scale", (theme: ThemeDocument) => { theme.art.scale = 2.51; }],
    ["opacity", (theme: ThemeDocument) => { theme.effects.interfaceOpacity = 1.2; }],
    ["blur", (theme: ThemeDocument) => { theme.effects.blur = 32.01; }],
    ["saturation", (theme: ThemeDocument) => { theme.effects.saturation = 2.01; }],
    ["brightness", (theme: ThemeDocument) => { theme.effects.brightness = 0.49; }],
    ["finite", (theme: ThemeDocument) => { theme.effects.taskOpacity = Number.NaN; }],
  ])("rejects out-of-range %s values", (_name, mutate) => {
    const theme = validTheme();
    mutate(theme);
    expect(validateTheme(theme)).not.toEqual([]);
  });
});
