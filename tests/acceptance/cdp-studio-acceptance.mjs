import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const port = Number(process.argv[2] ?? 9444);
const outputDir = path.resolve(process.argv[3] ?? "docs/verification");
const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
const target = targets.find((item) => item.type === "page" && item.url.startsWith("http://tauri.localhost"));
if (!target) throw new Error("Studio WebView target was not found");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 1;
const pending = new Map();
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  if (!message.id || !pending.has(message.id)) return;
  const handlers = pending.get(message.id);
  pending.delete(message.id);
  message.error ? handlers.reject(new Error(message.error.message)) : handlers.resolve(message.result);
});
function command(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function evaluate(expression) {
  const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function waitFor(expression, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}
async function capture(fileName) {
  await evaluate(`(() => { const strip = document.querySelector('.runtime-status-strip'); if (strip) strip.style.display = 'none'; return true; })()`);
  const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(path.join(outputDir, fileName), Buffer.from(screenshot.data, "base64"));
}

await command("Page.enable");
await mkdir(outputDir, { recursive: true });
await waitFor(`document.querySelectorAll('.theme-card').length >= 2 && document.querySelector('[data-testid="preview-codex-grid"]')`);
await evaluate(`document.querySelector('.theme-inspector__footer button:first-child:not(:disabled)')?.click()`);
await sleep(300);

// The installed injector can legitimately be one version behind until a separately approved
// lifecycle restart. Dismiss only the visual diagnostic so screenshots remain readable.
await evaluate(`document.querySelector('.runtime-status-strip button:last-child')?.click()`);

const settingsPath = path.join(process.env.LOCALAPPDATA, "CodexDreamSkinStudio", "settings.json");
const settingsBefore = JSON.parse(await readFile(settingsPath, "utf8"));
if (settingsBefore.autoStartSkin !== false) throw new Error("UI acceptance requires autoStartSkin=false");

const deleteContract = await evaluate(`(() => {
  const cards = [...document.querySelectorAll('.theme-card')];
  const deletes = cards.map(card => [...card.querySelectorAll('button')].find(button => button.getAttribute('aria-label')?.startsWith('删除 ')));
  return { cardCount: cards.length, deleteCount: deletes.filter(Boolean).length, enabledCount: deletes.filter(button => button && !button.disabled).length };
})()`);
if (deleteContract.cardCount < 2 || deleteContract.deleteCount !== deleteContract.cardCount || deleteContract.enabledCount !== deleteContract.cardCount) {
  throw new Error(`Every theme must expose an enabled delete button: ${JSON.stringify(deleteContract)}`);
}

await evaluate(`(() => { if (!document.querySelector('#runtime-settings-band')) document.querySelector('.runtime-settings-toggle')?.click(); return true; })()`);
await waitFor(`document.querySelector('#runtime-settings-band')`);
const inlineSettings = await evaluate(`(() => {
  const band = document.querySelector('#runtime-settings-band').getBoundingClientRect();
  const library = document.querySelector('.studio-shell__library').getBoundingClientRect();
  const inspector = document.querySelector('.studio-shell__inspector').getBoundingClientRect();
  const labels = [...document.querySelectorAll('.startup-settings > label, .font-preset-settings')].map(node => node.getBoundingClientRect());
  const overlaps = labels.some((a, index) => labels.slice(index + 1).some(b => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top));
  return { band: { top: band.top, bottom: band.bottom, height: band.height }, contentTop: Math.min(library.top, inspector.top), overlaps };
})()`);
if (inlineSettings.band.height <= 0 || inlineSettings.band.bottom > inlineSettings.contentTop + 1 || inlineSettings.overlaps) {
  throw new Error(`Startup settings overlap layout: ${JSON.stringify(inlineSettings)}`);
}

const presets = {};
for (const preset of ["industrial", "poster", "mono"]) {
  await waitFor(`!document.querySelector('input[name="font-preset"][value="${preset}"]').disabled`);
  await evaluate(`document.querySelector('input[name="font-preset"][value="${preset}"]').click()`);
  await waitFor(`document.documentElement.dataset.fontPreset === '${preset}'`);
  await waitFor(`!document.querySelector('input[name="font-preset"][value="${preset}"]').disabled`);
  await evaluate(`document.fonts.ready.then(() => true)`);
  presets[preset] = await evaluate(`(() => ({
    dataset: document.documentElement.dataset.fontPreset,
    body: getComputedStyle(document.body).fontFamily,
    display: getComputedStyle(document.querySelector('.theme-library__header h2')).fontFamily,
    mono: getComputedStyle(document.querySelector('.runtime-bar__readouts')).fontFamily,
    harmonyCjk: document.fonts.check('16px "HarmonyOS Sans SC"', '中文 Codex'),
    smileyCjk: document.fonts.check('16px "Smiley Sans"', '中文 Codex'),
    sarasaCjk: document.fonts.check('16px "Sarasa Mono SC"', '中文 Codex')
  }))()`);
  if (presets[preset].dataset !== preset) throw new Error(`Preset did not apply: ${preset}`);
}
if (!presets.industrial.body.includes("HarmonyOS Sans SC") || !presets.poster.display.includes("Smiley Sans") || !presets.mono.body.includes("Sarasa Mono SC")) {
  throw new Error(`Computed font families do not match presets: ${JSON.stringify(presets)}`);
}
if (!presets.industrial.harmonyCjk || !presets.poster.smileyCjk || !presets.poster.harmonyCjk || !presets.mono.sarasaCjk) {
  throw new Error(`Bundled CJK font faces did not load: ${JSON.stringify(presets)}`);
}
await evaluate(`document.querySelector('input[name="font-preset"][value="industrial"]').click()`);
await waitFor(`document.documentElement.dataset.fontPreset === 'industrial'`);
await capture("studio-settings-inline.png");
await evaluate(`document.querySelector('.runtime-settings-toggle')?.click()`);

const tabContract = await evaluate(`(() => ({
  labels: [...document.querySelectorAll('.inspector-tabs [role="tab"]')].map(tab => tab.textContent.trim()),
  selected: document.querySelectorAll('.inspector-tabs [aria-selected="true"]').length,
  panels: document.querySelectorAll('.theme-inspector [role="tabpanel"]').length,
  footerVisible: getComputedStyle(document.querySelector('.theme-inspector__footer')).display !== 'none',
  avoidance: document.body.innerText.includes('内容避让区') || !!document.querySelector('.safe-area, .focus-crosshair')
}))()`);
if (tabContract.labels.length !== 5 || tabContract.selected !== 1 || tabContract.panels !== 1 || !tabContract.footerVisible || tabContract.avoidance) {
  throw new Error(`Inspector tab contract failed: ${JSON.stringify(tabContract)}`);
}
await capture("studio-inspector-tabs.png");

await evaluate(`document.querySelector('#inspector-tab-tone').click()`);
const toneContract = await evaluate(`(() => ({
  modes: [...document.querySelectorAll('input[name="tone-mode"]')].map(input => input.value),
  strength: document.querySelector('.inspector-page input[type="range"]')?.getAttribute('max')
}))()`);
if (toneContract.modes.join(",") !== "original,grayscale,duotone,wash" || toneContract.strength !== "100") {
  throw new Error(`Tone controls are incomplete: ${JSON.stringify(toneContract)}`);
}
for (const mode of ["grayscale", "duotone", "wash", "original"]) {
  await evaluate(`document.querySelector('input[name="tone-mode"][value="${mode}"]').click()`);
  await waitFor(`document.querySelector('[data-testid="preview-tone-${mode === "original" ? "grayscale" : mode}"]') !== null`);
}
await evaluate(`document.querySelector('input[name="tone-mode"][value="duotone"]').click()`);
await capture("studio-tone-modes.png");

await evaluate(`document.querySelector('#inspector-tab-interface').click(); document.querySelector('.preview-mode-tabs button:nth-child(2)').click()`);
await waitFor(`document.querySelector('[data-testid="preview-codex-grid"]')`);
const interfaceContract = await evaluate(`(() => {
  const main = document.querySelector('[data-testid="preview-main-content"]').getBoundingClientRect();
  const composer = document.querySelector('[data-testid="preview-composer"]').getBoundingClientRect();
  return {
    ranges: document.querySelectorAll('.inspector-page input[type="range"]').length,
    value: document.querySelector('.inspector-page input[type="range"]')?.value,
    main: { top: main.top, bottom: main.bottom },
    composer: { top: composer.top, bottom: composer.bottom },
    nonOverlapping: main.bottom <= composer.top
  };
})()`);
if (interfaceContract.ranges !== 1 || !interfaceContract.value || !interfaceContract.nonOverlapping) {
  throw new Error(`Unified interface contract failed: ${JSON.stringify(interfaceContract)}`);
}
await capture("studio-interface-opacity.png");

await evaluate(`document.querySelector('#inspector-tab-composition').click()`);
const cropContract = await evaluate(`(() => {
  const canvas = document.querySelector('.preview-canvas');
  const stage = document.querySelector('.preview-stage');
  const art = document.querySelector('[data-testid="preview-artwork"]');
  const ranges = [...document.querySelectorAll('.inspector-page input[type="range"]')];
  const before = art.style.transform;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(ranges[2], '1.2'); ranges[2].dispatchEvent(new Event('input', { bubbles: true })); ranges[2].dispatchEvent(new Event('change', { bubbles: true }));
  setter.call(ranges[0], '24'); ranges[0].dispatchEvent(new Event('input', { bubbles: true })); ranges[0].dispatchEvent(new Event('change', { bubbles: true }));
  setter.call(ranges[1], '-18'); ranges[1].dispatchEvent(new Event('input', { bubbles: true })); ranges[1].dispatchEvent(new Event('change', { bubbles: true }));
  const stageStyle = getComputedStyle(stage);
  const canvasRect = canvas.getBoundingClientRect();
  const stageRect = stage.getBoundingClientRect();
  return {
    before, after: art.style.transform,
    aspect: canvasRect.width / canvasRect.height,
    calibrated: 1296 / 830,
    stageBackground: stageStyle.backgroundColor,
    fillsStage: Math.abs(canvasRect.width - stage.clientWidth) < 1 && Math.abs(canvasRect.height - stage.clientHeight) < 1,
    artworkWidth: parseFloat(art.style.width), canvasWidth: canvasRect.width,
    artworkHeight: parseFloat(art.style.height), canvasHeight: canvasRect.height
  };
})()`);
await sleep(300);
const cropAfter = await evaluate(`document.querySelector('[data-testid="preview-artwork"]').style.transform`);
if (cropContract.before === cropAfter || Math.abs(cropContract.aspect - cropContract.calibrated) > 0.01 || !cropContract.fillsStage
  || cropContract.stageBackground === "rgb(0, 0, 0)" || cropContract.artworkWidth < cropContract.canvasWidth || cropContract.artworkHeight < cropContract.canvasHeight) {
  throw new Error(`Bounded crop/letterbox contract failed: ${JSON.stringify({ ...cropContract, cropAfter })}`);
}
await capture("studio-crop-preview.png");

await evaluate(`document.querySelector('.theme-inspector__footer button:first-child:not(:disabled)')?.click()`);
await sleep(300);

const result = {
  checkedAt: new Date().toISOString(),
  mode: "non-destructive",
  presets,
  inlineSettings,
  deleteContract,
  tabContract,
  toneContract,
  interfaceContract,
  cropContract: { ...cropContract, after: cropAfter },
  screenshots: [
    "studio-settings-inline.png",
    "studio-inspector-tabs.png",
    "studio-tone-modes.png",
    "studio-interface-opacity.png",
    "studio-crop-preview.png",
  ],
  deferred: ["apply to Codex", "Codex restart", "Restore", "pause", "resume"],
};
await writeFile(path.join(outputDir, "studio-advanced-controls-acceptance.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
socket.close();
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
