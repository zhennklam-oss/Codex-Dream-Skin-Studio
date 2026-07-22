import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const port = Number(process.argv[2] ?? 9335);
const engineRoot = path.resolve("src-tauri/resources/dream-skin-engine");
const rendererPath = path.join(engineRoot, "assets/renderer-inject.js");
const cssPath = path.join(engineRoot, "assets/dream-skin.css");
const themePath = path.join(engineRoot, "assets/theme.json");
const ONE_PIXEL_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const STATE_KEY = "__CODEX_DREAM_SKIN_STATE__";
const PANEL_SELECTORS = {
  bottom: '[data-app-shell-focus-area="bottom-panel"]',
  right: '[data-app-shell-focus-area="right-panel"]',
};
const execFileAsync = promisify(execFile);
let windowsState = null;

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => {
  if (!response.ok) throw new Error(`CDP target discovery failed with HTTP ${response.status}`);
  return response.json();
});
const target = targets.find((item) => item.type === "page" && item.url === "app://-/index.html");
if (!target) throw new Error("Codex app://-/index.html page target was not found");

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
  if (message.error) handlers.reject(new Error(message.error.message));
  else handlers.resolve(message.result);
});

function command(method, params = {}) {
  const id = nextId++;
  const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  socket.send(JSON.stringify({ id, method, params }));
  return response;
}

async function evaluate(expression) {
  const result = await command("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

async function poll(check, description, timeoutMs = 3500) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await check();
    if (lastValue) return lastValue;
    await sleep(100);
  }
  throw new Error(`${description} timed out; last value: ${JSON.stringify(lastValue)}`);
}

async function panelOpen(kind) {
  const selector = PANEL_SELECTORS[kind];
  return evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return false;
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" &&
      style.visibility !== "hidden" && Number(style.opacity || 1) > 0;
  })()`);
}

async function waitForPanelState(kind, expected) {
  return poll(async () => (await panelOpen(kind)) === expected, `${kind} panel to become ${expected ? "open" : "closed"}`);
}

async function officialControlDiagnostics() {
  return evaluate(`(() => ({
    activeElement: {
      tag: document.activeElement?.tagName ?? null,
      className: document.activeElement?.className ?? null,
      ariaLabel: document.activeElement?.getAttribute?.("aria-label") ?? null,
    },
    controls: [...document.querySelectorAll("button, [role=menuitem], [role=menuitemcheckbox]")]
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          tag: node.tagName,
          text: (node.textContent ?? "").trim().replace(/\\s+/g, " ").slice(0, 160),
          ariaLabel: node.getAttribute("aria-label"),
          title: node.getAttribute("title"),
          role: node.getAttribute("role"),
          testId: node.getAttribute("data-testid"),
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          ancestors: [...function* () {
            for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
              yield {
                tag: parent.tagName,
                role: parent.getAttribute("role"),
                dataState: parent.getAttribute("data-state"),
                className: String(parent.className).slice(0, 120),
              };
            }
          }()].slice(0, 5),
          visible: rect.width > 0 && rect.height > 0,
        };
      })
      .filter((item) => item.visible && /\u89c6\u56fe|bottom panel|review panel|\u5e95\u90e8\u9762\u677f|\u5ba1\u9605\u9762\u677f|\u5ba1\u67e5\u9762\u677f/i.test(
        [item.text, item.ariaLabel, item.title, item.testId].filter(Boolean).join(" ")
      )),
    panelHosts: [...document.querySelectorAll('[data-app-shell-focus-area], [data-app-shell-tab-panel-controller], [data-codex-terminal], [data-codex-xterm]')]
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          tag: node.tagName,
          focusArea: node.getAttribute('data-app-shell-focus-area'),
          controller: node.getAttribute('data-app-shell-tab-panel-controller'),
          terminal: node.hasAttribute('data-codex-terminal'),
          xterm: node.hasAttribute('data-codex-xterm'),
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          ariaHidden: node.getAttribute('aria-hidden'),
          dataState: node.getAttribute('data-state'),
        };
      }),
  }))()`);
}

const WINDOWS_INPUT_SCRIPT = String.raw`
$Action = $env:DREAM_ACTION
$TargetHandle = [long]$env:DREAM_TARGET_HANDLE
$RestoreHandle = [long]$env:DREAM_RESTORE_HANDLE
$Keys = $env:DREAM_KEYS
$source = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class DreamSkinWindowInput {
  public delegate bool EnumWindowsProc(IntPtr handle, IntPtr parameter);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr handle);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr handle);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr handle, out Rect rect);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr handle);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr handle, int command);
  [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr handle);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint source, uint target, bool attach);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr handle, StringBuilder text, int length);
  public struct Rect { public int Left, Top, Right, Bottom; }
}
'@
Add-Type $source
function Set-DreamForeground([IntPtr]$handle) {
  if (-not [DreamSkinWindowInput]::IsWindow($handle)) { return $false }
  [void][DreamSkinWindowInput]::SetForegroundWindow($handle)
  Start-Sleep -Milliseconds 80
  if ([DreamSkinWindowInput]::GetForegroundWindow() -eq $handle) { return $true }
  $foreground = [DreamSkinWindowInput]::GetForegroundWindow()
  $foregroundProcessId = 0
  $targetProcessId = 0
  $foregroundThread = [DreamSkinWindowInput]::GetWindowThreadProcessId($foreground, [ref]$foregroundProcessId)
  $targetThread = [DreamSkinWindowInput]::GetWindowThreadProcessId($handle, [ref]$targetProcessId)
  $currentThread = [DreamSkinWindowInput]::GetCurrentThreadId()
  $attachedForeground = $foregroundThread -ne 0 -and $foregroundThread -ne $currentThread -and
    [DreamSkinWindowInput]::AttachThreadInput($currentThread, $foregroundThread, $true)
  $attachedTarget = $targetThread -ne 0 -and $targetThread -ne $currentThread -and
    [DreamSkinWindowInput]::AttachThreadInput($currentThread, $targetThread, $true)
  try {
    [void][DreamSkinWindowInput]::ShowWindowAsync($handle, 9)
    [void][DreamSkinWindowInput]::BringWindowToTop($handle)
    [void][DreamSkinWindowInput]::SetForegroundWindow($handle)
    [void][DreamSkinWindowInput]::SetFocus($handle)
  } finally {
    if ($attachedTarget) { [void][DreamSkinWindowInput]::AttachThreadInput($currentThread, $targetThread, $false) }
    if ($attachedForeground) { [void][DreamSkinWindowInput]::AttachThreadInput($currentThread, $foregroundThread, $false) }
  }
  Start-Sleep -Milliseconds 120
  if ([DreamSkinWindowInput]::GetForegroundWindow() -eq $handle) { return $true }
  $processId = 0
  [void][DreamSkinWindowInput]::GetWindowThreadProcessId($handle, [ref]$processId)
  $shell = New-Object -ComObject WScript.Shell
  [void]$shell.AppActivate([int]$processId)
  Start-Sleep -Milliseconds 120
  return [DreamSkinWindowInput]::GetForegroundWindow() -eq $handle
}
if ($Action -eq 'inspect') {
  $candidatePids = @(Get-Process -Name ChatGPT -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -like '*OpenAI.Codex_*\app\ChatGPT.exe'
  } | ForEach-Object { $_.Id })
  $best = @{ Handle = 0L; Area = 0L; ProcessId = 0 }
  [void][DreamSkinWindowInput]::EnumWindows({
    param($handle, $parameter)
    $processId = 0
    [void][DreamSkinWindowInput]::GetWindowThreadProcessId($handle, [ref]$processId)
    if ($candidatePids -contains [int]$processId -and [DreamSkinWindowInput]::IsWindowVisible($handle)) {
      $className = New-Object Text.StringBuilder 128
      [void][DreamSkinWindowInput]::GetClassName($handle, $className, 128)
      $rect = New-Object DreamSkinWindowInput+Rect
      [void][DreamSkinWindowInput]::GetWindowRect($handle, [ref]$rect)
      $area = [long]($rect.Right - $rect.Left) * [long]($rect.Bottom - $rect.Top)
      if ($className.ToString() -eq 'Chrome_WidgetWin_1' -and $area -gt $best.Area) {
        $best.Handle = $handle.ToInt64()
        $best.Area = $area
        $best.ProcessId = $processId
      }
    }
    return $true
  }, [IntPtr]::Zero)
  if ($best.Handle -eq 0) { throw 'Codex main window was not found' }
  [pscustomobject]@{
    targetHandle = $best.Handle
    targetProcessId = $best.ProcessId
    targetArea = $best.Area
    foregroundHandle = [DreamSkinWindowInput]::GetForegroundWindow().ToInt64()
  } | ConvertTo-Json -Compress
  exit 0
}
if ($Action -eq 'send') {
  $target = [IntPtr]$TargetHandle
  if (-not [DreamSkinWindowInput]::IsWindow($target)) { throw 'Codex target window is no longer valid' }
  if (-not (Set-DreamForeground $target)) { throw 'Unable to focus Codex target window' }
  Start-Sleep -Milliseconds 120
  $shell = New-Object -ComObject WScript.Shell
  $shell.SendKeys($Keys)
  Start-Sleep -Milliseconds 120
  [pscustomobject]@{ targetHandle = $TargetHandle; keys = $Keys; sent = $true } | ConvertTo-Json -Compress
  exit 0
}
if ($Action -eq 'restore') {
  $restore = [IntPtr]$RestoreHandle
  $restored = $RestoreHandle -eq 0 -or (
    [DreamSkinWindowInput]::IsWindow($restore) -and (Set-DreamForeground $restore)
  )
  [pscustomobject]@{ restoreHandle = $RestoreHandle; restored = $restored } | ConvertTo-Json -Compress
  exit 0
}
throw "Unknown action: $Action"
`;

async function windowsInput(action, { targetHandle = 0, restoreHandle = 0, keys = "" } = {}) {
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command", WINDOWS_INPUT_SCRIPT,
  ], {
    timeout: 10000,
    windowsHide: true,
    env: {
      ...process.env,
      DREAM_ACTION: action,
      DREAM_TARGET_HANDLE: String(targetHandle),
      DREAM_RESTORE_HANDLE: String(restoreHandle),
      DREAM_KEYS: keys,
    },
  });
  return JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
}

async function clickOfficialPanelControl(kind) {
  await evaluate(`(() => {
    document.activeElement?.blur?.();
    const body = document.body;
    const previousTabIndex = body.getAttribute("tabindex");
    body.setAttribute("tabindex", "-1");
    body.focus({ preventScroll: true });
    if (previousTabIndex === null) body.removeAttribute("tabindex");
    else body.setAttribute("tabindex", previousTabIndex);
    return document.activeElement === body;
  })()`);
  const keys = kind === "bottom" ? "^j" : "^%b";
  const sent = await windowsInput("send", { targetHandle: windowsState.targetHandle, keys });
  return { clicked: sent.sent === true, keys, targetHandle: sent.targetHandle };
}

async function setPanelWithOfficialControl(kind, expectedOpen) {
  const before = await panelOpen(kind);
  if (before === expectedOpen) return { before, after: before, triggerMode: "unchanged" };
  const control = await clickOfficialPanelControl(kind);
  if (!control.clicked) {
    const diagnostics = await officialControlDiagnostics();
    throw new Error(`${kind} official control was not found: ${JSON.stringify(diagnostics)}`);
  }
  try {
    await waitForPanelState(kind, expectedOpen);
  } catch (error) {
    const diagnostics = await officialControlDiagnostics();
    throw new Error(`${error.message}; official control: ${JSON.stringify(control)}; diagnostics: ${JSON.stringify(diagnostics)}`);
  }
  return { before, after: expectedOpen, triggerMode: "windows-trusted-accelerator", control };
}

async function ensurePanelOpenAndExerciseToggle(kind) {
  const initiallyOpen = await panelOpen(kind);
  const toggles = [];
  if (initiallyOpen) toggles.push(await setPanelWithOfficialControl(kind, false));
  toggles.push(await setPanelWithOfficialControl(kind, true));
  assert.equal(await panelOpen(kind), true, `${kind} panel must be open for semantic mapping assertions`);
  return { initiallyOpen, toggles };
}

async function restorePanelState(kind, expected) {
  if ((await panelOpen(kind)) === expected) return { restored: true, trigger: "unchanged" };
  const toggle = await setPanelWithOfficialControl(kind, expected);
  assert.equal(await panelOpen(kind), expected, `${kind} panel state was not restored`);
  return { restored: true, triggerMode: toggle.triggerMode };
}

async function measureComposer() {
  return evaluate(`(() => {
    const node = document.querySelector(".composer-surface-chrome");
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const round = (value) => Math.round(value * 1000) / 1000;
    return {
      rect: {
        x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height),
        top: round(rect.top), right: round(rect.right), bottom: round(rect.bottom), left: round(rect.left),
      },
      borderRadius: style.borderRadius,
      border: style.border,
      boxShadow: style.boxShadow,
      backdropFilter: style.backdropFilter,
      maxWidth: style.maxWidth,
      backgroundColor: style.backgroundColor,
    };
  })()`);
}

async function stableComposer() {
  let previous = null;
  let stableCount = 0;
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const current = await measureComposer();
    if (!current) throw new Error("Codex composer .composer-surface-chrome was not found");
    if (JSON.stringify(current) === JSON.stringify(previous)) stableCount += 1;
    else stableCount = 0;
    if (stableCount >= 2) return current;
    previous = current;
    await sleep(150);
  }
  throw new Error(`Composer geometry did not stabilize: ${JSON.stringify(previous)}`);
}

async function restoreScrollPosition() {
  await evaluate(`(() => {
    const restore = window.__DREAM_CDP_SCROLL_RESTORE__;
    if (!restore) return false;
    for (const entry of restore.elements) {
      entry.node.scrollLeft = entry.left;
      entry.node.scrollTop = entry.top;
    }
    scrollTo(restore.windowX, restore.windowY);
    delete window.__DREAM_CDP_SCROLL_RESTORE__;
    return true;
  })()`);
  await sleep(200);
}

function withoutBackground(measurement) {
  const { backgroundColor: _backgroundColor, ...rest } = measurement;
  return rest;
}

await command("Page.enable");
await command("Runtime.enable");
await evaluate(`new Promise((resolve) => document.readyState === "complete" ? resolve() : addEventListener("load", resolve, { once: true }))`);
windowsState = await windowsInput("inspect");
await windowsInput("send", { targetHandle: windowsState.targetHandle, keys: "{ESC}" });

const [rendererTemplate, cssText, rawTheme] = await Promise.all([
  readFile(rendererPath, "utf8"),
  readFile(cssPath, "utf8"),
  readFile(themePath, "utf8"),
]);
const theme = JSON.parse(rawTheme);
theme.schemaVersion = 5;
theme.effects = {
  ...theme.effects,
  interfaceOpacity: 0.78,
  leftSidebarOpacity: 0.78,
  topBarOpacity: 0.78,
  rightSidebarOpacity: 0.78,
  bottomBarOpacity: 0.78,
  inputOpacity: 0.9,
};
const rendererSource = rendererTemplate
  .replace("__DREAM_CSS_JSON__", JSON.stringify(cssText))
  .replace("__DREAM_ART_JSON__", JSON.stringify(ONE_PIXEL_PNG))
  .replace("__DREAM_THEME_JSON__", JSON.stringify(theme));

const initial = {
  bottomOpen: await panelOpen("bottom"),
  rightOpen: await panelOpen("right"),
  preexistingSkin: await evaluate(`(() => ({
    hasState: Boolean(window[${JSON.stringify(STATE_KEY)}]),
    version: window[${JSON.stringify(STATE_KEY)}]?.version ?? null,
    hasRootClass: document.documentElement.classList.contains("codex-dream-skin"),
    hasStyle: Boolean(document.getElementById("codex-dream-skin-style")),
  }))()`),
};
const result = {
  pass: false,
  engineVersion: null,
  bottomMapped: false,
  reviewMapped: false,
  composerPreserved: false,
  stateRestored: false,
  initial,
  windows: windowsState,
  toggles: {},
};
let injected = false;
let thrown = null;

try {
  assert.deepEqual(initial.preexistingSkin, {
    hasState: false,
    version: null,
    hasRootClass: false,
    hasStyle: false,
  }, "A pre-existing Dream Skin injection is active; refusing to replace user state during acceptance");
  const baseline = await stableComposer();
  const install = await evaluate(rendererSource);
  injected = Boolean(install?.installed);
  assert.equal(injected, true, "Source renderer did not report a successful temporary install");
  result.engineVersion = install.version;
  assert.equal(result.engineVersion, "1.7.0");

  result.toggles.bottom = await ensurePanelOpenAndExerciseToggle("bottom");
  await evaluate(`window[${JSON.stringify(STATE_KEY)}]?.ensure()`);
  const bottomMapping = await evaluate(`(() => {
    const state = window[${JSON.stringify(STATE_KEY)}];
    const bottom = document.querySelector(${JSON.stringify(PANEL_SELECTORS.bottom)});
    const composer = document.querySelector(".composer-surface-chrome");
    return {
      available: state?.surfaces?.bottom?.available === true,
      bottomClass: bottom?.classList.contains("dream-surface-bottom") === true,
      composerInputClass: composer?.classList.contains("dream-surface-input") === true,
      composerBottomClass: composer?.classList.contains("dream-surface-bottom") === true,
    };
  })()`);
  assert.deepEqual(bottomMapping, {
    available: true,
    bottomClass: true,
    composerInputClass: true,
    composerBottomClass: false,
  });
  result.bottomMapped = true;

  result.toggles.right = await ensurePanelOpenAndExerciseToggle("right");
  await evaluate(`window[${JSON.stringify(STATE_KEY)}]?.ensure()`);
  const rightMapping = await evaluate(`(() => {
    const state = window[${JSON.stringify(STATE_KEY)}];
    const right = document.querySelector(${JSON.stringify(PANEL_SELECTORS.right)});
    const rect = right?.getBoundingClientRect();
    return {
      available: state?.surfaces?.right?.available === true,
      rightClass: right?.classList.contains("dream-surface-right") === true,
      diagnostics: {
        rightExists: Boolean(right),
        rightRect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
        controllers: [...(right?.querySelectorAll("[data-app-shell-tab-panel-controller]") ?? [])]
          .map((node) => node.getAttribute("data-app-shell-tab-panel-controller")),
        tabIds: [...(right?.querySelectorAll("[data-tab-id]") ?? [])]
          .map((node) => node.getAttribute("data-tab-id")),
        attributes: right ? [...right.attributes].map((attribute) => [attribute.name, attribute.value]) : [],
      },
    };
  })()`);
  assert.deepEqual(
    { available: rightMapping.available, rightClass: rightMapping.rightClass },
    { available: true, rightClass: true },
    JSON.stringify(rightMapping.diagnostics),
  );
  result.reviewMapped = true;

  await restorePanelState("right", initial.rightOpen);
  await restorePanelState("bottom", initial.bottomOpen);
  await restoreScrollPosition();
  await evaluate(`window[${JSON.stringify(STATE_KEY)}]?.ensure()`);
  const defaultComposer = await stableComposer();
  const comparableComposer = (measurement) => ({
    rect: {
      x: measurement.rect.x,
      width: measurement.rect.width,
      height: measurement.rect.height,
    },
    border: /^0px\s/.test(measurement.border) ? "none" : measurement.border,
    borderRadius: measurement.borderRadius,
    boxShadow: measurement.boxShadow,
    backdropFilter: measurement.backdropFilter,
    maxWidth: measurement.maxWidth,
    backgroundColor: measurement.backgroundColor,
  });
  result.composerMeasurements = { baseline, default: defaultComposer };
  assert.deepEqual(comparableComposer(defaultComposer), comparableComposer(baseline),
    "Default inputOpacity changed native composer geometry or visible chrome");

  await evaluate(`(() => {
    const state = window[${JSON.stringify(STATE_KEY)}];
    state.config.effects.bottomBarOpacity = 0.123;
    state.ensure();
  })()`);
  const bottomChangedComposer = await stableComposer();
  assert.deepEqual(
    comparableComposer(bottomChangedComposer),
    comparableComposer(baseline),
    "Bottom Panel opacity changed composer styling",
  );
  await evaluate(`(() => {
    const state = window[${JSON.stringify(STATE_KEY)}];
    state.config.effects.bottomBarOpacity = 0.78;
    state.ensure();
  })()`);

  await evaluate(`(() => {
    const state = window[${JSON.stringify(STATE_KEY)}];
    state.config.effects.inputOpacity = 0.5;
    state.ensure();
  })()`);
  result.inputDiagnostics = await evaluate(`(() => {
    const root = document.documentElement;
    const composer = document.querySelector(".composer-surface-chrome");
    const style = composer ? getComputedStyle(composer) : null;
    return {
      rootClasses: [...root.classList],
      composerClasses: composer ? [...composer.classList] : [],
      inputOpacity: getComputedStyle(root).getPropertyValue("--dream-input-opacity").trim(),
      inputBackgroundToken: style?.getPropertyValue("--color-token-input-background").trim() ?? null,
      background: style?.background ?? null,
      backgroundColor: style?.backgroundColor ?? null,
    };
  })()`);
  const inputChangedComposer = await stableComposer();
  assert.notEqual(inputChangedComposer.backgroundColor, baseline.backgroundColor,
    "Custom input opacity did not change composer backgroundColor");
  assert.deepEqual(
    withoutBackground(comparableComposer(inputChangedComposer)),
    withoutBackground(comparableComposer(baseline)),
    "Custom input opacity changed composer geometry or non-background chrome");
  result.composerPreserved = true;
} catch (error) {
  thrown = error;
} finally {
  try {
    if (injected) {
      await evaluate(`(() => {
        const root = document.documentElement;
        root.classList.remove("dream-input-custom");
        root.style.setProperty("--dream-input-opacity", "0.9");
        root.style.setProperty("--dream-bottom-bar-opacity", "0.78");
        return window[${JSON.stringify(STATE_KEY)}]?.cleanup?.() ?? false;
      })()`);
      injected = false;
    }
  } catch (cleanupError) {
    thrown ??= cleanupError;
  }
  try {
    await restorePanelState("right", initial.rightOpen);
    await restorePanelState("bottom", initial.bottomOpen);
    await restoreScrollPosition();
    result.stateRestored = (await panelOpen("right")) === initial.rightOpen &&
      (await panelOpen("bottom")) === initial.bottomOpen;
  } catch (restoreError) {
    thrown ??= restoreError;
  }
  try {
    const foreground = await windowsInput("restore", { restoreHandle: windowsState.foregroundHandle });
    result.foregroundRestored = foreground.restored === true;
  } catch (foregroundError) {
    result.foregroundRestored = false;
    thrown ??= foregroundError;
  }
  result.pass = !thrown && !injected && result.bottomMapped && result.reviewMapped &&
    result.composerPreserved && result.stateRestored && result.foregroundRestored;
  if (thrown) result.error = thrown.stack ?? String(thrown);
  socket.close();
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.pass) process.exitCode = 1;
