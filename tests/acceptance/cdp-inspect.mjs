import { mkdir, writeFile } from "node:fs/promises";
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
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});

function command(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await command("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

await command("Page.enable");
await command("Runtime.enable");
await evaluate(`new Promise(resolve => document.readyState === "complete" ? resolve() : addEventListener("load", resolve, { once: true }))`);
await new Promise((resolve) => setTimeout(resolve, 1500));

const inspection = await evaluate(`(() => ({
  title: document.title,
  bodyText: document.body.innerText,
  buttons: [...document.querySelectorAll("button")].map((element) => ({
    text: element.innerText.trim(),
    disabled: element.disabled,
    ariaLabel: element.getAttribute("aria-label")
  })),
  inputs: [...document.querySelectorAll("input")].map((element) => ({
    type: element.type,
    value: element.value,
    min: element.min,
    max: element.max,
    checked: element.checked,
    ariaLabel: element.getAttribute("aria-label")
  })),
  sections: [...document.querySelectorAll("section")].map((element) => element.getAttribute("aria-label")).filter(Boolean),
  images: [...document.images].map((element) => ({ src: element.src, alt: element.alt, complete: element.complete }))
}))()`);

const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await mkdir(outputDir, { recursive: true });
await writeFile(path.join(outputDir, "studio-main.png"), Buffer.from(screenshot.data, "base64"));
await writeFile(path.join(outputDir, "studio-dom.json"), `${JSON.stringify(inspection, null, 2)}\n`, "utf8");
socket.close();
process.stdout.write(`${JSON.stringify({
  title: inspection.title,
  sections: inspection.sections,
  buttonCount: inspection.buttons.length,
  inputCount: inspection.inputs.length,
  imageCount: inspection.images.length,
  bodyIncludesYingying: inspection.bodyText.includes("萦萦"),
  screenshot: path.join(outputDir, "studio-main.png"),
  dom: path.join(outputDir, "studio-dom.json")
}, null, 2)}\n`);
