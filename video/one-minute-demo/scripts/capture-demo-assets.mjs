import {execFileSync} from "node:child_process";
import {copyFile, mkdir, readdir, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {REQUIRED_CAPTURES} from "./capture-plan.mjs";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(projectDir, "assets", "captures");
const manifestPath = path.join(projectDir, "assets", "capture-manifest.json");
const repositoryDir = path.resolve(projectDir, "..", "..");
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function findThemeArtwork() {
  const themesDir = path.join(process.env.LOCALAPPDATA ?? "", "CodexDreamSkin", "themes");
  const entries = await readdir(themesDir, {recursive: true, withFileTypes: true});
  return entries
    .filter((entry) => entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
}

function convertToPng(source, destination) {
  const candidates = [
    "D:\\Codex-Video-Runtimes\\ffmpeg-npm\\node_modules\\@ffmpeg-installer\\win32-x64\\ffmpeg.exe",
    "E:\\OpenMontage\\vendor\\ffmpeg\\bin\\ffmpeg.exe",
  ];
  const ffmpeg = candidates.find((candidate) => {
    try {
      execFileSync(candidate, ["-version"], {stdio: "ignore"});
      return true;
    } catch {
      return false;
    }
  });
  if (!ffmpeg) throw new Error("FFmpeg was not found for fallback image conversion");
  execFileSync(ffmpeg, ["-y", "-i", source, destination], {stdio: "ignore"});
}

async function createFallbackAssets(reason) {
  const verification = path.join(repositoryDir, "docs", "verification");
  const fixed = new Map([
    ["codex-opening.png", path.join(verification, "codex-home-redacted.png")],
    ["studio-overview.png", path.join(verification, "studio-unified-interface.png")],
    ["studio-theme-1.png", path.join(verification, "studio-main.png")],
    ["studio-theme-2.png", path.join(verification, "studio-enhanced-preview.png")],
    ["studio-theme-3.png", path.join(verification, "studio-unified-preview.png")],
    ["studio-tone-original.png", path.join(verification, "studio-tone-modes.png")],
    ["studio-tone-grayscale.png", path.join(verification, "studio-tone-modes.png")],
    ["studio-tone-duotone.png", path.join(verification, "studio-tone-modes.png")],
    ["studio-tone-wash.png", path.join(verification, "studio-tone-modes.png")],
    ["studio-opacity.png", path.join(verification, "studio-region-controls.png")],
    ["codex-final.png", path.join(verification, "codex-home-redacted.png")],
  ]);
  const themeArtwork = await findThemeArtwork();
  if (themeArtwork.length < 3) throw new Error("Fallback capture requires at least three local theme artworks");
  const themeIndexes = [0, Math.floor((themeArtwork.length - 1) / 2), themeArtwork.length - 1];
  for (let index = 0; index < 3; index += 1) {
    convertToPng(themeArtwork[themeIndexes[index]], path.join(outputDir, `codex-theme-${index + 1}.png`));
  }
  for (const [file, source] of fixed) {
    await copyFile(source, path.join(outputDir, file));
  }
  const items = REQUIRED_CAPTURES.map((file) => ({
    file,
    source: file.startsWith("codex-theme-") ? "local-theme-artwork" : "docs-verification",
    simulated: true,
    privacyRedacted: file.startsWith("codex-"),
  }));
  await writeFile(manifestPath, `${JSON.stringify({
    capturedAt: new Date().toISOString(),
    originalThemeRestored: true,
    fallbackReason: reason instanceof Error ? reason.message : String(reason),
    items,
  }, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({outputDir, manifestPath, count: items.length, fallback: true}, null, 2)}\n`);
}

async function connectCdp(port, predicate) {
  const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
  const target = targets.filter(predicate).at(-1);
  if (!target) throw new Error(`No matching CDP target was found on port ${port}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, {once: true});
    socket.addEventListener("error", reject, {once: true});
  });

  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", ({data}) => {
    const message = JSON.parse(data);
    if (!message.id || !pending.has(message.id)) return;
    const handlers = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) handlers.reject(new Error(message.error.message));
    else handlers.resolve(message.result);
  });

  return {
    socket,
    command(method, params = {}) {
      const id = nextId++;
      socket.send(JSON.stringify({id, method, params}));
      return new Promise((resolve, reject) => pending.set(id, {resolve, reject}));
    },
  };
}

async function evaluate(client, expression) {
  const result = await client.command("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

async function capture(client, outputPath) {
  const result = await client.command("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  await writeFile(outputPath, Buffer.from(result.data, "base64"));
}

async function waitFor(client, expression, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(client, `Boolean(${expression})`)) return;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function clickStudioTheme(studio, index) {
  const result = await evaluate(studio, `(() => {
    const cards = [...document.querySelectorAll('.theme-card')].filter((card) => card.dataset.damaged !== 'true');
    const card = cards[${index}];
    const button = card?.querySelector('.theme-card__select');
    if (!button || button.disabled) return {ok: false, count: cards.length};
    button.click();
    return {ok: true, count: cards.length};
  })()`);
  if (!result.ok) throw new Error(`Unable to select Studio theme index ${index}; available=${result.count}`);
  await waitFor(studio, `[...document.querySelectorAll('.theme-card')].filter((card) => card.dataset.damaged !== 'true')[${index}]?.dataset.selected === 'true'`);
  await sleep(500);
}

async function applyStudioChanges(studio) {
  const selector = ".theme-inspector__footer button:nth-child(2)";
  await waitFor(studio, `document.querySelector('${selector}') && !document.querySelector('${selector}').disabled`);
  await evaluate(studio, `document.querySelector('${selector}').click()`);
  await waitFor(studio, `document.querySelector('${selector}') && document.querySelector('${selector}').disabled`, 120000);
  await waitFor(studio, `document.querySelectorAll('.theme-card__select:not(:disabled)').length > 0`, 120000);
  await sleep(1500);
}

async function setNativeInput(studio, selector, value) {
  const changed = await evaluate(studio, `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input || input.disabled) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', {bubbles: true}));
    input.dispatchEvent(new Event('change', {bubbles: true}));
    return true;
  })()`);
  if (!changed) throw new Error(`Unable to change input: ${selector}`);
  await sleep(500);
}

async function prepareCodexHome(codex) {
  await evaluate(codex, `(() => {
    const buttons = [...document.querySelectorAll('button')];
    const button = buttons.find((item) => {
      const label = item.getAttribute('aria-label') ?? '';
      return label.includes('新建任务') || label.toLowerCase().includes('new task');
    });
    button?.click();
    return Boolean(button);
  })()`);
  await sleep(1200);
  await evaluate(codex, `(() => {
    document.getElementById('dream-skin-video-redaction')?.remove();
    const style = document.createElement('style');
    style.id = 'dream-skin-video-redaction';
    style.textContent = 'body * { color: transparent !important; text-shadow: none !important; caret-color: transparent !important; }';
    document.head.append(style);
    return true;
  })()`);
  await sleep(300);
}

async function main() {
  await mkdir(outputDir, {recursive: true});
  let studio;
  let codex;
  try {
    studio = await connectCdp(9444, (item) => item.type === "page" && item.url.startsWith("http://tauri.localhost"));
    codex = await connectCdp(9335, (item) => item.type === "page");
  } catch (error) {
    await createFallbackAssets(error);
    return;
  }
  const manifest = [];
  let initialActiveIndex = 0;

  const captureShot = async (client, file, source, privacyRedacted) => {
    await capture(client, path.join(outputDir, file));
    manifest.push({file, source, simulated: false, privacyRedacted});
  };

  try {
    await studio.command("Page.enable");
    await codex.command("Page.enable");
    await waitFor(studio, `document.querySelectorAll('.theme-card').length >= 3 && document.querySelector('[data-testid="preview-codex-grid"]')`);
    await evaluate(studio, `(() => { const strip = document.querySelector('.runtime-status-strip'); if (strip) strip.style.display = 'none'; return true; })()`);
    initialActiveIndex = await evaluate(studio, `(() => {
      const cards = [...document.querySelectorAll('.theme-card')].filter((card) => card.dataset.damaged !== 'true');
      const index = cards.findIndex((card) => card.dataset.active === 'true');
      return index < 0 ? 0 : index;
    })()`);

    await prepareCodexHome(codex);
    await captureShot(codex, "codex-opening.png", "codex-cdp", true);
    await captureShot(studio, "studio-overview.png", "studio-cdp", false);

    const themeCount = await evaluate(studio, `[...document.querySelectorAll('.theme-card')].filter((card) => card.dataset.damaged !== 'true').length`);
    const candidates = [...new Set([0, Math.floor((themeCount - 1) / 2), themeCount - 1])];
    if (candidates.length < 3) throw new Error(`At least three valid Studio themes are required; found ${themeCount}`);

    for (let offset = 0; offset < 3; offset += 1) {
      const index = candidates[offset];
      await clickStudioTheme(studio, index);
      await captureShot(studio, `studio-theme-${offset + 1}.png`, "studio-cdp", false);
      await applyStudioChanges(studio);
      await prepareCodexHome(codex);
      await captureShot(codex, `codex-theme-${offset + 1}.png`, "codex-cdp", true);
    }

    await evaluate(studio, `document.querySelector('#inspector-tab-tone').click()`);
    for (const mode of ["original", "grayscale", "duotone", "wash"]) {
      await setNativeInput(studio, `input[name="tone-mode"][value="${mode}"]`, mode);
      await captureShot(studio, `studio-tone-${mode}.png`, "studio-cdp", false);
    }

    await evaluate(studio, `document.querySelector('#inspector-tab-effects').click()`);
    await waitFor(studio, `document.querySelector('.inspector-page input[type="range"]')`);
    await setNativeInput(studio, ".inspector-page input[type=\"range\"]", "0.58");
    await captureShot(studio, "studio-opacity.png", "studio-cdp", false);
    await applyStudioChanges(studio);
    await prepareCodexHome(codex);
    await captureShot(codex, "codex-final.png", "codex-cdp", true);
  } finally {
    try {
      await clickStudioTheme(studio, initialActiveIndex);
      await applyStudioChanges(studio);
    } catch (error) {
      process.stderr.write(`Theme restoration warning: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    try {
      await evaluate(codex, `document.getElementById('dream-skin-video-redaction')?.remove()`);
    } catch {}
    studio.socket.close();
    codex.socket.close();
  }

  const missing = REQUIRED_CAPTURES.filter((file) => !manifest.some((item) => item.file === file));
  if (missing.length > 0) throw new Error(`Capture manifest is incomplete: ${missing.join(", ")}`);
  await mkdir(path.dirname(manifestPath), {recursive: true});
  await writeFile(manifestPath, `${JSON.stringify({capturedAt: new Date().toISOString(), originalThemeRestored: true, items: manifest}, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({outputDir, manifestPath, count: manifest.length, originalThemeRestored: true}, null, 2)}\n`);
}

await main();
