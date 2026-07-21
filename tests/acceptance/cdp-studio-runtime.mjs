import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

if (!process.argv.includes("--allow-lifecycle")) {
  throw new Error("Refusing lifecycle acceptance without --allow-lifecycle; this script pauses/resumes the real Codex skin.");
}

const port = Number(process.argv[2] ?? 9444);
const output = path.resolve(process.argv[3] ?? "docs/verification/studio-runtime.json");
const target = (await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json()))
  .find((item) => item.type === "page" && item.url.startsWith("http://tauri.localhost"));
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}
async function waitFor(predicate, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(200);
  }
  return false;
}
async function clickButton(fragment) {
  const ready = await waitFor(() => evaluate(`(() => [...document.querySelectorAll('button')].some(element => element.textContent.includes(${JSON.stringify(fragment)}) && !element.disabled))()`), 15000);
  if (!ready) throw new Error(`Enabled button containing ${fragment} did not become available`);
  const clicked = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(element => element.textContent.includes(${JSON.stringify(fragment)}) && !element.disabled);
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Enabled button containing ${fragment} was not found`);
}
async function checkboxState() {
  return evaluate(`[...document.querySelectorAll('input[type="checkbox"]')].map(input => input.checked)`);
}
async function clickCheckbox(index) {
  const ready = await waitFor(() => evaluate(`(() => {
    const input = document.querySelectorAll('input[type="checkbox"]')[${index}];
    return Boolean(input && !input.disabled);
  })()`));
  if (!ready) throw new Error(`Checkbox ${index} did not become enabled`);
  const clicked = await evaluate(`(() => {
    const input = document.querySelectorAll('input[type="checkbox"]')[${index}];
    if (!input || input.disabled) return false;
    input.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Checkbox ${index} was not available`);
}

const localData = process.env.LOCALAPPDATA;
if (!localData) throw new Error("LOCALAPPDATA is unavailable");
const pauseFile = path.join(localData, "CodexDreamSkin", "paused");
const settingsFile = path.join(localData, "CodexDreamSkinStudio", "settings.json");

if (!(await exists(pauseFile))) {
  await clickButton("暂停皮肤");
  if (!(await waitFor(() => exists(pauseFile)))) throw new Error("Pause marker was not created");
}
const paused = { marker: true, controls: await checkboxState() };
await sleep(500);
await clickButton("恢复皮肤");
if (!(await waitFor(async () => !(await exists(pauseFile))))) throw new Error("Pause marker was not removed");
const resumed = { marker: false };

const expected = [[true, true], [false, true], [false, false], [true, false], [true, true]];
const settingsSnapshots = [];
for (const targetState of expected) {
  let current = await checkboxState();
  for (let index = 0; index < targetState.length; index += 1) {
    if (current[index] === targetState[index]) continue;
    await clickCheckbox(index);
    const persisted = await waitFor(async () => {
      const dom = await checkboxState();
      const file = JSON.parse(await readFile(settingsFile, "utf8"));
      return dom[index] === targetState[index]
        && file.launchAtLogin === targetState[0]
        && file.autoStartSkin === targetState[1];
    }, 15000);
    if (!persisted) throw new Error(`Setting state did not persist: ${JSON.stringify(targetState)}`);
    current = await checkboxState();
  }
  settingsSnapshots.push({ dom: current, file: JSON.parse(await readFile(settingsFile, "utf8")) });
}

settingsSnapshots.forEach((snapshot, index) => {
  if (JSON.stringify(snapshot.dom) !== JSON.stringify(expected[index])) {
    throw new Error(`Unexpected DOM setting state at step ${index}: ${JSON.stringify(snapshot.dom)}`);
  }
  const fromFile = [snapshot.file.launchAtLogin, snapshot.file.autoStartSkin];
  if (JSON.stringify(fromFile) !== JSON.stringify(expected[index])) {
    throw new Error(`Unexpected persisted setting state at step ${index}: ${JSON.stringify(fromFile)}`);
  }
});

const result = { checkedAt: new Date().toISOString(), paused, resumed, settingsSnapshots };
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
socket.close();
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
