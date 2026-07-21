import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const engineRoot = "src-tauri/resources/dream-skin-engine";
let nextLocalCdpPort = 20000 + (process.pid % 10000);

async function waitForFile(file, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fs.access(file);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error(`timed out waiting for ${file}`);
}

function runChild(program, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { timeoutMs, ...spawnOptions } = options;
    const child = spawn(program, args, { windowsHide: true, ...spawnOptions });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = timeoutMs
      ? setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs)
      : null;
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => {
      if (timeout) clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      if (timeout) clearTimeout(timeout);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

function decodeClientTextFrame(buffer) {
  if (buffer.length < 2) return null;
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    const extended = buffer.readBigUInt64BE(2);
    if (extended > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("WebSocket test frame is too large");
    length = Number(extended);
    offset = 10;
  }
  const masked = (buffer[1] & 0x80) !== 0;
  const maskBytes = masked ? 4 : 0;
  if (buffer.length < offset + maskBytes + length) return null;
  const mask = masked ? buffer.subarray(offset, offset + 4) : null;
  offset += maskBytes;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask) {
    for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
  }
  return { opcode: buffer[0] & 0x0f, payload, consumed: offset + length };
}

function encodeServerTextFrame(value) {
  const payload = Buffer.from(JSON.stringify(value), "utf8");
  if (payload.length < 126) return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  const header = Buffer.alloc(4);
  header[0] = 0x81;
  header[1] = 126;
  header.writeUInt16BE(payload.length, 2);
  return Buffer.concat([header, payload]);
}

async function createLocalCdpServer(mode) {
  const sockets = new Set();
  const requests = [];
  const server = createHttpServer((request, response) => {
    if (mode === "http-timeout") return;
    if (request.url !== "/json") {
      response.writeHead(404).end();
      return;
    }
    const { port } = server.address();
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify([{
      type: "page",
      url: "http://tauri.localhost/",
      webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/studio`,
    }]));
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.once("close", () => sockets.delete(socket));
  });
  server.on("upgrade", (request, socket) => {
    if (mode === "upgrade-timeout") return;
    if (mode === "close-before-open") {
      socket.destroy();
      return;
    }
    const accept = createHash("sha1")
      .update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"));
    let buffered = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length > 0) {
        const frame = decodeClientTextFrame(buffered);
        if (!frame) return;
        buffered = buffered.subarray(frame.consumed);
        if (frame.opcode === 8) {
          socket.write(Buffer.from([0x88, 0x02, 0x03, 0xe8]));
          socket.end();
          continue;
        }
        if (frame.opcode !== 1) continue;
        const value = JSON.parse(frame.payload.toString("utf8"));
        requests.push(value);
        if (mode === "reply") {
          socket.write(encodeServerTextFrame({
            id: value.id,
            result: { result: { type: "string", value: "ok" } },
          }));
        } else if (mode === "close") {
          socket.write(Buffer.from([0x88, 0x02, 0x03, 0xe8]));
          socket.end();
        } else if (mode === "error") {
          socket.write(Buffer.from([0xc1, 0x00]));
        }
      }
    });
  });
  let listening = false;
  for (let attempt = 0; attempt < 100 && !listening; attempt += 1) {
    const port = nextLocalCdpPort++;
    try {
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          server.removeListener("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          server.removeListener("error", onError);
          resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, "127.0.0.1");
      });
      listening = true;
    } catch (error) {
      if (error?.code !== "EADDRINUSE") throw error;
    }
  }
  if (!listening) throw new Error("Could not reserve a safe local CDP test port");
  return {
    port: server.address().port,
    requests,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function runCdpDriver(mode, timeoutMs = 100, outerTimeoutMs = 3000) {
  const cdp = await createLocalCdpServer(mode);
  try {
    const startedAt = Date.now();
    const result = await runChild(process.execPath, [
      "tests/acceptance/cdp-tauri-invoke.mjs",
      String(cdp.port),
      "--eval",
      JSON.stringify({ expression: "Promise.resolve('ok')" }),
      "--timeout-ms",
      String(timeoutMs),
    ], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], timeoutMs: outerTimeoutMs });
    return { ...result, elapsedMs: Date.now() - startedAt, requests: cdp.requests };
  } finally {
    await cdp.close();
  }
}

function extractLifecycleHelpers(script) {
  const match = script.match(/\/\* lifecycle-helper:start \*\/([\s\S]*?)\/\* lifecycle-helper:end \*\//);
  assert.ok(match, "live lifecycle script must publish its pure JavaScript helpers");
  const context = vm.createContext({});
  return vm.runInContext(
    `${match[1]}; ({ failedTransitionMode, readStudioErrorFromReactFiber, readCurrentStudioError, createRuntimeRecorder, createOfficialStabilityGate, createLifecycleDeadlineGuard, createLifecycleWaitFor, createGuardedLifecycleClick })`,
    context,
  );
}

test("runtime lifecycle keeps its published verification budgets", async () => {
  const [verify, start] = await Promise.all([
    fs.readFile(`${engineRoot}/scripts/verify-dream-skin.ps1`, "utf8"),
    fs.readFile(`${engineRoot}/scripts/start-dream-skin.ps1`, "utf8"),
  ]);
  assert.match(verify, /\[int\]\s*\$TimeoutMilliseconds\s*=\s*30000/);
  assert.match(verify, /'--timeout-ms'\s*,\s*"\$TimeoutMilliseconds"/);
  assert.match(start, /'--timeout-ms'\s*,\s*'6000'/);
});

test("runtime verification is read-only while mutations retain the operation mutex", async () => {
  const scripts = await Promise.all(
    ["verify", "start", "restore", "install"].map(async (operation) => [
      operation,
      await fs.readFile(`${engineRoot}/scripts/${operation}-dream-skin.ps1`, "utf8"),
    ]),
  );
  const source = Object.fromEntries(scripts);

  assert.doesNotMatch(source.verify, /Enter-DreamSkinOperationLock|Exit-DreamSkinOperationLock/);
  for (const operation of ["start", "restore", "install"]) {
    assert.match(source[operation], /Enter-DreamSkinOperationLock/);
    assert.match(source[operation], /Exit-DreamSkinOperationLock/);
  }
});

test("an inactive verification remains deterministic while the mutation mutex is held", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "dream-skin-mutex-contract-"));
  const ready = path.join(temporary, "ready");
  const stop = path.join(temporary, "stop");
  const quote = (value) => value.replaceAll("'", "''");
  const holder = spawn("powershell.exe", [
    "-NoProfile",
    "-Command",
    `$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; ` +
      `$mutex = [System.Threading.Mutex]::new($false, "Local\\CodexDreamSkin.$sid.Operation"); ` +
      `$null = $mutex.WaitOne(); Set-Content -LiteralPath '${quote(ready)}' -Value ready; ` +
      `try { while (-not (Test-Path -LiteralPath '${quote(stop)}')) { Start-Sleep -Milliseconds 25 } } ` +
      `finally { $mutex.ReleaseMutex(); $mutex.Dispose() }`,
  ], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const server = createServer((socket) => socket.destroy());

  try {
    await waitForFile(ready);
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const port = server.address().port;
    const result = await runChild("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", path.resolve(`${engineRoot}/scripts/verify-dream-skin.ps1`),
      "-Port", String(port),
      "-SessionOnly",
    ], {
      cwd: process.cwd(),
      env: { ...process.env, LOCALAPPDATA: temporary },
      stdio: ["ignore", "pipe", "pipe"],
    });

    assert.notEqual(result.code, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /No verified Codex CDP endpoint is active/);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /Another Codex Dream Skin .* operation is already running/);
  } finally {
    await fs.writeFile(stop, "stop");
    await new Promise((resolve) => holder.once("close", resolve));
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test("restore deletes runtime markers with checked failures", async () => {
  const restore = await fs.readFile(`${engineRoot}/scripts/restore-dream-skin.ps1`, "utf8");

  assert.match(
    restore,
    /if\s*\(Test-Path -LiteralPath \$StatePath\)\s*\{[\s\S]*?Remove-Item -LiteralPath \$StatePath -Force -ErrorAction Stop[\s\S]*?\}/,
  );
  assert.match(
    restore,
    /if\s*\(Test-Path -LiteralPath \$PausedPath\)\s*\{[\s\S]*?Remove-Item -LiteralPath \$PausedPath -Force -ErrorAction Stop[\s\S]*?\}/,
  );
  assert.match(restore, /if\s*\(Test-Path -LiteralPath \$StatePath\)\s*\{\s*throw/);
  assert.match(restore, /if\s*\(Test-Path -LiteralPath \$PausedPath\)\s*\{\s*throw/);
});

test("private Node acceptance invokes the real Rust Studio probe", async () => {
  const acceptance = await fs.readFile("tests/acceptance/private-node-runtime.test.ps1", "utf8");
  assert.ok(acceptance.includes("'private_node_runtime'"));
  assert.match(acceptance, /DREAM_SKIN_NODE_SCENARIO/);
  assert.doesNotMatch(acceptance, /Get-DreamSkinNodeRuntime/);
  assert.doesNotMatch(acceptance, /nodeSource\s*=/);
});

test("private Node metadata and packaged executable agree", async () => {
  const [sourceText, nodeBytes, license, manifestText] = await Promise.all([
    fs.readFile(`${engineRoot}/runtime/NODE-SOURCE.json`, "utf8"),
    fs.readFile(`${engineRoot}/runtime/node.exe`),
    fs.readFile(`${engineRoot}/runtime/LICENSE`, "utf8"),
    fs.readFile(`${engineRoot}/ENGINE-SOURCE.json`, "utf8"),
  ]);
  const source = JSON.parse(sourceText.replace(/^\uFEFF/, ""));
  const manifest = JSON.parse(manifestText.replace(/^\uFEFF/, ""));

  assert.equal(source.version, "24.18.0");
  assert.equal(source.platform, "win");
  assert.equal(source.arch, "x64");
  assert.match(source.archiveSha256, /^[A-F0-9]{64}$/);
  assert.equal(
    createHash("sha256").update(nodeBytes).digest("hex").toUpperCase(),
    source.nodeExeSha256,
  );
  assert.match(license, /Node\.js is licensed for use as follows/);

  for (const path of ["runtime/node.exe", "runtime/LICENSE", "runtime/NODE-SOURCE.json"]) {
    assert.ok(manifest.files.some((entry) => entry.path === path), `${path} is absent from ENGINE-SOURCE.json`);
  }
});

test("README documents lifecycle reconciliation and private Node recovery", async () => {
  const readme = await fs.readFile("README.md", "utf8");

  for (const required of [
    "启动皮肤和恢复官方外观",
    "正在等待 Codex 界面",
    "校准实际状态",
    "打开日志",
    "内置 Node.js 24.18.0",
    "不会修改或替换系统 Node.js",
    "受管引擎标记为未安装且不允许启动皮肤",
    "重新检测环境",
  ]) {
    assert.ok(readme.includes(required), `README is missing: ${required}`);
  }
});

test("live lifecycle acceptance refuses to run without its explicit gate", async () => {
  const output = path.join(os.tmpdir(), `dream-skin-live-refusal-${process.pid}-${Date.now()}.json`);
  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", "tests/acceptance/runtime-lifecycle-live.ps1",
    "-OutputPath", output,
  ], { encoding: "utf8" });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Refusing real Restore\/Start acceptance without -AllowLifecycle\./);
  await assert.rejects(fs.access(output));
});

test("live lifecycle acceptance requires a separate paired-restart gate before setup", async () => {
  const token = `${process.pid}-${Date.now()}`;
  const output = path.join(os.tmpdir(), `dream-skin-live-pair-refusal-${token}.json`);
  const missingInstaller = path.join(os.tmpdir(), `dream-skin-missing-installer-${token}.exe`);
  const missingStudio = path.join(os.tmpdir(), `dream-skin-missing-studio-${token}.exe`);
  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", "tests/acceptance/runtime-lifecycle-live.ps1",
    "-AllowLifecycle",
    "-OutputPath", output,
    "-InstallerPath", missingInstaller,
    "-StudioExecutable", missingStudio,
  ], { encoding: "utf8" });

  try {
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /Refusing paired Codex restart acceptance without -AllowRestartPair\./);
    await assert.rejects(fs.access(output));
  } finally {
    await fs.rm(output, { force: true });
  }
});

test("Studio CDP driver rejects pending commands when the target closes", async () => {
  const result = await runCdpDriver("close", 1000);

  assert.equal(result.timedOut, false, `${result.stdout}\n${result.stderr}`);
  assert.notEqual(result.code, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /CDP_SOCKET_CLOSED/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /unsettled top-level await/i);
});

for (const [mode, expectedStage] of [
  ["http-timeout", "target discovery"],
  ["upgrade-timeout", "WebSocket open"],
]) {
  test(`Studio CDP driver bounds ${expectedStage} with the absolute deadline`, async () => {
    const result = await runCdpDriver(mode, 1000, 3000);

    assert.equal(result.timedOut, false, `driver required the test kill: ${result.stdout}\n${result.stderr}`);
    assert.notEqual(result.code, 0);
    assert.ok(result.elapsedMs < 2500, `driver exceeded its own 1000 ms deadline: ${result.elapsedMs} ms`);
    assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(`CDP_COMMAND_TIMEOUT.*${expectedStage}`, "i"));
  });
}

test("Studio CDP driver rejects a socket that closes before open", async () => {
  const result = await runCdpDriver("close-before-open", 1000, 3000);

  assert.equal(result.timedOut, false, `driver required the test kill: ${result.stdout}\n${result.stderr}`);
  assert.notEqual(result.code, 0);
  assert.ok(result.elapsedMs < 2500, `driver did not settle within its 1000 ms budget: ${result.elapsedMs} ms`);
  assert.match(`${result.stdout}\n${result.stderr}`, /CDP_SOCKET_(?:CLOSED|ERROR)/);
});

test("Studio CDP driver rejects pending commands when the socket errors", async () => {
  const result = await runCdpDriver("error", 1000);

  assert.equal(result.timedOut, false, `${result.stdout}\n${result.stderr}`);
  assert.notEqual(result.code, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /CDP_SOCKET_ERROR/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /unsettled top-level await/i);
});

test("Studio CDP driver enforces its command timeout", async () => {
  const result = await runCdpDriver("timeout", 1000, 3000);

  assert.equal(result.timedOut, false, `${result.stdout}\n${result.stderr}`);
  assert.notEqual(result.code, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /CDP_COMMAND_TIMEOUT.*Runtime\.evaluate.*1000 ms/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /unsettled top-level await/i);
});

test("Studio CDP driver registers pending commands before sending", async () => {
  const result = await runCdpDriver("reply", 1000);
  const source = await fs.readFile("tests/acceptance/cdp-tauri-invoke.mjs", "utf8");

  assert.equal(result.timedOut, false, `${result.stdout}\n${result.stderr}`);
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(JSON.parse(result.stdout), "ok");
  assert.equal(result.requests.length, 1);
  assert.equal(result.requests[0].method, "Runtime.evaluate");
  assert.ok(
    source.indexOf("pending.set(id") < source.indexOf("socket.send(JSON.stringify({ id, method, params }))"),
    "the pending command must be registered before socket.send can expose a response",
  );
});

test("live lifecycle acceptance is syntactically valid and drives lifecycle through Studio UI", async () => {
  const scriptPath = "tests/acceptance/runtime-lifecycle-live.ps1";
  const script = await fs.readFile(scriptPath, "utf8");
  const parse = spawnSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    `$errors = $null; [System.Management.Automation.Language.Parser]::ParseFile('${path.resolve(scriptPath).replaceAll("'", "''")}', [ref]$null, [ref]$errors) | Out-Null; if ($errors.Count) { $errors | ForEach-Object { Write-Error $_ }; exit 1 }`,
  ], { encoding: "utf8" });

  assert.equal(parse.status, 0, `${parse.stdout}\n${parse.stderr}`);
  assert.match(script, /cdp-tauri-invoke\.mjs/);
  assert.match(script, /\[switch\]\$AllowRestartPair/);
  assert.match(script, /gate\s*=\s*'AllowLifecycle\+AllowRestartPair'/);
  assert.ok(
    script.indexOf("if (-not $AllowRestartPair)") < script.indexOf("$projectRoot ="),
    "the paired-restart gate must reject before setup resolves installation or Studio paths",
  );
  assert.match(script, /--eval/);
  assert.match(script, /Invoke-StudioEval[\s\S]+?--timeout-ms['",\s]+['"]?30000/);
  assert.match(script, /\$driverTimeoutMilliseconds\s*=\s*\(\$LifecycleTimeoutSeconds\s*\+\s*10\)\s*\*\s*1000/);
  assert.match(script, /Start-StudioLifecycleDriver[\s\S]+?--timeout-ms['",\s]+"\$driverTimeoutMilliseconds"/);
  assert.match(script, /ConvertTo-WindowsCommandLineArgument\s+-Value\s+\$studioDriver/);
  assert.match(script, /runtime-dialog__index/);
  assert.match(script, /MutationObserver/);
  assert.match(script, /domTimeline/);
  assert.match(script, /const click = createGuardedLifecycleClick\(/);
  assert.doesNotMatch(
    script.slice(script.indexOf("/* lifecycle-helper:end */")),
    /button\.click\(\)/,
    "all lifecycle button mutations must flow through the deadline-guarded click helper",
  );
  assert.ok(
    script.indexOf("const dom = captureDom(phase);") < script.indexOf("const runtime = await invokeRuntime();"),
    "DOM state must be captured synchronously before the runtime RPC",
  );
  assert.match(script, /RESTORE \/ PROGRESS/);
  assert.match(script, /START \/ PROGRESS/);
  const restoreCloseIndex = script.indexOf("'restore dialog close'");
  const stabilityGateIndex = script.indexOf("'official stability gate'");
  const startClickIndex = script.indexOf("'Start skin'");
  assert.ok(
    restoreCloseIndex >= 0 && restoreCloseIndex < stabilityGateIndex && stabilityGateIndex < startClickIndex,
    "Start must wait until the restore dialog closes and the official runtime stability gate completes",
  );
  assert.match(script, /index === 'START \/ CONFIRM' \|\| index === 'START \/ PROGRESS'/);
  assert.match(script, /const record = createRuntimeRecorder\(/);
  assert.match(script, /latestDom:\s*\(\) => domTimeline\.at\(-1\)/);
  assert.ok(
    script.indexOf("const failedMode = failedTransitionMode(failedSnapshot?.dialogIndex);") < script.indexOf("const runtime = await invokeRuntime();"),
    "failed dialogs must abort before the runtime RPC",
  );
  assert.match(script, /readCurrentStudioError\(document\)/);
  assert.match(script, /errorDetail/);
  assert.match(script, /\$evidence\.errorDetail\s*=\s*\$uiLifecycle\.errorDetail/);
  assert.match(script, /Studio UI lifecycle failed:[^\r\n]+errorDetailJson/);
  assert.doesNotMatch(script, /let currentIndex = dialogIndex\(\)/);
  assert.doesNotMatch(script, /cdp-tauri-invoke\.mjs[^\r\n]*(start_skin|restore_official_appearance)/);
  assert.doesNotMatch(script, /(?:start|restore)-dream-skin\.ps1/);
  assert.match(script, /verify-dream-skin\.ps1/);
  assert.match(script, /-TimeoutMilliseconds['",\s]+['"]?30000/);
  assert.match(script, /StudioPids/);
  assert.match(script, /CodexPids/);
  assert.match(script, /WatcherPids/);
  assert.match(script, /VerifierPids/);
  assert.match(script, /Port9335OwnerPids/);
  assert.match(script, /VisibleTerminalPids/);
  assert.match(script, /newVisibleTerminalPidsDuringLifecycle/);
  assert.match(script, /processTimeline[\s\S]+VisibleTerminalPids/);
  assert.ok(
    script.lastIndexOf("$processTimeline = @($timeline)") > script.indexOf("Invoke-DeepVerifier -NodePath"),
    "the persisted process timeline must include deep-verifier sampling",
  );
  assert.match(script, /NodeSource/);
  assert.match(script, /NodeVersion/);
  assert.match(script, /NodePath/);
  assert.match(script, /InstallerPath/);
  assert.match(script, /installerSha256/);
  assert.match(script, /RegistrySnapshot/);
  assert.match(script, /PathSnapshot/);
  assert.match(script, /Move-Item[^\r\n]+-LiteralPath[^\r\n]+-Destination/);
  assert.match(script, /evidenceWriteError/);
  assert.match(script, /if \(\$null -eq \$failure\)[\s\S]+\$failure = \$_/);
});

test("Windows argv quoting preserves a Studio driver path containing spaces", () => {
  const helper = path.resolve("tests/acceptance/runtime-lifecycle-path.ps1").replaceAll("'", "''");
  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    `. '${helper}'; ConvertTo-WindowsCommandLineArgument -Value 'C:\\Program Files\\Dream Skin Studio\\cdp-tauri-invoke.mjs'`,
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(result.stdout.trim(), '"C:\\Program Files\\Dream Skin Studio\\cdp-tauri-invoke.mjs"');
});

test("live lifecycle helpers fail fast for failed transition dialogs", async () => {
  const script = await fs.readFile("tests/acceptance/runtime-lifecycle-live.ps1", "utf8");
  const { failedTransitionMode } = extractLifecycleHelpers(script);

  assert.equal(failedTransitionMode("RESTORE / FAILED"), "restore");
  assert.equal(failedTransitionMode("START / FAILED"), "start");
  assert.equal(failedTransitionMode("RESTORE / PROGRESS"), null);
  assert.equal(failedTransitionMode(null), null);
});

test("official runtime stability requires four continuous seconds and resets on transient mismatch", async () => {
  const script = await fs.readFile("tests/acceptance/runtime-lifecycle-live.ps1", "utf8");
  const { createOfficialStabilityGate } = extractLifecycleHelpers(script);
  const gate = createOfficialStabilityGate({ requiredStableMs: 4000, codexWasRunning: true });
  const official = { skinActive: false, starting: false, codexRunning: true };

  assert.equal(gate({ now: 0, dialogIndex: null, runtime: official }), false);
  assert.equal(gate({ now: 3999, dialogIndex: null, runtime: official }), false);
  assert.equal(gate({ now: 4000, dialogIndex: "RESTORE / PROGRESS", runtime: official }), false);
  assert.equal(gate({ now: 4500, dialogIndex: null, runtime: official }), false);
  assert.equal(gate({ now: 8499, dialogIndex: null, runtime: official }), false);
  assert.equal(gate({ now: 8500, dialogIndex: null, runtime: official }), true);
  assert.equal(gate({ now: 9000, dialogIndex: null, runtime: { ...official, starting: true } }), false);
  assert.equal(gate({ now: 13000, dialogIndex: null, runtime: official }), false);
  assert.equal(gate({ now: 17000, dialogIndex: null, runtime: official }), true);
});

test("lifecycle wait rejects a record that settles after the deadline before evaluating its predicate", async () => {
  const script = await fs.readFile("tests/acceptance/runtime-lifecycle-live.ps1", "utf8");
  const { createLifecycleDeadlineGuard, createLifecycleWaitFor } = extractLifecycleHelpers(script);
  let now = 10;
  let predicateCalls = 0;
  const deadlineGuard = createLifecycleDeadlineGuard({ deadline: 100, now: () => now });
  const waitFor = createLifecycleWaitFor({
    deadlineGuard,
    record: async () => {
      now = 101;
      return { runtime: { skinActive: false }, dialogIndex: null };
    },
    sleep: async () => {},
  });

  await assert.rejects(
    waitFor(() => {
      predicateCalls += 1;
      return true;
    }, "delayed runtime record"),
    /Timed out waiting for delayed runtime record/,
  );
  assert.equal(predicateCalls, 0);
});

test("lifecycle click refuses to mutate an expired WebView", async () => {
  const script = await fs.readFile("tests/acceptance/runtime-lifecycle-live.ps1", "utf8");
  const { createLifecycleDeadlineGuard, createGuardedLifecycleClick } = extractLifecycleHelpers(script);
  let clickCalls = 0;
  let captureCalls = 0;
  const deadlineGuard = createLifecycleDeadlineGuard({ deadline: 100, now: () => 100 });
  const button = { disabled: false, click: () => { clickCalls += 1; } };
  const click = createGuardedLifecycleClick({
    deadlineGuard,
    findButton: () => button,
    isButton: (candidate) => candidate === button,
    captureDom: () => { captureCalls += 1; },
  });

  assert.throws(() => click("#start", "Start skin"), /Timed out waiting for Start skin/);
  assert.equal(clickCalls, 0);
  assert.equal(captureCalls, 0);
});

test("live lifecycle recorder rejects an already-failed dialog before a stalled runtime RPC", async () => {
  const script = await fs.readFile("tests/acceptance/runtime-lifecycle-live.ps1", "utf8");
  const { createRuntimeRecorder } = extractLifecycleHelpers(script);
  let rpcCalls = 0;
  const observations = [];
  const failedSnapshot = {
    at: "2026-07-20T12:00:00.000Z",
    phase: "official target",
    dialogIndex: "RESTORE / FAILED",
    dialogBusy: false,
  };
  const record = createRuntimeRecorder({
    captureDom: () => failedSnapshot,
    latestDom: () => failedSnapshot,
    readCurrentError: () => ({
      code: "ENGINE_COMMAND_FAILED",
      message: "restore failed",
      detail: "exit 1",
      source: "react-fiber",
    }),
    invokeRuntime: () => {
      rpcCalls += 1;
      return new Promise(() => {});
    },
    observations,
    now: () => "2026-07-20T12:00:00.001Z",
  });

  await assert.rejects(
    Promise.race([
      record("official target"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("recorder did not reject promptly")), 50)),
    ]),
    (error) => error.message.includes("RESTORE / FAILED") && error.errorDetail?.detail === "exit 1",
  );
  assert.equal(rpcCalls, 0);
  assert.equal(observations.length, 0);
});

test("live lifecycle helpers read StudioError details from React fiber without mutation", async () => {
  const script = await fs.readFile("tests/acceptance/runtime-lifecycle-live.ps1", "utf8");
  const { readStudioErrorFromReactFiber } = extractLifecycleHelpers(script);
  const studioError = {
    code: "PROCESS_TIMEOUT",
    message: "restore timed out",
    detail: "verify-dream-skin.ps1 exceeded its budget",
  };
  const ownerFiber = { memoizedProps: { error: studioError }, pendingProps: null, return: null, child: null, sibling: null };
  const hostFiber = { memoizedProps: {}, pendingProps: null, return: ownerFiber, child: null, sibling: null };
  const element = { "__reactFiber$contract": hostFiber };
  const before = JSON.stringify({ studioError, ownerProps: ownerFiber.memoizedProps });

  assert.deepEqual(
    JSON.parse(JSON.stringify(readStudioErrorFromReactFiber(element))),
    { code: "PROCESS_TIMEOUT", message: "restore timed out", detail: "verify-dream-skin.ps1 exceeded its budget", source: "react-fiber" },
  );
  assert.equal(JSON.stringify({ studioError, ownerProps: ownerFiber.memoizedProps }), before);
});

test("live lifecycle helpers can recover a sibling StatusStrip error from the dialog fiber tree", async () => {
  const script = await fs.readFile("tests/acceptance/runtime-lifecycle-live.ps1", "utf8");
  const { readStudioErrorFromReactFiber } = extractLifecycleHelpers(script);
  const studioError = { code: "ENGINE_COMMAND_FAILED", message: "restore failed", detail: "exit 1" };
  const statusFiber = { memoizedProps: { error: studioError }, pendingProps: null, return: null, child: null, sibling: null };
  const dialogFiber = { memoizedProps: {}, pendingProps: null, return: null, child: null, sibling: statusFiber };
  const rootFiber = { memoizedProps: {}, pendingProps: null, return: null, child: dialogFiber, sibling: null };
  dialogFiber.return = rootFiber;
  statusFiber.return = rootFiber;
  const dialog = { "__reactFiber$contract": dialogFiber };

  assert.deepEqual(
    JSON.parse(JSON.stringify(readStudioErrorFromReactFiber(dialog))),
    { code: "ENGINE_COMMAND_FAILED", message: "restore failed", detail: "exit 1", source: "react-fiber" },
  );
});

test("live lifecycle helpers fall back to failed dialog DOM text", async () => {
  const script = await fs.readFile("tests/acceptance/runtime-lifecycle-live.ps1", "utf8");
  const { readCurrentStudioError } = extractLifecycleHelpers(script);
  const failedDialog = {
    textContent: "RESTORE / FAILED Restore official appearance restore failed Open logs Retry",
    querySelector(selector) {
      if (selector === ".runtime-dialog__index") return { textContent: "RESTORE / FAILED" };
      if (selector === '[aria-live="polite"]') return { textContent: "restore failed" };
      return null;
    },
  };
  const documentLike = {
    querySelector(selector) {
      if (selector === ".runtime-status-strip") return null;
      if (selector === ".runtime-dialog") return failedDialog;
      return null;
    },
  };

  assert.deepEqual(
    JSON.parse(JSON.stringify(readCurrentStudioError(documentLike))),
    { code: "RESTORE_FAILED", message: "restore failed", detail: null, source: "dom" },
  );
});
