import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const engineRoot = path.resolve(here, "..");
const injectorPath = path.join(engineRoot, "scripts", "injector.mjs");
const rendererPath = path.join(engineRoot, "assets", "renderer-inject.js");
const cssPath = path.join(engineRoot, "assets", "dream-skin.css");
const referenceImage = path.join(engineRoot, "assets", "portal-hero.png");

const REMOVED_OPACITY_FIELDS = [
  "sidebarOpacity",
  "composerOpacity",
];

const DEFAULT_EFFECTS = {
  homeOpacity: 1,
  taskOpacity: 0.18,
  blur: 0,
  saturation: 1,
  brightness: 1,
  maskStrength: 0.65,
  interfaceOpacity: 0.78,
  leftSidebarOpacity: 0.78,
  topBarOpacity: 0.78,
  rightSidebarOpacity: 0.78,
  bottomBarOpacity: 0.78,
  toneMode: "original",
  toneStrength: 1,
  duotoneShadow: "#1C1B22",
  duotoneHighlight: "#F2E9DC",
  washColor: "#7D9FA5",
};

test("bundled default uses the redistributable Dream Portal artwork", async () => {
  const [theme, image] = await Promise.all([
    fs.readFile(path.join(engineRoot, "assets", "theme.json"), "utf8").then(JSON.parse),
    fs.readFile(referenceImage),
  ]);
  const { createHash } = await import("node:crypto");

  assert.equal(theme.id, "preset-dream-portal");
  assert.equal(theme.name, "梦境门户");
  assert.equal(theme.image, "portal-hero.png");
  assert.equal(
    createHash("sha256").update(image).digest("hex"),
    "31bde93bb02d6723e0b6aa0ead675577604120acb0a6799163dd37f5cdd0a08e",
  );
});

test("a verified installed-version mismatch ends verification immediately", async () => {
  const { isInstalledVersionMismatch } = await import(pathToFileURL(injectorPath).href);

  assert.equal(typeof isInstalledVersionMismatch, "function");
  assert.equal(isInstalledVersionMismatch({
    installed: true,
    version: "1.3.0",
    expectedVersion: "1.6.0",
    pass: false,
  }), true);
  assert.equal(isInstalledVersionMismatch({
    installed: true,
    version: "1.6.0",
    expectedVersion: "1.6.0",
    pass: false,
  }), false);
  assert.equal(isInstalledVersionMismatch({
    installed: false,
    version: "1.3.0",
    expectedVersion: "1.6.0",
    pass: false,
  }), false);
  assert.equal(isInstalledVersionMismatch({
    installed: true,
    version: null,
    expectedVersion: "1.6.0",
    pass: false,
  }), false);
});

async function withTheme(theme, callback) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dream-effects-"));
  try {
    await Promise.all([
      fs.copyFile(referenceImage, path.join(directory, "art.png")),
      fs.writeFile(path.join(directory, "theme.json"), JSON.stringify(theme), "utf8"),
    ]);
    return await callback(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

function checkPayload(themeDir) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [injectorPath, "--check-payload", "--theme-dir", themeDir], {
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

function baseTheme(overrides = {}) {
  return {
    schemaVersion: 4,
    id: "effects-test",
    name: "Effects Test",
    image: "art.png",
    appearance: "auto",
    art: { focusX: 0.5, focusY: 0.46, safeArea: "auto", taskMode: "auto" },
    ...overrides,
  };
}

test("schema 1 payload receives schema 4 scale and effect defaults", async () => {
  const theme = baseTheme({ schemaVersion: 1 });
  delete theme.effects;
  const result = await withTheme(theme, checkPayload);

  assert.equal(result.code, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.version, "1.6.0");
  assert.equal(output.schemaVersion, 4);
  assert.equal(output.art.scale, 1);
  assert.deepEqual(output.effects, DEFAULT_EFFECTS);
  assert.equal(output.unresolvedTemplateTokens, false);
});

test("schema 2 payload gives present region values precedence and rounds their mean", async () => {
  const result = await withTheme(baseTheme({
    schemaVersion: 2,
    effects: {
      leftSidebarOpacity: 0.2,
      topBarOpacity: 0.4,
      rightSidebarOpacity: 0.60003,
      sidebarOpacity: 1,
      composerOpacity: 1,
    },
  }), checkPayload);

  assert.equal(result.code, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.schemaVersion, 4);
  assert.equal(output.effects.interfaceOpacity, 0.4);
  assert.equal(output.effects.leftSidebarOpacity, 0.2);
  assert.equal(output.effects.topBarOpacity, 0.4);
  assert.equal(output.effects.rightSidebarOpacity, 0.60003);
  assert.equal(output.effects.bottomBarOpacity, 1);
  for (const field of REMOVED_OPACITY_FIELDS) assert.equal(field in output.effects, false, `retained ${field}`);
});

test("schema 2 payload averages legacy aliases when no region value is present", async () => {
  const result = await withTheme(baseTheme({
    schemaVersion: 2,
    effects: { sidebarOpacity: 0.31, composerOpacity: 0.47 },
  }), checkPayload);

  assert.equal(result.code, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.effects.interfaceOpacity, 0.39);
  assert.equal(output.effects.leftSidebarOpacity, 0.31);
  assert.equal(output.effects.topBarOpacity, 0.39);
  assert.equal(output.effects.rightSidebarOpacity, 0.39);
  assert.equal(output.effects.bottomBarOpacity, 0.47);
  assert.deepEqual(Object.keys(output.effects).sort(), Object.keys(DEFAULT_EFFECTS).sort());
});

test("schema 4 payload preserves every valid enhanced effect, region, and art scale", async () => {
  const effects = {
    homeOpacity: 0,
    taskOpacity: 1,
    blur: 32,
    saturation: 2,
    brightness: 0.5,
    maskStrength: 0,
    interfaceOpacity: 0.33339,
    leftSidebarOpacity: 0,
    topBarOpacity: 0.25,
    rightSidebarOpacity: 0.75,
    bottomBarOpacity: 1,
    toneMode: "duotone",
    toneStrength: 0.5,
    duotoneShadow: "#000000",
    duotoneHighlight: "#FFFFFF",
    washColor: "#123ABC",
  };
  const result = await withTheme(baseTheme({
    art: { focusX: 0, focusY: 1, scale: 2.5, safeArea: "none", taskMode: "banner" },
    effects,
  }), checkPayload);

  assert.equal(result.code, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.schemaVersion, 4);
  assert.equal(output.art.scale, 2.5);
  assert.deepEqual(output.effects, effects);
  assert.equal(output.unresolvedTemplateTokens, false);
});

test("injector rejects enhanced values outside the Rust ranges", async () => {
  const invalidCases = [
    ["art.scale", { art: { focusX: 0.5, focusY: 0.46, scale: 2.51, safeArea: "auto", taskMode: "auto" } }],
    ["effects.homeOpacity", { effects: { ...DEFAULT_EFFECTS, homeOpacity: -0.01 } }],
    ["effects.taskOpacity", { effects: { ...DEFAULT_EFFECTS, taskOpacity: 1.01 } }],
    ["effects.blur", { effects: { ...DEFAULT_EFFECTS, blur: 32.01 } }],
    ["effects.saturation", { effects: { ...DEFAULT_EFFECTS, saturation: 2.01 } }],
    ["effects.brightness", { effects: { ...DEFAULT_EFFECTS, brightness: 0.49 } }],
    ["effects.maskStrength", { effects: { ...DEFAULT_EFFECTS, maskStrength: "not-a-number" } }],
    ["effects.interfaceOpacity", { effects: { ...DEFAULT_EFFECTS, interfaceOpacity: 1.01 } }],
    ["effects.interfaceOpacity", { effects: { ...DEFAULT_EFFECTS, interfaceOpacity: null } }],
    ["effects.leftSidebarOpacity", { schemaVersion: 2, effects: { leftSidebarOpacity: null } }],
    ["effects.topBarOpacity", { effects: { ...DEFAULT_EFFECTS, topBarOpacity: 1.01 } }],
    ["effects.rightSidebarOpacity", { effects: { ...DEFAULT_EFFECTS, rightSidebarOpacity: -0.01 } }],
    ["effects.bottomBarOpacity", { effects: { ...DEFAULT_EFFECTS, bottomBarOpacity: null } }],
    ["effects.toneMode", { effects: { ...DEFAULT_EFFECTS, toneMode: "sepia" } }],
    ["effects.toneStrength", { effects: { ...DEFAULT_EFFECTS, toneStrength: 1.01 } }],
    ["effects.duotoneShadow", { effects: { ...DEFAULT_EFFECTS, duotoneShadow: "#123" } }],
    ["effects.duotoneHighlight", { effects: { ...DEFAULT_EFFECTS, duotoneHighlight: "red" } }],
    ["effects.washColor", { effects: { ...DEFAULT_EFFECTS, washColor: "#12345G" } }],
    ["effects.homeOpacity", { effects: { ...DEFAULT_EFFECTS, homeOpacity: "0.5" } }],
  ];

  for (const [field, overrides] of invalidCases) {
    const result = await withTheme(baseTheme(overrides), checkPayload);
    assert.notEqual(result.code, 0, `${field} unexpectedly passed`);
    assert.match(result.stderr, new RegExp(field.replace(".", "\\.")));
  }
});

function createClassList() {
  const values = new Set();
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    toggle: (name, force) => force ? (values.add(name), true) : (values.delete(name), false),
    contains: (name) => values.has(name),
  };
}

async function createRendererHarness(theme, options = {}) {
  const layout = {
    sidebarPresent: options.sidebarPresent ?? true,
    rightPresent: options.rightPresent ?? false,
    bottomPresent: options.bottomPresent ?? true,
    dockPresent: options.dockPresent ?? false,
  };
  const properties = new Map();
  const elements = new Map();
  const root = {
    classList: createClassList(),
    className: "",
    style: {
      setProperty: (name, value) => properties.set(name, value),
      removeProperty: (name) => properties.delete(name),
    },
    getAttribute: () => null,
  };
  const makeElement = (tagName, rectangle = { x: 0, y: 0, width: 100, height: 100 }) => ({
    tagName,
    isConnected: true,
    classList: createClassList(),
    dataset: {},
    style: { setProperty() {}, removeProperty() {} },
    parentElement: null,
    setAttribute() {},
    appendChild(child) { child.parentElement = this; if (child.id) elements.set(child.id, child); },
    remove() { if (this.id) elements.delete(this.id); },
    getBoundingClientRect() {
      return { ...rectangle, left: rectangle.x, top: rectangle.y,
        right: rectangle.x + rectangle.width, bottom: rectangle.y + rectangle.height };
    },
    matches(selector) {
      return selector === "aside.app-shell-left-panel" && this === sidebar;
    },
    querySelectorAll() { return []; },
  });
  const body = makeElement("body");
  const head = makeElement("head");
  const main = makeElement("main", { x: 220, y: 25, width: 1080, height: 805 });
  const sidebar = makeElement("aside", { x: 0, y: 25, width: 220, height: 805 });
  const right = makeElement("aside", { x: 980, y: 25, width: 320, height: 805 });
  const composer = makeElement("div", { x: 390, y: 730, width: 520, height: 90 });
  const dock = makeElement("div", { x: 220, y: 630, width: 1080, height: 200 });
  const dockSurface = makeElement("div", { x: 220, y: 630, width: 1080, height: 200 });
  dock.querySelectorAll = (selector) => selector === '[class~="bg-token-main-surface-primary"]' ? [dockSurface] : [];
  const document = {
    documentElement: root,
    body,
    head,
    querySelector(selector) {
      if (selector === "main.main-surface") return main;
      if (selector === "aside.app-shell-left-panel") return layout.sidebarPresent ? sidebar : null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "aside.app-shell-left-panel") return layout.sidebarPresent ? [sidebar] : [];
      if (selector === 'aside, [role="complementary"]') {
        return [
          ...(layout.sidebarPresent ? [sidebar] : []),
          ...(layout.rightPresent ? [right] : []),
        ];
      }
      if (selector.startsWith('aside[class~="z-[41]"') || selector.startsWith('aside[aria-label') ||
          selector.startsWith('[role="complementary"]')) return [];
      if (selector === ".composer-surface-chrome") return layout.bottomPresent ? [composer] : [];
      if (selector === 'main.main-surface [class~="shrink-0"][class~="overflow-visible"]') {
        return layout.dockPresent ? [dock] : [];
      }
      return [];
    },
    getElementById: (id) => elements.get(id) ?? null,
    createElement: (tagName) => makeElement(tagName),
  };
  const context = {
    window: {
      matchMedia: () => ({ matches: false }),
      addEventListener() {},
      removeEventListener() {},
      visualViewport: { addEventListener() {}, removeEventListener() {} },
    },
    document,
    MutationObserver: class { observe() {} disconnect() {} takeRecords() {} },
    URL: { createObjectURL: () => "blob:test-art", revokeObjectURL() {} },
    Blob: class {},
    Image: undefined,
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    Uint8Array,
    getComputedStyle: () => ({ colorScheme: "light", display: "block", visibility: "visible" }),
    innerWidth: 1300,
    innerHeight: 830,
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: (callback) => { callback(); return 1; },
    clearTimeout() {},
  };
  context.window.window = context.window;
  context.window.document = document;
  context.window.innerWidth = 1300;
  context.window.innerHeight = 830;
  const template = await fs.readFile(rendererPath, "utf8");
  const source = template
    .replace("__DREAM_CSS_JSON__", JSON.stringify(""))
    .replace("__DREAM_ART_JSON__", JSON.stringify("data:image/png;base64,AA=="))
    .replace("__DREAM_THEME_JSON__", JSON.stringify(theme));
  vm.runInNewContext(source, context);
  return { context, root, properties, elements, layout, main, sidebar, right, composer, dock, dockSurface };
}

test("renderer applies interface and independent region opacity variables and cleanup removes them", async () => {
  const effects = {
    homeOpacity: 0.84,
    taskOpacity: 0.27,
    blur: 7,
    saturation: 1.35,
    brightness: 0.9,
    maskStrength: 0.42,
    interfaceOpacity: 0.63,
    leftSidebarOpacity: 0.21,
    topBarOpacity: 0.32,
    rightSidebarOpacity: 0.43,
    bottomBarOpacity: 0.54,
    toneMode: "wash",
    toneStrength: 0.66,
    duotoneShadow: "#010203",
    duotoneHighlight: "#FDFCFB",
    washColor: "#456789",
  };
  const theme = baseTheme({
    art: { focusX: 0.5, focusY: 0.46, scale: 1.4, safeArea: "auto", taskMode: "auto" },
    effects,
  });
  const { context, root, properties, elements } = await createRendererHarness(theme);

  assert.equal(properties.get("--dream-interface-opacity"), "0.63");
  assert.equal(properties.get("--dream-left-sidebar-opacity"), "0.21");
  assert.equal(properties.get("--dream-top-bar-opacity"), "0.32");
  assert.equal(properties.get("--dream-right-sidebar-opacity"), "0.43");
  assert.equal(properties.get("--dream-bottom-bar-opacity"), "0.54");
  assert.equal(properties.has("--dream-sidebar-opacity"), false);
  assert.equal(properties.has("--dream-composer-opacity"), false);
  assert.equal(root.classList.contains("codex-dream-skin"), true);
  assert.ok(elements.has("codex-dream-skin-style"));
  assert.equal(context.window.__CODEX_DREAM_SKIN_STATE__.version, "1.6.0");
  assert.equal(context.window.__CODEX_DREAM_SKIN_STATE__.surfaces.main.available, true);

  assert.equal(context.window.__CODEX_DREAM_SKIN_STATE__.cleanup(), true);
  assert.equal(properties.size, 0);
  assert.equal(root.classList.contains("codex-dream-skin"), false);
  assert.equal(elements.has("codex-dream-skin-style"), false);
});

test("renderer stays installed while side panels and the bottom composer toggle", async () => {
  const harness = await createRendererHarness(baseTheme(), {
    sidebarPresent: false,
    rightPresent: false,
    bottomPresent: false,
    dockPresent: false,
  });
  const state = harness.context.window.__CODEX_DREAM_SKIN_STATE__;

  assert.equal(harness.root.classList.contains("codex-dream-skin"), true);
  assert.equal(harness.main.classList.contains("dream-surface-main"), true);
  assert.equal(state.surfaces.left.available, false);
  assert.equal(state.surfaces.right.available, false);
  assert.equal(state.surfaces.bottom.available, false);

  harness.layout.sidebarPresent = true;
  harness.layout.rightPresent = true;
  harness.layout.bottomPresent = true;
  harness.layout.dockPresent = true;
  state.ensure();
  assert.equal(harness.sidebar.classList.contains("dream-surface-left"), true);
  assert.equal(harness.right.classList.contains("dream-surface-right"), true);
  assert.equal(harness.composer.classList.contains("dream-surface-bottom"), true);
  assert.equal(harness.dock.classList.contains("dream-surface-bottom"), true);
  assert.equal(harness.dockSurface.classList.contains("dream-surface-bottom"), true);
  assert.equal(harness.root.classList.contains("dream-layout-left-open"), true);
  assert.equal(harness.root.classList.contains("dream-layout-right-open"), true);
  assert.equal(harness.root.classList.contains("dream-layout-bottom-open"), true);

  harness.layout.sidebarPresent = false;
  harness.layout.rightPresent = false;
  harness.layout.bottomPresent = false;
  harness.layout.dockPresent = false;
  state.ensure();
  assert.equal(harness.root.classList.contains("codex-dream-skin"), true);
  assert.equal(harness.sidebar.classList.contains("dream-surface-left"), false);
  assert.equal(harness.right.classList.contains("dream-surface-right"), false);
  assert.equal(harness.composer.classList.contains("dream-surface-bottom"), false);
  assert.equal(harness.dock.classList.contains("dream-surface-bottom"), false);
  assert.ok(harness.elements.has("codex-dream-skin-chrome"));
});

test("renderer discovers live semantic surfaces without a version-locked region contract", async () => {
  const [injector, renderer] = await Promise.all([
    fs.readFile(injectorPath, "utf8"),
    fs.readFile(rendererPath, "utf8"),
  ]);

  assert.doesNotMatch(injector, /region-contract\.js|codex-region-contract\.json|__DREAM_REGION_CONTRACT_JSON__/);
  assert.doesNotMatch(renderer, /REGION_CLASSES|regionContract|dream-region-|__DREAM_REGION_CONTRACT_JSON__/);
  assert.match(renderer, /applySemanticSurfaces/);
  assert.match(renderer, /dream-surface-right/);
  assert.match(renderer, /dream-control-card/);
  assert.match(renderer, /version:\s*"1\.6\.0"/);
});

test("CSS applies independent region opacity to actual semantic controls", async () => {
  const css = await fs.readFile(cssPath, "utf8");

  assert.match(css, /--dream-interface-opacity:\s*\.78/);
  for (const variable of [
    "--dream-left-sidebar-opacity",
    "--dream-top-bar-opacity",
    "--dream-right-sidebar-opacity",
    "--dream-bottom-bar-opacity",
    "--dream-tone-mode",
    "--dream-tone-strength",
    "--dream-duotone-shadow",
    "--dream-duotone-highlight",
    "--dream-wash-color",
  ]) assert.match(css, new RegExp(`${variable}:`));
  for (const removed of [
    "--dream-sidebar-opacity",
    "--dream-composer-opacity",
    "dream-region-",
  ]) assert.doesNotMatch(css, new RegExp(removed));

  for (const selector of [
    "aside.app-shell-left-panel",
    "[class~=\"group/application-menu-top-bar\"]",
    "header.app-header-tint",
    "main.main-surface",
    ".composer-surface-chrome",
    ".dream-home-utility",
    ".dream-surface-right",
    ".dream-control-card",
    ".dream-control-input",
  ]) assert.match(css, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(css, /calc\(var\(--dream-interface-opacity\) \* 100%\)/);
  assert.match(css, /aside\.app-shell-left-panel[\s\S]*var\(--dream-left-sidebar-opacity\)/);
  assert.match(css, /dream-surface-top[\s\S]*var\(--dream-top-bar-opacity\)/);
  assert.match(css, /dream-surface-right[\s\S]*var\(--dream-right-sidebar-opacity\)/);
  assert.match(css, /dream-surface-bottom[\s\S]*var\(--dream-bottom-bar-opacity\)/);
  for (const immersiveVariable of [
    "--dream-immersive-edge",
    "--dream-immersive-mid",
    "--dream-immersive-far",
    "--dream-task-immersive-edge",
    "--dream-task-immersive-mid",
    "--dream-task-immersive-far",
  ]) {
    assert.match(
      css,
      new RegExp(`color-mix\\(in oklab, var\\(${immersiveVariable}\\) calc\\(var\\(--dream-interface-opacity\\) \\* 100%\\), transparent\\)`),
    );
  }
  assert.match(css, /html\.codex-dream-skin \.dream-task\s*\{[^}]*var\(--dream-interface-opacity\)/s);
  assert.match(css, /html\.codex-dream-skin \.dream-home\s*\{[^}]*var\(--dream-interface-opacity\)/s);
  assert.doesNotMatch(css, /html\.codex-dream-skin\s+header(?:\s*[,\{])/);
  assert.match(css, /background-size:\s*var\(--dream-art-rendered-width\) var\(--dream-art-rendered-height\)/);
  assert.doesNotMatch(css, /(?:article|\[data-message-author-role\]|\.ProseMirror)[^{]*\{[^}]*(?:opacity|filter):/si);
});

test("renderer and CSS contain no content-avoidance behavior", async () => {
  const [renderer, css] = await Promise.all([
    fs.readFile(rendererPath, "utf8"),
    fs.readFile(cssPath, "utf8"),
  ]);

  assert.doesNotMatch(renderer, /dream-safe-/);
  assert.doesNotMatch(css, /dream-safe-/);
});
