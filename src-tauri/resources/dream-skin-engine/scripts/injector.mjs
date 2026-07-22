import fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readImageMetadata } from "./image-metadata.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const here = path.dirname(scriptPath);
const root = path.resolve(here, "..");
const SKIN_VERSION = "1.6.0";
const MAX_ART_BYTES = 16 * 1024 * 1024;
const STRONG_THEME_AUDIT_MS = 30000;
const CDP_CLOSE_TIMEOUT_MS = 250;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const BROWSER_ID_PATTERN = /^[A-Za-z0-9._-]{1,200}$/;

class CdpIdentityMismatchError extends Error {}

export class OperationDeadline {
  constructor(timeoutMs, now = () => Date.now()) {
    this.now = now;
    this.expiresAt = now() + timeoutMs;
  }

  timeoutFor(maximumMs) {
    const remaining = this.expiresAt - this.now();
    if (remaining <= 0) throw new Error("CDP operation deadline exceeded");
    return Math.max(1, Math.min(maximumMs, remaining));
  }

  expired() {
    return this.now() >= this.expiresAt;
  }
}

function targetPriority(target) {
  try {
    const url = new URL(target.url);
    const route = url.searchParams.get("initialRoute");
    if (!route) return 0;
    if (route === "/avatar-overlay") return 2;
    return 1;
  } catch {
    return 3;
  }
}

export function orderCodexTargets(targets) {
  return [...targets].sort((left, right) => targetPriority(left) - targetPriority(right));
}

export function rendererConnectionFailureDetail(targetError, sawProbeMismatch) {
  if (targetError?.message) return targetError.message;
  if (sawProbeMismatch) return "No page matched the expected Codex shell markers";
  return "No valid Codex page target was advertised before the deadline";
}

async function sleepWithinDeadline(requestedDelay, deadline) {
  if (!deadline) {
    await new Promise((resolve) => setTimeout(resolve, requestedDelay));
    return;
  }
  if (deadline.expired()) return;
  const delay = Math.min(requestedDelay, deadline.timeoutFor(requestedDelay));
  await new Promise((resolve) => setTimeout(resolve, delay));
}

function parseArgs(argv) {
  const options = {
    port: 9335,
    mode: "watch",
    timeoutMs: 30000,
    screenshot: null,
    reload: false,
    browserId: null,
    themeDir: path.join(root, "assets"),
    pauseFile: null,
    heartbeatFile: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port") options.port = Number(argv[++i]);
    else if (arg === "--once") options.mode = "once";
    else if (arg === "--watch") options.mode = "watch";
    else if (arg === "--verify") options.mode = "verify";
    else if (arg === "--remove") options.mode = "remove";
    else if (arg === "--timeout-ms") options.timeoutMs = Number(argv[++i]);
    else if (arg === "--browser-id") options.browserId = argv[++i];
    else if (arg === "--theme-dir") options.themeDir = path.resolve(argv[++i]);
    else if (arg === "--pause-file") options.pauseFile = path.resolve(argv[++i]);
    else if (arg === "--heartbeat-file") options.heartbeatFile = path.resolve(argv[++i]);
    else if (arg === "--screenshot") options.screenshot = path.resolve(argv[++i]);
    else if (arg === "--reload") options.reload = true;
    else if (arg === "--self-test") options.mode = "self-test";
    else if (arg === "--check-payload") options.mode = "check-payload";
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) {
    throw new Error(`Invalid port: ${options.port}`);
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 250 || options.timeoutMs > 120000) {
    throw new Error(`Invalid timeout: ${options.timeoutMs}`);
  }
  if (options.browserId !== null && !BROWSER_ID_PATTERN.test(options.browserId)) {
    throw new Error(`Invalid browser ID: ${options.browserId}`);
  }
  if (["watch", "once", "verify", "remove"].includes(options.mode) && !options.browserId) {
    throw new Error(`--browser-id is required in ${options.mode} mode`);
  }
  if (options.mode === "watch" && !options.heartbeatFile) {
    throw new Error("--heartbeat-file is required in watch mode");
  }
  return options;
}

export async function writeWatcherHeartbeat(filePath, updatedAt = Date.now(), processId = process.pid) {
  const temporary = `${filePath}.${processId}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify({ processId, updatedAt })}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  await fs.rename(temporary, filePath);
}

export async function removeWatcherHeartbeat(filePath, processId = process.pid) {
  try {
    const heartbeat = JSON.parse(await fs.readFile(filePath, "utf8"));
    if (heartbeat.processId === processId) await fs.rm(filePath, { force: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function validatedDebuggerUrl(target, port) {
  const url = new URL(target.webSocketDebuggerUrl);
  const pathIsValid = /^\/devtools\/(?:page|browser)\/[A-Za-z0-9._-]{1,200}$/.test(url.pathname);
  if (url.protocol !== "ws:" || !LOOPBACK_HOSTS.has(url.hostname) || Number(url.port) !== port ||
      url.username || url.password || url.search || url.hash || !pathIsValid) {
    throw new Error("Rejected a CDP WebSocket URL outside the allowed loopback endpoint shape");
  }
  return url.href;
}

function parseCdpMessage(data) {
  try {
    const message = JSON.parse(String(data));
    return message && typeof message === "object" ? message : null;
  } catch {
    return null;
  }
}

function browserIdFromVersion(version, port) {
  const url = validatedDebuggerUrl(version, port);
  const parsed = new URL(url);
  const match = parsed.pathname.match(/^\/devtools\/browser\/([A-Za-z0-9._-]{1,200})$/);
  if (!match || parsed.search || parsed.hash || !BROWSER_ID_PATTERN.test(match[1])) {
    throw new Error("Rejected an invalid CDP browser identity URL");
  }
  return match[1];
}

function isValidCdpPageTarget(item, port) {
  if (item?.type !== "page" || !item.url?.startsWith("app://") || typeof item.id !== "string" ||
      !BROWSER_ID_PATTERN.test(item.id) || !item.webSocketDebuggerUrl) return false;
  try {
    const debuggerUrl = new URL(validatedDebuggerUrl(item, port));
    return debuggerUrl.pathname === `/devtools/page/${item.id}`;
  } catch {
    return false;
  }
}

export class CdpSession {
  constructor(target, port, deadline = null) {
    this.target = target;
    this.deadline = deadline;
    this.ws = new WebSocket(validatedDebuggerUrl(target, port));
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.closed = false;
    this.closePromise = null;
    this.resolveClose = null;
  }

  async open() {
    try {
      const openTimeoutMs = this.deadline?.timeoutFor(5000) ?? 5000;
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("CDP WebSocket open timed out"));
          this.close();
        }, openTimeoutMs);
        this.ws.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
        this.ws.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("CDP WebSocket open failed")); }, { once: true });
      });
      this.ws.addEventListener("message", (event) => this.onMessage(event));
      this.ws.addEventListener("error", () => this.close());
      this.ws.addEventListener("close", () => {
        this.closed = true;
        for (const waiter of this.pending.values()) {
          clearTimeout(waiter.timeout);
          waiter.reject(new Error("CDP socket closed"));
        }
        this.pending.clear();
        this.resolveClose?.();
      });
      await this.send("Runtime.enable");
      await this.send("Page.enable");
      return this;
    } catch (error) {
      await this.closeAndWait();
      throw error;
    }
  }

  onMessage(event) {
    const message = parseCdpMessage(event.data);
    if (!message) {
      this.close();
      return;
    }
    if (message.id) {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      clearTimeout(waiter.timeout);
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(`${message.error.message} (${message.error.code})`));
      else waiter.resolve(message.result);
      return;
    }
    for (const listener of this.listeners.get(message.method) ?? []) listener(message.params ?? {});
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  send(method, params = {}) {
    if (this.closed) return Promise.reject(new Error("CDP session is closed"));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, this.deadline?.timeoutFor(10000) ?? 10000);
      this.pending.set(id, { resolve, reject, timeout });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: false,
    });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
      throw new Error(`Renderer evaluation failed: ${detail}`);
    }
    return result.result?.value;
  }

  close() {
    return this.closeAndWait();
  }

  closeAndWait() {
    if (this.closePromise) return this.closePromise;
    if (this.closed) {
      this.closePromise = Promise.resolve();
      return this.closePromise;
    }

    this.closed = true;
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error("CDP session closed"));
    }
    this.pending.clear();
    let closeTimer = null;
    this.closePromise = new Promise((resolve) => {
      let settled = false;
      this.resolveClose = () => {
        if (settled) return;
        settled = true;
        if (closeTimer) clearTimeout(closeTimer);
        this.resolveClose = null;
        resolve();
      };
      this.ws.addEventListener("close", this.resolveClose, { once: true });
      closeTimer = setTimeout(this.resolveClose, CDP_CLOSE_TIMEOUT_MS);
    });
    try { this.ws.close(); } catch { this.resolveClose?.(); }
    return this.closePromise;
  }
}

async function closeSessionAndWait(session) {
  if (!session) return;
  if (typeof session.closeAndWait === "function") await session.closeAndWait();
  else await session.close?.();
}

class BrowserIdentityAnchor {
  constructor(url, deadline = null) {
    this.ws = new WebSocket(url);
    this.deadline = deadline;
    this.closed = false;
    this.ws.addEventListener("close", () => { this.closed = true; });
    this.ws.addEventListener("error", () => {
      this.closed = true;
      try { this.ws.close(); } catch {}
    });
  }

  async open() {
    let openTimeoutMs;
    try {
      openTimeoutMs = this.deadline?.timeoutFor(5000) ?? 5000;
    } catch (error) {
      this.close();
      throw error;
    }
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("CDP browser identity WebSocket open timed out"));
        this.close();
      }, openTimeoutMs);
      this.ws.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
      this.ws.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("CDP browser identity WebSocket open failed"));
      }, { once: true });
      this.ws.addEventListener("close", () => {
        clearTimeout(timeout);
        reject(new Error("CDP browser identity WebSocket closed during startup"));
      }, { once: true });
    });
    if (this.closed) throw new Error("CDP browser identity WebSocket is already closed");
    return this;
  }

  close() {
    if (!this.closed) {
      try { this.ws.close(); } catch {}
    }
    this.closed = true;
  }
}

async function fetchCdpJson(port, resource, deadline = null) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), deadline?.timeoutFor(2000) ?? 2000);
  try {
    const response = await fetch(`http://127.0.0.1:${port}${resource}`, {
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function listAppTargets(port, expectedBrowserId = null, deadline = null) {
  const targets = await fetchCdpJson(port, "/json/list", deadline);
  if (!Array.isArray(targets)) throw new Error("CDP target list is not an array");
  if (expectedBrowserId) {
    const version = await fetchCdpJson(port, "/json/version", deadline);
    const actualBrowserId = browserIdFromVersion(version, port);
    if (actualBrowserId !== expectedBrowserId) {
      throw new CdpIdentityMismatchError(
        `CDP browser identity changed from ${expectedBrowserId} to ${actualBrowserId}`,
      );
    }
  }
  return targets.filter((item) => isValidCdpPageTarget(item, port));
}

async function connectBrowserIdentityAnchor(port, expectedBrowserId, deadline = null) {
  const version = await fetchCdpJson(port, "/json/version", deadline);
  const actualBrowserId = browserIdFromVersion(version, port);
  if (actualBrowserId !== expectedBrowserId) {
    throw new CdpIdentityMismatchError(
      `CDP browser identity changed from ${expectedBrowserId} to ${actualBrowserId}`,
    );
  }
  return new BrowserIdentityAnchor(validatedDebuggerUrl(version, port), deadline).open();
}

const THEME_CHOICES = {
  appearance: new Set(["auto", "light", "dark"]),
  safeArea: new Set(["auto", "left", "right", "center", "none"]),
  taskMode: new Set(["auto", "ambient", "banner", "off"]),
  toneMode: new Set(["original", "grayscale", "duotone", "wash"]),
};

function normalizedUnit(value, name) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new Error(`${name} must be null or a number between 0 and 1`);
  }
  return number;
}

function normalizedNumber(value, name, minimum, maximum, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be a number between ${minimum} and ${maximum}`);
  }
  return value;
}

function normalizedChoice(value, name, choices, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (!choices.has(value)) throw new Error(`${name} has an unsupported value: ${value}`);
  return value;
}

function normalizedText(value, name, fallback, maxLength = 120) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string" || value.length > maxLength || /[\u0000-\u001f]/.test(value)) {
    throw new Error(`${name} must be a short single-line string`);
  }
  return value;
}

function normalizedHexColor(value, name, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(value)) {
    throw new Error(`${name} must be a six-digit hexadecimal color`);
  }
  return value;
}

async function loadTheme(themeDir) {
  const realThemeDir = await fs.realpath(themeDir);
  const themePath = path.join(realThemeDir, "theme.json");
  const themeText = await fs.readFile(themePath, "utf8");
  const raw = JSON.parse(themeText);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Theme root must be an object");
  }
  const image = normalizedText(raw.image, "image", null, 240);
  if (!image || path.isAbsolute(image)) throw new Error("Theme image must be a relative path");
  const imagePath = path.resolve(realThemeDir, image);
  const relativeImage = path.relative(realThemeDir, imagePath);
  if (!relativeImage || relativeImage.startsWith("..") || path.isAbsolute(relativeImage)) {
    throw new Error("Theme image must remain inside the selected theme directory");
  }
  const extension = path.extname(imagePath).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webp"].includes(extension)) {
    throw new Error(`Unsupported theme image format: ${extension || "missing"}`);
  }
  const realImagePath = await fs.realpath(imagePath);
  const realRelativeImage = path.relative(realThemeDir, realImagePath);
  if (!realRelativeImage || realRelativeImage.startsWith("..") || path.isAbsolute(realRelativeImage)) {
    throw new Error("Theme image cannot escape through a link or junction");
  }
  const art = raw.art && typeof raw.art === "object" && !Array.isArray(raw.art) ? raw.art : {};
  const effects = raw.effects && typeof raw.effects === "object" && !Array.isArray(raw.effects)
    ? raw.effects : {};
  const palette = raw.palette && typeof raw.palette === "object" && !Array.isArray(raw.palette)
    ? raw.palette : {};
  const schemaVersion = raw.schemaVersion ?? 1;
  if (![1, 2, 3, 4].includes(schemaVersion)) {
    throw new Error(`unsupported schemaVersion: ${schemaVersion}`);
  }
  const readInterfaceOpacity = (value, name) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`${name} must be a number between 0 and 1`);
    }
    return value;
  };
  const legacyInterfaceOpacity = () => {
    if (effects.interfaceOpacity !== undefined) {
      return readInterfaceOpacity(effects.interfaceOpacity, "effects.interfaceOpacity");
    }
    const regionKeys = ["leftSidebarOpacity", "topBarOpacity", "rightSidebarOpacity", "bottomBarOpacity"];
    const legacyKeys = ["sidebarOpacity", "composerOpacity"];
    const readPresent = (keys) => keys.flatMap((key) => effects[key] === undefined
      ? []
      : [readInterfaceOpacity(effects[key], `effects.${key}`)]);
    const regionValues = readPresent(regionKeys);
    const legacyValues = readPresent(legacyKeys);
    const values = regionValues.length > 0 ? regionValues : legacyValues;
    const mean = values.length > 0
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0.78;
    return Math.round(Math.min(1, Math.max(0, mean)) * 10000) / 10000;
  };
  const interfaceOpacity = legacyInterfaceOpacity();
  const regionOpacity = (field, legacyField = null) => {
    if (effects[field] !== undefined) return readInterfaceOpacity(effects[field], `effects.${field}`);
    if (legacyField && effects[legacyField] !== undefined) {
      return readInterfaceOpacity(effects[legacyField], `effects.${legacyField}`);
    }
    return interfaceOpacity;
  };
  const theme = {
    schemaVersion: 4,
    id: normalizedText(raw.id, "id", "custom", 80),
    name: normalizedText(raw.name, "name", "Codex Dream Skin", 120),
    image,
    appearance: normalizedChoice(raw.appearance, "appearance", THEME_CHOICES.appearance, "auto"),
    art: {
      focusX: normalizedUnit(art.focusX, "art.focusX"),
      focusY: normalizedUnit(art.focusY, "art.focusY"),
      scale: normalizedNumber(art.scale, "art.scale", 0.5, 2.5, 1),
      safeArea: normalizedChoice(art.safeArea, "art.safeArea", THEME_CHOICES.safeArea, "auto"),
      taskMode: normalizedChoice(art.taskMode, "art.taskMode", THEME_CHOICES.taskMode, "auto"),
    },
    effects: {
      homeOpacity: normalizedNumber(effects.homeOpacity, "effects.homeOpacity", 0, 1, 1),
      taskOpacity: normalizedNumber(effects.taskOpacity, "effects.taskOpacity", 0, 1, 0.18),
      blur: normalizedNumber(effects.blur, "effects.blur", 0, 32, 0),
      saturation: normalizedNumber(effects.saturation, "effects.saturation", 0, 2, 1),
      brightness: normalizedNumber(effects.brightness, "effects.brightness", 0.5, 1.5, 1),
      maskStrength: normalizedNumber(effects.maskStrength, "effects.maskStrength", 0, 1, 0.65),
      interfaceOpacity,
      leftSidebarOpacity: regionOpacity("leftSidebarOpacity", "sidebarOpacity"),
      topBarOpacity: regionOpacity("topBarOpacity"),
      rightSidebarOpacity: regionOpacity("rightSidebarOpacity"),
      bottomBarOpacity: regionOpacity("bottomBarOpacity", "composerOpacity"),
      toneMode: normalizedChoice(effects.toneMode, "effects.toneMode", THEME_CHOICES.toneMode, "original"),
      toneStrength: normalizedNumber(effects.toneStrength, "effects.toneStrength", 0, 1, 1),
      duotoneShadow: normalizedHexColor(effects.duotoneShadow, "effects.duotoneShadow", "#1C1B22"),
      duotoneHighlight: normalizedHexColor(effects.duotoneHighlight, "effects.duotoneHighlight", "#F2E9DC"),
      washColor: normalizedHexColor(effects.washColor, "effects.washColor", "#7D9FA5"),
    },
    palette: {},
  };
  if (typeof palette.accent === "string" && palette.accent.trim()) {
    const accent = palette.accent.trim();
    if (!/^(?:#[\da-f]{3,8}|(?:rgb|hsl|oklch|oklab)\([^;{}]{1,96}\))$/i.test(accent)) {
      throw new Error("palette.accent is not a supported CSS color");
    }
    theme.palette.accent = accent;
  }
  const [themeStat, imageStat] = await Promise.all([fs.stat(themePath), fs.stat(realImagePath)]);
  if (!imageStat.isFile()) throw new Error("Theme image is not a file");
  if (imageStat.size < 1) throw new Error("Theme image cannot be empty");
  if (imageStat.size > MAX_ART_BYTES) {
    throw new Error(`Theme image exceeds the ${MAX_ART_BYTES / 1024 / 1024} MB limit`);
  }
  const imageBytes = await fs.readFile(realImagePath);
  if (imageBytes.length < 1 || imageBytes.length > MAX_ART_BYTES) {
    throw new Error(`Theme image must be between 1 byte and ${MAX_ART_BYTES / 1024 / 1024} MB`);
  }
  const artMetadata = readImageMetadata(imageBytes, extension);
  if (!artMetadata) {
    throw new Error("Theme image metadata is invalid or exceeds the 16384px / 50MP safety limit");
  }
  theme.artMetadata = artMetadata;
  const fingerprint = createHash("sha256")
    .update(themeText, "utf8")
    .update("\0")
    .update(imageBytes)
    .digest("hex");
  return {
    theme,
    themePath,
    imagePath: realImagePath,
    imageBytes,
    fingerprint,
    sourceStamp: `${themeStat.size}:${themeStat.mtimeMs}:${imageStat.size}:${imageStat.mtimeMs}`,
  };
}

async function loadPayload(themeDir = path.join(root, "assets"), candidateTheme = null) {
  const loadedTheme = candidateTheme ?? await loadTheme(themeDir);
  const [css, template] = await Promise.all([
    fs.readFile(path.join(root, "assets", "dream-skin.css"), "utf8"),
    fs.readFile(path.join(root, "assets", "renderer-inject.js"), "utf8"),
  ]);
  const extension = path.extname(loadedTheme.imagePath).toLowerCase();
  const mime = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg"
    : extension === ".webp" ? "image/webp" : "image/png";
  const artDataUrl = `data:${mime};base64,${loadedTheme.imageBytes.toString("base64")}`;
  const payload = template
    .replace("__DREAM_CSS_JSON__", JSON.stringify(css))
    .replace("__DREAM_ART_JSON__", JSON.stringify(artDataUrl))
    .replace("__DREAM_THEME_JSON__", JSON.stringify(loadedTheme.theme));
  const { imageBytes: _imageBytes, ...themeState } = loadedTheme;
  return { ...themeState, payload };
}

async function fileExists(filePath) {
  if (!filePath) return false;
  try {
    return (await fs.stat(filePath)).isFile();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function readThemeSourceStamp(loadedTheme) {
  const [themeStat, imageStat] = await Promise.all([
    fs.stat(loadedTheme.themePath),
    fs.stat(loadedTheme.imagePath),
  ]);
  return `${themeStat.size}:${themeStat.mtimeMs}:${imageStat.size}:${imageStat.mtimeMs}`;
}

async function probeSession(session) {
  return session.evaluate(`(() => {
    const markers = {
      shell: Boolean(document.querySelector('main.main-surface')),
      sidebar: Boolean(document.querySelector('aside.app-shell-left-panel')),
      composer: Boolean(document.querySelector('.composer-surface-chrome')),
      main: Boolean(document.querySelector('[role="main"]')),
    };
    return {
      markers,
      codex: location.protocol === 'app:' && markers.shell && (markers.composer || markers.main),
    };
  })()`);
}

async function waitForCodexProbe(session, timeoutMs = 1800) {
  const deadline = Date.now() + timeoutMs;
  let probe = null;
  while (Date.now() < deadline) {
    try {
      probe = await probeSession(session);
      if (probe?.codex) return probe;
    } catch {
      // The renderer may be between documents while the early payload waits.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return probe;
}

async function connectTarget(target, port, deadline = null) {
  return new CdpSession(target, port, deadline).open();
}

export async function connectCodexTargets(port, deadline, expectedBrowserId, operations = {}) {
  const listTargets = operations.listAppTargets ?? listAppTargets;
  const connect = operations.connectTarget ?? connectTarget;
  const probe = operations.probeSession ?? probeSession;
  const sleep = operations.sleepWithinDeadline ?? sleepWithinDeadline;
  let lastError;
  while (!deadline.expired()) {
    try {
      const orderedTargets = orderCodexTargets(await listTargets(port, expectedBrowserId, deadline));
      const primaryTargets = orderedTargets.filter((target) => targetPriority(target) < 2);
      const targets = primaryTargets.length > 0 ? primaryTargets : orderedTargets;
      let targetError;
      let sawProbeMismatch = false;
      for (const target of targets) {
        let session;
        try {
          session = await connect(target, port, deadline);
          const probeResult = await probe(session);
          if (probeResult?.codex) return [{ target, session, probe: probeResult }];
          sawProbeMismatch = true;
          await closeSessionAndWait(session);
        } catch (error) {
          await closeSessionAndWait(session);
          targetError = error;
        }
      }
      lastError = new Error(rendererConnectionFailureDetail(targetError, sawProbeMismatch));
    } catch (error) {
      if (error instanceof CdpIdentityMismatchError) throw error;
      lastError = error;
    }
    await sleep(350, deadline);
  }
  throw new Error(
    `No verified Codex renderer on 127.0.0.1:${port}: ${lastError?.message ?? "deadline exceeded"}`,
  );
}

async function applyToSession(session, payload) {
  return session.evaluate(payload);
}

export function earlyPayloadFor(payload, revision) {
  return `(() => {
    const generationKey = "__CODEX_DREAM_SKIN_EARLY_GENERATION__";
    const appliedKey = "__CODEX_DREAM_SKIN_EARLY_APPLIED__";
    const generation = ${JSON.stringify(revision)};
    window[generationKey] = generation;
    let observer = null;
    let timeout = null;
    const stop = () => {
      observer?.disconnect();
      observer = null;
      if (timeout) clearTimeout(timeout);
      timeout = null;
    };
    const install = () => {
      if (window[generationKey] !== generation) { stop(); return true; }
      const root = document.documentElement;
      if (!root || !document.body) return false;
      const shell = document.querySelector('main.main-surface');
      if (!shell) return false;
      stop();
      ${payload};
      window[appliedKey] = generation;
      return true;
    };
    if (install()) return;
    if (typeof MutationObserver === "function" && document.documentElement) {
      observer = new MutationObserver(install);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
    timeout = setTimeout(stop, 10000);
  })()`;
}

async function registerEarlyPayload(session, payload, revision) {
  const result = await session.send("Page.addScriptToEvaluateOnNewDocument", {
    source: earlyPayloadFor(payload, revision),
  });
  return result.identifier ?? null;
}

async function removeEarlyPayload(session, identifier) {
  if (!identifier || session.closed) return;
  await session.send("Page.removeScriptToEvaluateOnNewDocument", { identifier }).catch(() => {});
}

async function removeFromSession(session) {
  return session.evaluate(`(() => {
    window.__CODEX_DREAM_SKIN_DISABLED__ = true;
    const state = window.__CODEX_DREAM_SKIN_STATE__;
    if (state?.cleanup) return state.cleanup();
    document.documentElement?.classList.remove(
      'codex-dream-skin', 'dream-theme-light', 'dream-theme-dark',
      'dream-art-wide', 'dream-art-standard', 'dream-focus-left',
      'dream-focus-center', 'dream-focus-right', 'dream-safe-left',
      'dream-safe-center', 'dream-safe-right', 'dream-safe-none',
      'dream-task-ambient', 'dream-task-banner', 'dream-task-off',
      'dream-tone-original', 'dream-tone-grayscale', 'dream-tone-duotone', 'dream-tone-wash',
      'dream-route-home', 'dream-route-task', 'dream-layout-left-open',
      'dream-layout-right-open', 'dream-layout-bottom-open'
    );
    for (const property of [
      '--dream-art', '--dream-art-position', '--dream-focus-x', '--dream-focus-y',
      '--dream-accent', '--dream-accent-ink', '--dream-image-luma',
      '--dream-home-opacity', '--dream-ambient-opacity', '--dream-art-blur',
      '--dream-art-saturation', '--dream-art-brightness', '--dream-mask-strength',
      '--dream-interface-opacity', '--dream-tone-mode', '--dream-tone-strength',
      '--dream-left-sidebar-opacity', '--dream-top-bar-opacity',
      '--dream-right-sidebar-opacity', '--dream-bottom-bar-opacity',
      '--dream-duotone-shadow', '--dream-duotone-highlight', '--dream-wash-color',
      '--dream-art-scale', '--dream-art-rendered-width', '--dream-art-rendered-height',
      '--dream-art-offset-x', '--dream-art-offset-y'
    ]) document.documentElement?.style.removeProperty(property);
    document.querySelectorAll('.dream-home').forEach((node) => node.classList.remove('dream-home'));
    document.querySelectorAll('.dream-task').forEach((node) => node.classList.remove('dream-task'));
    document.querySelectorAll('.dream-home-shell').forEach((node) => node.classList.remove('dream-home-shell'));
    for (const className of [
      'dream-surface-main', 'dream-surface-top', 'dream-surface-left',
      'dream-surface-right', 'dream-surface-bottom', 'dream-control-card', 'dream-control-input'
    ]) document.querySelectorAll('.' + className).forEach((node) => node.classList.remove(className));
    document.getElementById('codex-dream-skin-style')?.remove();
    document.getElementById('codex-dream-skin-chrome')?.remove();
    delete window.__CODEX_DREAM_SKIN_STATE__;
    return true;
  })()`);
}

async function verifyRemovedSession(session) {
  return session.evaluate(`(() =>
    !document.documentElement.classList.contains('codex-dream-skin') &&
    !document.documentElement.style.getPropertyValue('--dream-art') &&
    !document.querySelector('.dream-home') &&
    !document.querySelector('.dream-task') &&
    !document.querySelector('.dream-home-shell') &&
    !document.querySelector('.dream-surface-main, .dream-surface-top, .dream-surface-left, .dream-surface-right, .dream-surface-bottom') &&
    !document.querySelector('.dream-control-card, .dream-control-input') &&
    !document.getElementById('codex-dream-skin-style') &&
    !document.getElementById('codex-dream-skin-chrome') &&
    !window.__CODEX_DREAM_SKIN_STATE__
  )()`);
}

async function verifySession(session) {
  return session.evaluate(`(() => {
    const box = (node) => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    };
    const home = document.querySelector('.dream-home');
    const suggestions = home?.querySelector('.group\\\\/home-suggestions') ?? null;
    const cards = suggestions ? [...suggestions.querySelectorAll('button')].map(box) : [];
    const result = {
      installed: document.documentElement.classList.contains('codex-dream-skin'),
      version: window.__CODEX_DREAM_SKIN_STATE__?.version ?? null,
      expectedVersion: ${JSON.stringify(SKIN_VERSION)},
      stylePresent: Boolean(document.getElementById('codex-dream-skin-style')),
      chromePresent: Boolean(document.getElementById('codex-dream-skin-chrome')),
      chromePointerEvents: getComputedStyle(document.getElementById('codex-dream-skin-chrome') || document.body).pointerEvents,
      homePresent: Boolean(home),
      suggestionsPresent: Boolean(suggestions),
      hero: box(home?.firstElementChild?.firstElementChild?.firstElementChild),
      cards,
      composer: box(document.querySelector('.composer-surface-chrome')),
      sidebar: box(document.querySelector('aside.app-shell-left-panel')),
      mainSurface: box(document.querySelector('main.main-surface')),
      surfaces: window.__CODEX_DREAM_SKIN_STATE__?.surfaces ?? null,
      semantic: {
        main: Boolean(document.querySelector('main.main-surface.dream-surface-main')),
        left: Boolean(document.querySelector('aside.app-shell-left-panel.dream-surface-left')),
        bottom: Boolean(document.querySelector('.composer-surface-chrome.dream-surface-bottom')),
      },
      viewport: { width: innerWidth, height: innerHeight },
      documentOverflow: {
        x: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        y: document.documentElement.scrollHeight > document.documentElement.clientHeight,
      },
    };
    result.pass = result.installed && result.version === result.expectedVersion &&
      result.stylePresent && result.chromePresent &&
      result.chromePointerEvents === 'none' && Boolean(result.mainSurface) && result.semantic.main &&
      (!result.sidebar || result.semantic.left) && (!result.composer || result.semantic.bottom) &&
      (Boolean(result.composer) || Boolean(document.querySelector('[role="main"]'))) &&
      (!result.homePresent || (Boolean(result.hero) &&
        (!result.suggestionsPresent || (result.cards.length >= 2 && result.cards.length <= 4))));
    return result;
  })()`);
}

export function isInstalledVersionMismatch(result) {
  const live = typeof result?.version === "string" ? result.version.trim() : "";
  const expected = typeof result?.expectedVersion === "string" ? result.expectedVersion.trim() : "";
  return result?.installed === true && live.length > 0 && expected.length > 0 && live !== expected;
}

async function waitForVerifiedSession(session, deadline) {
  let lastResult;
  let lastError;
  while (!deadline.expired()) {
    try {
      lastResult = await verifySession(session);
      lastError = null;
      if (lastResult.pass || isInstalledVersionMismatch(lastResult)) return lastResult;
    } catch (error) {
      lastError = error;
    }
    await sleepWithinDeadline(500, deadline);
  }
  if (!lastResult && lastError) throw lastError;
  return lastResult;
}

async function capture(session, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const result = await session.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  await fs.writeFile(outputPath, Buffer.from(result.data, "base64"));
}

export async function finishOneShot(resultPromise, io = {
  write(value) {
    return new Promise((resolve, reject) => {
      process.stdout.write(value, (error) => error ? reject(error) : resolve());
    });
  },
  exit(code) { process.exitCode = code; },
}) {
  const result = await resultPromise;
  await io.write(result.output);
  io.exit(result.exitCode);
}

async function runOneShot(options) {
  const deadline = new OperationDeadline(options.timeoutMs);
  const connected = await connectCodexTargets(options.port, deadline, options.browserId);
  const loadedPayload = (options.mode === "once" || options.reload)
    ? await loadPayload(options.themeDir) : null;
  const payload = loadedPayload?.payload ?? null;
  const results = [];
  let screenshotCaptured = false;
  try {
    for (const { target, session, probe } of connected) {
      try {
        if (options.mode === "remove") await removeFromSession(session);
        else if (options.mode === "once") await applyToSession(session, payload);
        if (options.mode === "once") {
          await sleepWithinDeadline(850, deadline);
        }
        if (options.reload) {
          await session.send("Page.reload", { ignoreCache: true });
          await sleepWithinDeadline(1600, deadline);
          if (options.mode !== "remove") await applyToSession(session, payload);
        }
        const verified = options.mode === "remove"
          ? await verifyRemovedSession(session)
          : (options.reload || options.mode === "once" || options.mode === "verify")
            ? await waitForVerifiedSession(session, deadline)
            : await verifySession(session);
        results.push({ targetId: target.id, markers: probe.markers, result: verified });
        if (options.screenshot && !screenshotCaptured) {
          await capture(session, options.screenshot);
          screenshotCaptured = true;
        }
      } finally {
        await closeSessionAndWait(session);
      }
    }
  } finally {
    await Promise.all(connected.map(({ session }) => closeSessionAndWait(session)));
  }
  const failed = results.length === 0 || results.some((item) =>
    options.mode === "remove" ? item.result !== true : !item.result?.pass);
  return {
    output: `${JSON.stringify({ mode: options.mode, port: options.port, targets: results }, null, 2)}\n`,
    exitCode: failed ? 2 : 0,
  };
}

async function runWatch(options) {
  const identityAnchor = await connectBrowserIdentityAnchor(options.port, options.browserId);
  const sessions = new Map();
  const earlyScripts = new Map();
  const fallbackTargets = new Map();
  const fallbackListeners = new Set();
  const targetFailures = new Map();
  let stopping = false;
  let listFailures = 0;
  let lastListErrorLogAt = 0;
  let lastThemeErrorLogAt = 0;
  let lastStrongThemeAuditAt = 0;
  let loadedPayload = null;
  let paused = false;
  const stop = () => { stopping = true; };
  const rejectTarget = (target, baseDelayMs, error = null) => {
    const previous = targetFailures.get(target.id) ?? { failures: 0, lastLogAt: 0 };
    const failures = previous.failures + 1;
    const delayMs = Math.min(30000, baseDelayMs * (2 ** Math.min(failures - 1, 4)));
    const now = Date.now();
    if (error && (failures === 1 || now - previous.lastLogAt >= 30000)) {
      console.error(`[dream-skin] inject failed for ${target.id}: ${error.message}; retrying in ${delayMs}ms`);
      previous.lastLogAt = now;
    }
    targetFailures.set(target.id, { failures, lastLogAt: previous.lastLogAt, until: now + delayMs });
  };
  const attachLoadFallback = (id, target, session) => {
    if (fallbackListeners.has(id)) return;
    fallbackListeners.add(id);
    let lastReinjectErrorLogAt = 0;
    session.on("Page.loadEventFired", () => {
      if (!fallbackTargets.get(id)) return;
      setTimeout(() => {
        const operation = paused ? removeFromSession(session) : applyToSession(session, loadedPayload.payload);
        operation.catch((error) => {
          if (Date.now() - lastReinjectErrorLogAt >= 30000) {
            console.error(`[dream-skin] reinject failed for ${target.id}: ${error.message}`);
            lastReinjectErrorLogAt = Date.now();
          }
        });
      }, 250);
    });
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  try {
    loadedPayload = await loadPayload(options.themeDir);
    lastStrongThemeAuditAt = Date.now();
    paused = await fileExists(options.pauseFile);
    while (!stopping) {
      if (identityAnchor.closed) {
        console.error("[dream-skin] original CDP browser identity closed; watcher is stopping instead of reconnecting");
        process.exitCode = 3;
        break;
      }
      let targets = [];
      try {
        targets = await listAppTargets(options.port);
        listFailures = 0;
      } catch (error) {
        listFailures += 1;
        const retryMs = Math.min(10000, 1000 * (2 ** Math.min(listFailures - 1, 4)));
        if (listFailures === 1 || Date.now() - lastListErrorLogAt >= 30000) {
          console.error(`[dream-skin] ${new Date().toISOString()} ${error.message}; retrying in ${retryMs}ms`);
          lastListErrorLogAt = Date.now();
        }
        await new Promise((resolve) => setTimeout(resolve, retryMs));
        continue;
      }

      const nextPaused = await fileExists(options.pauseFile);
      let nextPayload = loadedPayload;
      if (!nextPaused) {
        try {
          const now = Date.now();
          let shouldAudit = !loadedPayload || now - lastStrongThemeAuditAt >= STRONG_THEME_AUDIT_MS;
          if (!shouldAudit) {
            try {
              shouldAudit = await readThemeSourceStamp(loadedPayload) !== loadedPayload.sourceStamp;
            } catch {
              shouldAudit = true;
            }
          }
          if (shouldAudit) {
            const candidateTheme = await loadTheme(options.themeDir);
            lastStrongThemeAuditAt = now;
            if (!loadedPayload || candidateTheme.fingerprint !== loadedPayload.fingerprint) {
              nextPayload = await loadPayload(options.themeDir, candidateTheme);
            } else {
              loadedPayload.sourceStamp = candidateTheme.sourceStamp;
            }
          }
        } catch (error) {
          if (Date.now() - lastThemeErrorLogAt >= 30000) {
            console.error(`[dream-skin] theme update rejected: ${error.message}; keeping the active theme`);
            lastThemeErrorLogAt = Date.now();
          }
        }
      }
      const pauseChanged = nextPaused !== paused;
      const payloadChanged = !nextPaused && nextPayload !== loadedPayload;
      loadedPayload = nextPayload;
      paused = nextPaused;

      if (pauseChanged || payloadChanged) {
        for (const [id, session] of sessions) {
          try {
            const previousEarlyScript = earlyScripts.get(id);
            if (paused) {
              await removeFromSession(session);
              await removeEarlyPayload(session, previousEarlyScript);
              earlyScripts.delete(id);
              fallbackTargets.delete(id);
              fallbackListeners.delete(id);
            } else {
              let nextEarlyScript = null;
              try {
                nextEarlyScript = await registerEarlyPayload(
                  session,
                  loadedPayload.payload,
                  loadedPayload.fingerprint,
                );
                if (!nextEarlyScript) throw new Error("CDP did not return an early-script identifier");
                fallbackTargets.set(id, false);
              } catch (error) {
                fallbackTargets.set(id, true);
                console.error(`[dream-skin] early theme refresh unavailable for ${id}: ${error.message}`);
                attachLoadFallback(id, { id }, session);
              }
              if (nextEarlyScript) earlyScripts.set(id, nextEarlyScript);
              else earlyScripts.delete(id);
              await removeEarlyPayload(session, previousEarlyScript);
              await applyToSession(session, loadedPayload.payload);
            }
          } catch (error) {
            console.error(`[dream-skin] live theme update failed for ${id}: ${error.message}`);
            await removeEarlyPayload(session, earlyScripts.get(id));
            earlyScripts.delete(id);
            fallbackTargets.delete(id);
            fallbackListeners.delete(id);
            session.close();
            sessions.delete(id);
          }
        }
        console.log(paused ? "[dream-skin] paused" : `[dream-skin] active theme ${loadedPayload.theme.id}`);
      }

      const activeIds = new Set(targets.map((target) => target.id));
      for (const id of targetFailures.keys()) {
        if (!activeIds.has(id)) targetFailures.delete(id);
      }
      for (const [id, session] of sessions) {
        if (!activeIds.has(id) || session.closed) {
          await removeEarlyPayload(session, earlyScripts.get(id));
          earlyScripts.delete(id);
          fallbackTargets.delete(id);
          fallbackListeners.delete(id);
          session.close();
          sessions.delete(id);
          targetFailures.delete(id);
        }
      }

      for (const target of targets) {
        if (identityAnchor.closed) break;
        if (sessions.has(target.id)) continue;
        if ((targetFailures.get(target.id)?.until ?? 0) > Date.now()) continue;
        let session;
        let earlyScriptId = null;
        try {
          session = await connectTarget(target, options.port);
          if (identityAnchor.closed) throw new CdpIdentityMismatchError("Original CDP browser identity closed");
          let earlyInjectionFallback = false;
          if (!paused) {
            try {
              earlyScriptId = await registerEarlyPayload(
                session,
                loadedPayload.payload,
                loadedPayload.fingerprint,
              );
              if (!earlyScriptId) throw new Error("CDP did not return an early-script identifier");
              await session.evaluate(earlyPayloadFor(loadedPayload.payload, loadedPayload.fingerprint));
            } catch (error) {
              await removeEarlyPayload(session, earlyScriptId);
              earlyScriptId = null;
              earlyInjectionFallback = true;
              console.error(`[dream-skin] early injection unavailable for ${target.id}: ${error.message}`);
            }
          }
          const probe = await waitForCodexProbe(session);
          if (!probe?.codex) {
            await removeEarlyPayload(session, earlyScriptId);
            rejectTarget(target, 5000);
            session.close();
            continue;
          }
          fallbackTargets.set(target.id, earlyInjectionFallback);
          if (earlyInjectionFallback) attachLoadFallback(target.id, target, session);
          if (identityAnchor.closed) throw new CdpIdentityMismatchError("Original CDP browser identity closed");
          let earlyApplied = false;
          if (!paused && !earlyInjectionFallback) {
            earlyApplied = await session.evaluate(
              `window.__CODEX_DREAM_SKIN_EARLY_APPLIED__ === ${JSON.stringify(loadedPayload.fingerprint)}`,
            ).catch(() => false);
          }
          if (paused) await removeFromSession(session);
          else if (!earlyApplied) await applyToSession(session, loadedPayload.payload);
          sessions.set(target.id, session);
          if (earlyScriptId) earlyScripts.set(target.id, earlyScriptId);
          targetFailures.delete(target.id);
          console.log(`[dream-skin] injected target ${target.id}`);
        } catch (error) {
          await removeEarlyPayload(session, earlyScriptId);
          fallbackTargets.delete(target.id);
          fallbackListeners.delete(target.id);
          session?.close();
          if (identityAnchor.closed || error instanceof CdpIdentityMismatchError) break;
          rejectTarget(target, 2500, error);
        }
      }
      await writeWatcherHeartbeat(options.heartbeatFile);
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  } finally {
    identityAnchor.close();
    for (const [id, session] of sessions) {
      await removeEarlyPayload(session, earlyScripts.get(id));
      session.close();
    }
    earlyScripts.clear();
    fallbackTargets.clear();
    fallbackListeners.clear();
    await removeWatcherHeartbeat(options.heartbeatFile);
  }
}

if (path.resolve(process.argv[1] || "") === path.resolve(scriptPath)) {
  const options = parseArgs(process.argv.slice(2));
  if (options.mode === "self-test") {
  const valid = validatedDebuggerUrl({ webSocketDebuggerUrl: `ws://127.0.0.1:${options.port}/devtools/page/test` }, options.port);
  const browserId = browserIdFromVersion({
    webSocketDebuggerUrl: `ws://127.0.0.1:${options.port}/devtools/browser/test-browser`,
  }, options.port);
  const invalid = [
    "ws://example.com/devtools/page/test",
    `ws://127.0.0.1:${options.port + 1}/devtools/page/test`,
    `wss://127.0.0.1:${options.port}/devtools/page/test`,
    `ws://user@127.0.0.1:${options.port}/devtools/page/test`,
    `ws://127.0.0.1:${options.port}/unexpected/test`,
    `ws://127.0.0.1:${options.port}/devtools/page/test?query=1`,
  ];
  for (const value of invalid) {
    let rejected = false;
    try { validatedDebuggerUrl({ webSocketDebuggerUrl: value }, options.port); } catch { rejected = true; }
    if (!rejected) throw new Error(`CDP URL validation accepted an unsafe URL: ${value}`);
  }
  const invalidBrowserUrls = [
    `ws://127.0.0.1:${options.port}/devtools/page/not-a-browser`,
    `ws://127.0.0.1:${options.port}/devtools/browser/bad%20id`,
    `ws://127.0.0.1:${options.port}/devtools/browser/test?query=1`,
  ];
  for (const value of invalidBrowserUrls) {
    let rejected = false;
    try { browserIdFromVersion({ webSocketDebuggerUrl: value }, options.port); } catch { rejected = true; }
    if (!rejected) throw new Error(`Browser identity validation accepted an unsafe URL: ${value}`);
  }
  const validPageTarget = {
    id: "page-test",
    type: "page",
    url: "app://codex/",
    webSocketDebuggerUrl: `ws://127.0.0.1:${options.port}/devtools/page/page-test`,
  };
  const invalidPageTargets = [
    { ...validPageTarget, webSocketDebuggerUrl: `ws://127.0.0.1:${options.port}/devtools/browser/page-test` },
    { ...validPageTarget, id: "other-page" },
    { ...validPageTarget, id: 123 },
    { ...validPageTarget, type: "other" },
  ];
  if (!valid || browserId !== "test-browser" || !isValidCdpPageTarget(validPageTarget, options.port) ||
      invalidPageTargets.some((item) => isValidCdpPageTarget(item, options.port))) {
    throw new Error("CDP URL and target validation self-test failed");
  }
  const validMessage = parseCdpMessage('{"id":7,"result":{"ok":true}}');
  const invalidMessages = ["{not-json", "null", '"text"', "42", "true"];
  if (validMessage?.id !== 7 || validMessage.result?.ok !== true ||
      invalidMessages.some((value) => parseCdpMessage(value) !== null)) {
    throw new Error("CDP message validation self-test failed");
  }
  if (/dispatchKeyEvent|dispatchMouseEvent/.test(capture.toString())) {
    throw new Error("Screenshot capture must not dispatch renderer input events");
  }
  await finishOneShot({
    output: `${JSON.stringify({ pass: true, version: SKIN_VERSION, test: "loopback-cdp-validation" })}\n`,
    exitCode: 0,
  });
  } else if (options.mode === "check-payload") {
    const loaded = await loadPayload(options.themeDir);
    const unresolved = ["__DREAM_CSS_JSON__", "__DREAM_ART_JSON__", "__DREAM_THEME_JSON__"]
      .some((placeholder) => loaded.payload.includes(placeholder));
    if (unresolved) {
      throw new Error("Payload placeholders were not fully replaced");
    }
    await finishOneShot({
      output: `${JSON.stringify({
        pass: true,
        version: SKIN_VERSION,
        payloadBytes: Buffer.byteLength(loaded.payload),
        themeId: loaded.theme.id,
        schemaVersion: loaded.theme.schemaVersion,
        appearance: loaded.theme.appearance,
        art: loaded.theme.art,
        effects: loaded.theme.effects,
        artMetadata: loaded.theme.artMetadata ?? null,
        unresolvedTemplateTokens: unresolved,
      })}\n`,
      exitCode: 0,
    });
  } else if (options.mode === "watch") await runWatch(options);
  else await finishOneShot(runOneShot(options));
}
