import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";

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
  inputOpacity: 0.9,
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
  assert.equal(theme.schemaVersion, 5);
  assert.equal(theme.effects.inputOpacity, 0.9);
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
    expectedVersion: "1.7.0",
    pass: false,
  }), true);
  assert.equal(isInstalledVersionMismatch({
    installed: true,
    version: "1.7.0",
    expectedVersion: "1.7.0",
    pass: false,
  }), false);
  assert.equal(isInstalledVersionMismatch({
    installed: false,
    version: "1.3.0",
    expectedVersion: "1.7.0",
    pass: false,
  }), false);
  assert.equal(isInstalledVersionMismatch({
    installed: true,
    version: null,
    expectedVersion: "1.7.0",
    pass: false,
  }), false);
});

function passingRendererVerification(overrides = {}) {
  return {
    installed: true,
    version: "1.7.0",
    expectedVersion: "1.7.0",
    stylePresent: true,
    chromePresent: true,
    chromePointerEvents: "none",
    homePresent: true,
    homeMarker: { x: 620, y: 260, width: 24, height: 24 },
    suggestionsPresent: true,
    cards: Array.from({ length: 4 }, (_, index) => ({
      x: 420 + index * 170,
      y: 420,
      width: 160,
      height: 96,
    })),
    composer: { x: 425, y: 706, width: 736, height: 98 },
    sidebar: { x: 0, y: 36, width: 275, height: 784 },
    mainSurface: { x: 275, y: 36, width: 1035, height: 784 },
    bottomPanelVisible: false,
    semantic: { main: true, left: true, bottom: false, input: true },
    ...overrides,
  };
}

test("verification accepts the semantic home marker and rejects an off-screen composer", async () => {
  const { rendererVerificationPass } = await import(pathToFileURL(injectorPath).href);
  const currentHome = passingRendererVerification();

  assert.equal(rendererVerificationPass(currentHome, true), true);
  assert.equal(rendererVerificationPass({
    ...currentHome,
    semantic: { ...currentHome.semantic, input: false },
  }, true), false);
  assert.equal(rendererVerificationPass({ ...currentHome, homeMarker: null }, true), false);
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

test("schema 1 payload receives schema 5 scale and effect defaults", async () => {
  const theme = baseTheme({ schemaVersion: 1 });
  delete theme.effects;
  const result = await withTheme(theme, checkPayload);

  assert.equal(result.code, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.version, "1.7.0");
  assert.equal(output.schemaVersion, 5);
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
  assert.equal(output.schemaVersion, 5);
  assert.equal(output.effects.interfaceOpacity, 0.4);
  assert.equal(output.effects.leftSidebarOpacity, 0.2);
  assert.equal(output.effects.topBarOpacity, 0.4);
  assert.equal(output.effects.rightSidebarOpacity, 0.60003);
  assert.equal(output.effects.bottomBarOpacity, 0.4);
  assert.equal(output.effects.inputOpacity, 1);
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
  assert.equal(output.effects.bottomBarOpacity, 0.39);
  assert.equal(output.effects.inputOpacity, 0.47);
  assert.deepEqual(Object.keys(output.effects).sort(), Object.keys(DEFAULT_EFFECTS).sort());
});

test("schema 4 payload migrates composer-backed bottom opacity", async () => {
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
  assert.equal(output.schemaVersion, 5);
  assert.equal(output.art.scale, 2.5);
  assert.deepEqual(output.effects, {
    ...effects,
    bottomBarOpacity: effects.interfaceOpacity,
    inputOpacity: effects.bottomBarOpacity,
  });
  assert.equal(output.unresolvedTemplateTokens, false);
});

test("schema 5 payload preserves independent bottom and input opacity", async () => {
  const result = await withTheme(baseTheme({
    schemaVersion: 5,
    effects: { ...DEFAULT_EFFECTS, bottomBarOpacity: 0.42, inputOpacity: 0.83 },
  }), checkPayload);

  assert.equal(result.code, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.schemaVersion, 5);
  assert.equal(output.effects.bottomBarOpacity, 0.42);
  assert.equal(output.effects.inputOpacity, 0.83);
});

test("injector rejects unsupported schema 6", async () => {
  const result = await withTheme(baseTheme({ schemaVersion: 6 }), checkPayload);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /schemaVersion/);
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
    ["effects.bottomBarOpacity", { schemaVersion: 5, effects: { ...DEFAULT_EFFECTS, bottomBarOpacity: null } }],
    ["effects.inputOpacity", { schemaVersion: 5, effects: { ...DEFAULT_EFFECTS, inputOpacity: 1.01 } }],
    ["effects.inputOpacity", { schemaVersion: 5, effects: { ...DEFAULT_EFFECTS, inputOpacity: null } }],
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

function createClassList(initial = [], onChange = () => {}) {
  const values = new Set(initial);
  return {
    add: (...names) => {
      let changed = false;
      for (const name of names) {
        if (!values.has(name)) {
          values.add(name);
          changed = true;
        }
      }
      if (changed) onChange();
    },
    remove: (...names) => {
      let changed = false;
      for (const name of names) changed = values.delete(name) || changed;
      if (changed) onChange();
    },
    toggle(name, force) {
      const enabled = force === undefined ? !values.has(name) : force;
      const changed = enabled !== values.has(name);
      if (enabled) values.add(name);
      else values.delete(name);
      if (changed) onChange();
      return enabled;
    },
    contains: (name) => values.has(name),
  };
}

async function createRendererHarness(theme, options = {}) {
  const semanticSelectors = options.semanticSelectors ?? true;
  const rightControllerPresent = options.rightControllerPresent ?? true;
  const rightTabIdPresent = options.rightTabIdPresent ?? true;
  const layout = {
    sidebarPresent: options.sidebarPresent ?? true,
    rightPresent: options.rightPresent ?? false,
    bottomPresent: options.bottomPresent ?? true,
  };
  const properties = new Map();
  const elements = new Map();
  const fixtureNodes = [];
  const scheduledTimeouts = new Map();
  let nextTimeoutId = 1;
  let observerCallback = null;
  let observerActive = false;
  let emitClassMutation = () => {};
  const root = {
    classList: createClassList([], () => emitClassMutation(root)),
    className: "",
    style: {
      setProperty: (name, value) => properties.set(name, value),
      removeProperty: (name) => properties.delete(name),
    },
    getAttribute: () => null,
  };
  const selectorMatches = (node, selector) => {
    const candidate = selector.trim();
    if (!candidate || candidate.includes(" ") || candidate.includes("*=")) return false;
    if (candidate.includes(",")) {
      return candidate.split(",").some((part) => selectorMatches(node, part));
    }
    if (candidate.startsWith("input:not(")) {
      const type = node.getAttribute("type");
      return node.tagName.toLowerCase() === "input" && !["range", "checkbox", "radio"].includes(type);
    }
    const tag = candidate.match(/^([a-z][a-z0-9-]*)/i)?.[1];
    if (tag && node.tagName.toLowerCase() !== tag.toLowerCase()) return false;
    for (const className of candidate.matchAll(/\.([a-z0-9_-]+)/gi)) {
      if (!node.classList.contains(className[1])) return false;
    }
    for (const className of candidate.matchAll(/\[class~="([^"]+)"\]/g)) {
      if (!node.classList.contains(className[1])) return false;
    }
    const attributeSelectors = candidate.replace(/\[class~="[^"]+"\]/g, "");
    for (const attribute of attributeSelectors.matchAll(/\[([a-z0-9-]+)(?:="([^"]*)")?\]/gi)) {
      const actual = node.getAttribute(attribute[1]);
      if (actual === null || (attribute[2] !== undefined && actual !== attribute[2])) return false;
    }
    return true;
  };
  const descendants = (node) => node.children.flatMap((child) => [child, ...descendants(child)]);
  const queryWithin = (node, selector) => descendants(node).filter((candidate) =>
    isPresent(candidate) && selectorMatches(candidate, selector));
  const makeElement = (
    tagName,
    rectangle = { x: 0, y: 0, width: 100, height: 100 },
    initialAttributes = {},
  ) => {
    const attributes = new Map(Object.entries(initialAttributes));
    const node = {
      tagName,
      isConnected: true,
      classList: createClassList(
        (initialAttributes.class ?? "").split(/\s+/).filter(Boolean),
        () => emitClassMutation(node),
      ),
      dataset: {},
      style: { setProperty() {}, removeProperty() {} },
      parentElement: null,
      children: [],
      getAttribute(name) { return attributes.get(name) ?? null; },
      setAttribute(name, value) {
        attributes.set(name, String(value));
        if (name === "class") {
          for (const className of String(value).split(/\s+/).filter(Boolean)) this.classList.add(className);
        }
      },
      appendChild(child) {
        if (child.parentElement && child.parentElement !== this) {
          child.parentElement.children = child.parentElement.children.filter((candidate) => candidate !== child);
        }
        child.parentElement = this;
        if (!this.children.includes(child)) this.children.push(child);
        if (child.id) elements.set(child.id, child);
      },
      remove() {
        if (this.id) elements.delete(this.id);
        if (this.parentElement) {
          this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
        }
      },
      getBoundingClientRect() {
        return { ...rectangle, left: rectangle.x, top: rectangle.y,
          right: rectangle.x + rectangle.width, bottom: rectangle.y + rectangle.height };
      },
      matches(selector) { return selectorMatches(this, selector); },
      closest(selector) {
        for (let candidate = this; candidate; candidate = candidate.parentElement) {
          if (selectorMatches(candidate, selector)) return candidate;
        }
        return null;
      },
      querySelector(selector) { return queryWithin(this, selector)[0] ?? null; },
      querySelectorAll(selector) { return queryWithin(this, selector); },
    };
    fixtureNodes.push(node);
    return node;
  };
  const body = makeElement("body");
  const head = makeElement("head");
  const applicationRoot = makeElement("div");
  applicationRoot.id = "application-root";
  const selectionPortal = makeElement("div", undefined, { class: "fixed z-50" });
  selectionPortal.id = "selection-portal";
  const main = makeElement("main", { x: 220, y: 25, width: 1080, height: 805 }, {
    class: "main-surface",
  });
  const sidebar = makeElement("aside", { x: 0, y: 25, width: 220, height: 805 }, {
    class: "app-shell-left-panel",
  });
  const rightPanel = makeElement("aside", { x: 980, y: 25, width: 320, height: 805 }, {
    class: "z-[41] ml-auto shrink-0 overflow-visible",
    ...(semanticSelectors ? { "data-app-shell-focus-area": "right-panel" } : {}),
  });
  const reviewTab = makeElement("div", { x: 980, y: 25, width: 320, height: 805 }, {
    ...(semanticSelectors && rightControllerPresent
      ? { "data-app-shell-tab-panel-controller": "right" }
      : {}),
    ...(rightTabIdPresent ? { "data-tab-id": "diff" } : {}),
  });
  const bottomPanel = makeElement("div", { x: 220, y: 630, width: 1080, height: 200 }, {
    class: "shrink-0 overflow-visible",
    ...(semanticSelectors ? { "data-app-shell-focus-area": "bottom-panel" } : {}),
  });
  const bottomTab = makeElement("div", { x: 220, y: 630, width: 1080, height: 200 }, {
    ...(semanticSelectors ? { "data-app-shell-tab-panel-controller": "bottom" } : {}),
    "data-tab-id": "terminal",
  });
  const terminal = makeElement("div", { x: 240, y: 680, width: 1040, height: 130 }, {
    "data-codex-terminal": "true",
    "data-codex-xterm": "true",
  });
  const stickyComposerWrapper = makeElement("div", { x: 220, y: 700, width: 1080, height: 130 }, {
    class: "sticky bottom-0 mt-auto",
  });
  const composer = makeElement("div", { x: 390, y: 730, width: 520, height: 90 }, {
    class: "composer-surface-chrome",
  });
  const genericAside = makeElement("aside", { x: 1010, y: 80, width: 290, height: 600 }, {
    "aria-label": "Inspector panel",
  });
  const genericInput = makeElement("input", { x: 40, y: 760, width: 180, height: 32 }, {
    type: "text",
  });

  body.appendChild(applicationRoot);
  body.appendChild(selectionPortal);
  applicationRoot.appendChild(sidebar);
  applicationRoot.appendChild(main);
  applicationRoot.appendChild(rightPanel);
  applicationRoot.appendChild(genericAside);
  applicationRoot.appendChild(genericInput);
  rightPanel.appendChild(reviewTab);
  main.appendChild(bottomPanel);
  bottomPanel.appendChild(bottomTab);
  bottomTab.appendChild(terminal);
  main.appendChild(stickyComposerWrapper);
  stickyComposerWrapper.appendChild(composer);

  function isPresent(node) {
    if (node === sidebar && !layout.sidebarPresent) return false;
    if ((node === rightPanel || node === reviewTab) && !layout.rightPresent) return false;
    if ([bottomPanel, bottomTab, terminal].includes(node) && !layout.bottomPresent) return false;
    return node.parentElement ? isPresent(node.parentElement) : true;
  }

  const document = {
    documentElement: root,
    body,
    head,
    querySelector: (selector) => fixtureNodes.find((node) => isPresent(node) && selectorMatches(node, selector)) ?? null,
    querySelectorAll: (selector) => fixtureNodes.filter((node) => isPresent(node) && selectorMatches(node, selector)),
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
    MutationObserver: class {
      constructor(callback) { observerCallback = callback; }
      observe() { observerActive = true; }
      disconnect() { observerActive = false; }
      takeRecords() {}
    },
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
    setTimeout: (callback) => {
      if (!options.observeClassMutations) {
        callback();
        return 1;
      }
      const id = nextTimeoutId++;
      scheduledTimeouts.set(id, callback);
      return id;
    },
    clearTimeout: (id) => scheduledTimeouts.delete(id),
  };
  emitClassMutation = () => {
    if (options.observeClassMutations && observerActive) observerCallback?.();
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
  return {
    context,
    root,
    body,
    properties,
    elements,
    layout,
    makeElement,
    applicationRoot,
    selectionPortal,
    main,
    sidebar,
    rightPanel,
    reviewTab,
    bottomPanel,
    bottomTab,
    terminal,
    stickyComposerWrapper,
    composer,
    genericAside,
    genericInput,
    drainScheduledTimeouts(limit = 10) {
      let executions = 0;
      while (scheduledTimeouts.size > 0 && executions < limit) {
        const [id, callback] = scheduledTimeouts.entries().next().value;
        scheduledTimeouts.delete(id);
        callback();
        executions += 1;
      }
      return { executions, pending: scheduledTimeouts.size };
    },
  };
}

test("renderer applies schema 5 region and input opacity variables and cleanup removes them", async () => {
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
    inputOpacity: 0.74,
    toneMode: "wash",
    toneStrength: 0.66,
    duotoneShadow: "#010203",
    duotoneHighlight: "#FDFCFB",
    washColor: "#456789",
  };
  const theme = baseTheme({
    schemaVersion: 5,
    art: { focusX: 0.5, focusY: 0.46, scale: 1.4, safeArea: "auto", taskMode: "auto" },
    effects,
  });
  const { context, root, properties, elements } = await createRendererHarness(theme);

  assert.equal(properties.get("--dream-interface-opacity"), "0.63");
  assert.equal(properties.get("--dream-left-sidebar-opacity"), "0.21");
  assert.equal(properties.get("--dream-top-bar-opacity"), "0.32");
  assert.equal(properties.get("--dream-right-sidebar-opacity"), "0.43");
  assert.equal(properties.get("--dream-bottom-bar-opacity"), "0.54");
  assert.equal(properties.get("--dream-input-opacity"), "0.74");
  assert.equal(properties.has("--dream-sidebar-opacity"), false);
  assert.equal(properties.has("--dream-composer-opacity"), false);
  assert.equal(root.classList.contains("codex-dream-skin"), true);
  assert.equal(root.classList.contains("dream-input-custom"), true);
  assert.equal(elements.get("codex-dream-skin-style")?.dataset.dreamVersion, "6");
  assert.equal(context.window.__CODEX_DREAM_SKIN_STATE__.version, "1.7.0");
  assert.equal(context.window.__CODEX_DREAM_SKIN_STATE__.surfaces.main.available, true);

  assert.equal(context.window.__CODEX_DREAM_SKIN_STATE__.cleanup(), true);
  assert.equal(properties.size, 0);
  assert.equal(root.classList.contains("codex-dream-skin"), false);
  assert.equal(root.classList.contains("dream-input-custom"), false);
  assert.equal(elements.has("codex-dream-skin-style"), false);
});

test("renderer maps semantic side, review, bottom, and composer surfaces independently", async () => {
  const harness = await createRendererHarness(baseTheme(), {
    sidebarPresent: false,
    rightPresent: false,
    bottomPresent: false,
  });
  const state = harness.context.window.__CODEX_DREAM_SKIN_STATE__;

  assert.equal(harness.root.classList.contains("codex-dream-skin"), true);
  assert.equal(harness.main.classList.contains("dream-surface-main"), true);
  assert.equal(state.surfaces.left.available, false);
  assert.equal(state.surfaces.right.available, false);
  assert.equal(state.surfaces.bottom.available, false);
  assert.equal(state.surfaces.input.available, true);
  assert.equal(harness.composer.classList.contains("dream-surface-input"), true);
  assert.equal(harness.composer.classList.contains("dream-surface-bottom"), false);
  assert.equal(harness.genericAside.classList.contains("dream-surface-right"), false);
  assert.equal(harness.stickyComposerWrapper.classList.contains("dream-surface-bottom"), false);
  assert.equal(harness.genericInput.classList.contains("dream-control-input"), true);
  assert.equal(state.surfaces.input.count, 1);

  harness.layout.sidebarPresent = true;
  harness.layout.rightPresent = true;
  harness.layout.bottomPresent = true;
  state.ensure();
  assert.equal(harness.sidebar.classList.contains("dream-surface-left"), true);
  assert.equal(harness.rightPanel.classList.contains("dream-surface-right"), true);
  assert.equal(harness.bottomPanel.classList.contains("dream-surface-bottom"), true);
  assert.equal(harness.composer.classList.contains("dream-surface-input"), true);
  assert.equal(harness.composer.classList.contains("dream-surface-bottom"), false);
  assert.equal(harness.genericAside.classList.contains("dream-surface-right"), false);
  assert.equal(harness.stickyComposerWrapper.classList.contains("dream-surface-bottom"), false);
  assert.equal(state.surfaces.bottom.available, true);
  assert.equal(state.surfaces.right.available, true);
  assert.equal(state.surfaces.input.available, true);
  assert.equal(harness.root.classList.contains("dream-layout-left-open"), true);
  assert.equal(harness.root.classList.contains("dream-layout-right-open"), true);
  assert.equal(harness.root.classList.contains("dream-layout-bottom-open"), true);

  harness.layout.sidebarPresent = false;
  harness.layout.rightPresent = false;
  harness.layout.bottomPresent = false;
  state.ensure();
  assert.equal(harness.root.classList.contains("codex-dream-skin"), true);
  assert.equal(harness.sidebar.classList.contains("dream-surface-left"), false);
  assert.equal(harness.rightPanel.classList.contains("dream-surface-right"), false);
  assert.equal(harness.bottomPanel.classList.contains("dream-surface-bottom"), false);
  assert.equal(harness.composer.classList.contains("dream-surface-input"), true);
  assert.equal(harness.composer.classList.contains("dream-surface-bottom"), false);
  assert.ok(harness.elements.has("codex-dream-skin-chrome"));
});

test("renderer marks only the body app root and moves the marker when the app root changes", async () => {
  const harness = await createRendererHarness(baseTheme());
  const state = harness.context.window.__CODEX_DREAM_SKIN_STATE__;

  assert.equal(harness.applicationRoot.classList.contains("dream-skin-app-root"), true);
  assert.equal(harness.selectionPortal.classList.contains("dream-skin-app-root"), false);

  state.ensure();
  assert.equal(harness.applicationRoot.classList.contains("dream-skin-app-root"), true);
  assert.equal(harness.selectionPortal.classList.contains("dream-skin-app-root"), false);

  const nextApplicationRoot = harness.makeElement("div");
  harness.body.appendChild(nextApplicationRoot);
  nextApplicationRoot.appendChild(harness.main);
  state.ensure();
  assert.equal(harness.applicationRoot.classList.contains("dream-skin-app-root"), false);
  assert.equal(nextApplicationRoot.classList.contains("dream-skin-app-root"), true);
  assert.equal(harness.selectionPortal.classList.contains("dream-skin-app-root"), false);

  assert.equal(state.cleanup(), true);
  assert.equal(nextApplicationRoot.classList.contains("dream-skin-app-root"), false);
});

test("renderer app-root marker does not self-schedule ensure forever", async () => {
  const harness = await createRendererHarness(baseTheme(), { observeClassMutations: true });
  const drained = harness.drainScheduledTimeouts(8);

  assert.ok(drained.executions > 0, "the observer/debounce path must execute at least once");
  assert.equal(drained.pending, 0, "an unchanged app root must not schedule another ensure");
});

test("renderer limits panel fallbacks to the diff aside and terminal dock", async () => {
  const harness = await createRendererHarness(baseTheme(), {
    rightPresent: true,
    bottomPresent: true,
    semanticSelectors: false,
  });
  const state = harness.context.window.__CODEX_DREAM_SKIN_STATE__;

  assert.equal(harness.rightPanel.classList.contains("dream-surface-right"), true);
  assert.equal(harness.bottomPanel.classList.contains("dream-surface-bottom"), true);
  assert.equal(harness.genericAside.classList.contains("dream-surface-right"), false);
  assert.equal(harness.stickyComposerWrapper.classList.contains("dream-surface-bottom"), false);
  assert.equal(state.surfaces.right.count, 1);
  assert.equal(state.surfaces.bottom.count, 1);
});

test("renderer trusts the live semantic review host without a controller child", async () => {
  const harness = await createRendererHarness(baseTheme(), {
    rightPresent: true,
    bottomPresent: false,
    rightControllerPresent: false,
    rightTabIdPresent: false,
  });
  const state = harness.context.window.__CODEX_DREAM_SKIN_STATE__;

  assert.equal(harness.rightPanel.classList.contains("dream-surface-right"), true);
  assert.equal(state.surfaces.right.available, true);
  assert.equal(state.surfaces.right.count, 1);
});

test("renderer discovers live semantic surfaces without a version-locked region contract", async () => {
  const [injector, renderer] = await Promise.all([
    fs.readFile(injectorPath, "utf8"),
    fs.readFile(rendererPath, "utf8"),
  ]);

  assert.doesNotMatch(injector, /region-contract\.js|codex-region-contract\.json|__DREAM_REGION_CONTRACT_JSON__/);
  assert.doesNotMatch(renderer, /REGION_CLASSES|regionContract|dream-region-|__DREAM_REGION_CONTRACT_JSON__/);
  assert.match(renderer, /applySemanticSurfaces/);
  assert.match(renderer, /data-app-shell-focus-area.*bottom-panel/);
  assert.match(renderer, /data-app-shell-focus-area.*right-panel/);
  assert.doesNotMatch(renderer, /markAll\("bottom"[\s\S]*composer-surface-chrome/);
  assert.doesNotMatch(renderer, /HOME_UTILITY_CLASS|aria-label\*="(?:panel|sidebar)|aside, \[role="complementary"\]/);
  assert.doesNotMatch(renderer, /\[class~="sticky"\]\[class~="bottom-0"\]\[class~="mt-auto"\]/);
  assert.match(renderer, /dream-surface-right/);
  assert.match(renderer, /dream-surface-input/);
  assert.match(renderer, /dream-control-card/);
  assert.match(renderer, /version:\s*"1\.7\.0"/);
});

test("main surface preserves native selection and attachment overlays", async () => {
  const css = await fs.readFile(cssPath, "utf8");
  const mainSurfaceRule = css.match(
    /html\.codex-dream-skin main\.main-surface,\s*html\.codex-dream-skin \.dream-surface-main\s*\{([^}]*)\}/,
  );

  assert.ok(mainSurfaceRule, "missing main surface rule");
  assert.doesNotMatch(mainSurfaceRule[1], /overflow:\s*(?:hidden|clip)/);
  assert.doesNotMatch(mainSurfaceRule[1], /isolation:\s*isolate/);
});

test("chrome stays below the app root and native portals", async () => {
  const css = await fs.readFile(cssPath, "utf8");
  const relevantRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selector]) => [
      "#codex-dream-skin-chrome",
      ".dream-skin-app-root",
      "body > :not(#codex-dream-skin-chrome)",
      "main.main-surface",
      ".dream-task",
      ".dream-task > *",
    ].some((fragment) => selector.includes(fragment)))
    .map(([rule]) => rule)
    .join("\n");
  const dom = new JSDOM(`<!doctype html>
    <html class="codex-dream-skin">
      <head><style>
        .fixed { position: fixed; }
        .z-50 { z-index: 50; }
        ${relevantRules}
      </style></head>
      <body>
        <div id="application-root" class="dream-skin-app-root">
          <main class="main-surface">
            <section role="main" class="dream-task"><div id="task-content"></div></section>
          </main>
        </div>
        <div id="selection-portal" class="fixed z-50"></div>
        <div id="image-overlay" class="fixed z-50"></div>
        <div id="codex-dream-skin-chrome"></div>
      </body>
    </html>`);

  const chrome = dom.window.document.getElementById("codex-dream-skin-chrome");
  const appRoot = dom.window.document.getElementById("application-root");
  assert.equal(dom.window.getComputedStyle(chrome).zIndex, "0");
  assert.equal(dom.window.getComputedStyle(appRoot).position, "relative");
  assert.equal(dom.window.getComputedStyle(appRoot).zIndex, "1");

  for (const id of ["selection-portal", "image-overlay"]) {
    const computed = dom.window.getComputedStyle(dom.window.document.getElementById(id));
    assert.equal(computed.position, "fixed", `${id} position must remain official`);
    assert.equal(computed.zIndex, "50", `${id} z-index must remain official`);
  }
});

test("task content does not create broad stacking ownership", async () => {
  const css = await fs.readFile(cssPath, "utf8");
  const bodyChildRules = [...css.matchAll(/([^{}]*body\s*>\s*:not\([^{}]+\))\s*\{([^{}]*)\}/g)];
  const taskChildRules = [...css.matchAll(/([^{}]*\.dream-task\s*>\s*\*)\s*\{([^{}]*)\}/g)];
  const taskRule = css.match(/html\.codex-dream-skin\s+\.dream-task\s*\{([^{}]*)\}/);
  const stackingViolations = [...bodyChildRules, ...taskChildRules]
    .filter(([, , declarations]) => /(?:^|;)\s*(?:position|z-index)\s*:/.test(declarations))
    .map(([, selector]) => selector.trim());

  assert.deepEqual(stackingViolations, [], "broad selectors must not own arbitrary child stacking");
  assert.ok(taskRule, "missing task surface rule");
  assert.doesNotMatch(taskRule[1], /isolation:\s*isolate/);
});

test("CSS applies independent region opacity to actual semantic controls", async () => {
  const css = await fs.readFile(cssPath, "utf8");

  assert.match(css, /--dream-interface-opacity:\s*\.78/);
  assert.match(css, /--dream-input-opacity:\s*\.9/);
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
    ".dream-surface-right",
    ".dream-surface-bottom",
    ".dream-surface-input",
    ".dream-control-card",
    ".dream-control-input",
  ]) assert.match(css, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(css, /calc\(var\(--dream-interface-opacity\) \* 100%\)/);
  assert.match(css, /aside\.app-shell-left-panel[\s\S]*var\(--dream-left-sidebar-opacity\)/);
  assert.match(css, /dream-surface-top[\s\S]*var\(--dream-top-bar-opacity\)/);
  assert.match(css, /dream-surface-right[\s\S]*var\(--dream-right-sidebar-opacity\)/);
  assert.match(css, /dream-surface-bottom[\s\S]*var\(--dream-bottom-bar-opacity\)/);
  assert.match(css, /dream-surface-right \[data-app-shell-tabs\][\s\S]*background-color:\s*transparent/);
  assert.match(css, /dream-surface-bottom \[data-codex-terminal\][\s\S]*background-color:\s*transparent/);
  assert.doesNotMatch(css, /--thread-content-max-width/);
  assert.doesNotMatch(css, /dream-home-utility/);
  assert.doesNotMatch(css, /dream-surface-bottom\.composer-surface-chrome/);
  assert.match(css, /dream-input-custom[\s\S]*composer-surface-chrome\.dream-surface-input/);
  const composerRules = [...css.matchAll(/([^{}]*composer-surface-chrome[^{}]*)\{([^{}]*)\}/g)];
  assert.equal(composerRules.length, 1);
  assert.doesNotMatch(
    composerRules[0][2],
    /(?:^|[;\s])(?:border(?:-radius)?|box-shadow|backdrop-filter|max-width|width|padding|margin)\s*:/,
  );
  assert.doesNotMatch(css, /composer-surface-chrome::/);
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

test("home styling preserves native geometry", async () => {
  const css = await fs.readFile(cssPath, "utf8");

  assert.doesNotMatch(css, /\.dream-home\s*>\s*div:first-child/);
  assert.doesNotMatch(css, /\.dream-home \[data-testid="home-icon"\]\s*\{[^}]*display:\s*none/s);
  assert.match(css, /\.dream-home \[data-feature="game-source"\]/);
  assert.match(css, /\.dream-home \.group\\\/home-suggestions/);
});

test("renderer and CSS contain no content-avoidance behavior", async () => {
  const [renderer, css] = await Promise.all([
    fs.readFile(rendererPath, "utf8"),
    fs.readFile(cssPath, "utf8"),
  ]);

  assert.doesNotMatch(renderer, /dream-safe-/);
  assert.doesNotMatch(css, /dream-safe-/);
});
