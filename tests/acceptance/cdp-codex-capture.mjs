import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const port = Number(process.argv[2] ?? 9335);
const outputDir = path.resolve(process.argv[3] ?? "docs/verification");
const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
const target = targets.filter((item) => item.type === "page").at(-1);
if (!target) throw new Error("Codex page target was not found");
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
async function capture(filename) {
  const result = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(path.join(outputDir, filename), Buffer.from(result.data, "base64"));
}

await command("Page.enable");
await mkdir(outputDir, { recursive: true });
await sleep(750);
await evaluate(`(() => {
  const style = document.createElement('style');
  style.id = 'dream-skin-acceptance-redaction';
  style.textContent = 'body * { color: transparent !important; text-shadow: none !important; caret-color: transparent !important; }';
  document.head.append(style);
})()`);
await sleep(300);
await capture("codex-task-redaction-source.png");

const home = await evaluate(`(() => {
  const match = [...document.querySelectorAll('button')].find(element => element.getAttribute('aria-label') === '新建任务');
  if (!match) return { found: false };
  match.click();
  return { found: true, control: 'aria-label:new-task' };
})()`);
if (!home.found) throw new Error("Codex New Task control was not found");
await sleep(1500);
await capture("codex-home-redacted.png");
await evaluate(`document.getElementById('dream-skin-acceptance-redaction')?.remove()`);

const result = {
  checkedAt: new Date().toISOString(),
  redactionApplied: true,
  newTaskNavigation: home,
  homeScreenshot: path.join(outputDir, "codex-home-redacted.png"),
  taskScreenshot: path.join(outputDir, "codex-task-redacted.png"),
};
await writeFile(path.join(outputDir, "codex-capture.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
socket.close();
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
