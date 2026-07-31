const port = Number(process.argv[2] ?? 9444);
const tauriCommand = process.argv[3];
const rawArgs = process.argv[4] ?? "{}";
const timeoutFlagIndex = process.argv.indexOf("--timeout-ms");
const commandTimeoutMs = Number(timeoutFlagIndex >= 0 ? process.argv[timeoutFlagIndex + 1] : 30000);
const args = JSON.parse(rawArgs.startsWith("base64:")
  ? Buffer.from(rawArgs.slice(7), "base64").toString("utf8")
  : rawArgs);
if (!tauriCommand) throw new Error("A Tauri command name is required");
if (!Number.isFinite(commandTimeoutMs) || commandTimeoutMs <= 0) {
  throw new Error("--timeout-ms must be a positive number");
}
const deadlineAt = Date.now() + commandTimeoutMs;
const deadlineError = (stage) => new Error(
  `CDP_COMMAND_TIMEOUT: ${stage} did not complete within the absolute ${commandTimeoutMs} ms deadline`,
);
const remainingMilliseconds = (stage) => {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw deadlineError(stage);
  return remaining;
};
const withDeadline = (stage, operation, onTimeout = () => {}) => new Promise((resolve, reject) => {
  let settled = false;
  const finish = (handler, value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    handler(value);
  };
  let timeoutMs;
  try {
    timeoutMs = remainingMilliseconds(stage);
  } catch (error) {
    reject(error);
    return;
  }
  const timer = setTimeout(() => {
    try { onTimeout(); } catch {}
    finish(reject, deadlineError(stage));
  }, timeoutMs);
  Promise.resolve()
    .then(operation)
    .then((value) => finish(resolve, value), (error) => finish(reject, error));
});
const discoveryController = new AbortController();
const targets = await withDeadline("target discovery", async () => {
  const response = await fetch(`http://127.0.0.1:${port}/json`, { signal: discoveryController.signal });
  if (!response.ok) throw new Error(`Studio WebView target discovery failed with HTTP ${response.status}`);
  return response.json();
}, () => discoveryController.abort());
const target = targets
  .find((item) => item.type === "page" && item.url.startsWith("http://tauri.localhost"));
if (!target) throw new Error("Studio WebView target was not found");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await withDeadline("WebSocket open", () => new Promise((resolve, reject) => {
  const cleanup = () => {
    socket.removeEventListener("open", opened);
    socket.removeEventListener("error", failed);
    socket.removeEventListener("close", closed);
  };
  const opened = () => {
    cleanup();
    resolve();
  };
  const failed = () => {
    cleanup();
    reject(new Error("CDP_SOCKET_ERROR: Studio WebView CDP socket failed to open"));
  };
  const closed = ({ code, reason }) => {
    cleanup();
    const detail = reason ? `; reason=${reason}` : "";
    reject(new Error(`CDP_SOCKET_CLOSED: Studio WebView CDP socket closed before opening; code=${code}${detail}`));
  };
  socket.addEventListener("open", opened, { once: true });
  socket.addEventListener("error", failed, { once: true });
  socket.addEventListener("close", closed, { once: true });
}), () => {
  try { socket.close(); } catch {}
});
let nextId = 1;
const pending = new Map();
const rejectAll = (error) => {
  for (const handlers of pending.values()) {
    clearTimeout(handlers.timer);
    handlers.reject(error);
  }
  pending.clear();
};
socket.addEventListener("message", ({ data }) => {
  let message;
  try {
    message = JSON.parse(data);
  } catch (error) {
    rejectAll(new Error(`CDP_PROTOCOL_ERROR: Studio WebView returned invalid JSON: ${error.message}`));
    return;
  }
  if (!message.id || !pending.has(message.id)) return;
  const handlers = pending.get(message.id);
  pending.delete(message.id);
  clearTimeout(handlers.timer);
  message.error ? handlers.reject(new Error(message.error.message)) : handlers.resolve(message.result);
});
socket.addEventListener("error", () => {
  rejectAll(new Error("CDP_SOCKET_ERROR: Studio WebView CDP socket failed while a command was pending"));
});
socket.addEventListener("close", ({ code, reason }) => {
  const detail = reason ? `; reason=${reason}` : "";
  rejectAll(new Error(`CDP_SOCKET_CLOSED: Studio WebView CDP socket closed before the command completed; code=${code}${detail}`));
});
function command(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    let timeoutMs;
    try {
      timeoutMs = remainingMilliseconds(method);
    } catch (error) {
      reject(error);
      return;
    }
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(deadlineError(method));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    try {
      socket.send(JSON.stringify({ id, method, params }));
    } catch (error) {
      pending.delete(id);
      clearTimeout(timer);
      reject(new Error(`CDP_SOCKET_ERROR: Failed to send ${method}: ${error.message}`));
    }
  });
}
let result;
try {
  result = await command("Runtime.evaluate", {
    expression: tauriCommand === "--eval"
      ? String(args.expression)
      : `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(tauriCommand)}, ${JSON.stringify(args)})`,
    awaitPromise: true,
    returnByValue: true,
  });
} finally {
  if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) socket.close();
}
if (result.exceptionDetails) throw new Error(`${result.exceptionDetails.text}: ${JSON.stringify(result)}`);
process.stdout.write(`${JSON.stringify(result.result.value, null, 2)}\n`);
