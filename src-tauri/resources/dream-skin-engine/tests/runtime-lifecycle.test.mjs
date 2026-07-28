import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import os from "node:os";

const here = path.dirname(fileURLToPath(import.meta.url));
const injectorPath = path.resolve(here, "../scripts/injector.mjs");
const injectorUrl = pathToFileURL(injectorPath).href;
const startScriptPath = path.resolve(here, "../scripts/start-dream-skin.ps1");
const commonScriptPath = path.resolve(here, "../scripts/common-windows.ps1");

test("forced Codex shutdown waits for identity-safe process convergence", async () => {
  const escapedScriptPath = commonScriptPath.replaceAll("'", "''");
  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    `$errors = $null; $ast = [System.Management.Automation.Language.Parser]::ParseFile('${escapedScriptPath}', [ref]$null, [ref]$errors); ` +
      `if ($errors.Count) { $errors | ForEach-Object { Write-Error $_ }; exit 1 }; ` +
      `$waitFunction = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Wait-DreamSkinCodexExit' }, $true); ` +
      `$stopFunction = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Stop-DreamSkinCodex' }, $true); ` +
      `if ($null -eq $waitFunction -or $null -eq $stopFunction) { Write-Error 'Codex shutdown functions are missing'; exit 1 }; ` +
      `Invoke-Expression $waitFunction.Extent.Text; ` +
      `function Get-DreamSkinCodexProcesses { param([object]$Codex); $script:inventoryCalls++; $index = [Math]::Min($script:inventoryIndex, $script:inventorySequence.Count - 1); $count = [int]$script:inventorySequence[$index]; $script:inventoryIndex++; if ($count -le 0) { return @() }; return @(1..$count | ForEach-Object { [pscustomobject]@{ ProcessId = $_ } }) }; ` +
      `function Get-Date { return $script:clock }; ` +
      `function Start-Sleep { param([int]$Milliseconds); $script:sleeps += $Milliseconds; $script:clock = $script:clock.AddMilliseconds($Milliseconds) }; ` +
      `function Run-Scenario { param([string]$Name, [int[]]$InventorySequence, [int]$TimeoutSeconds); $script:inventorySequence = @($InventorySequence); $script:inventoryIndex = 0; $script:inventoryCalls = 0; $script:sleeps = @(); $script:clock = [datetime]'2026-07-28T00:00:00Z'; $value = Wait-DreamSkinCodexExit -Codex ([pscustomobject]@{ Executable = 'verified' }) -TimeoutSeconds $TimeoutSeconds; return [pscustomobject]@{ name = $Name; result = [bool]$value; inventoryCalls = $script:inventoryCalls; sleeps = @($script:sleeps) } }; ` +
      `$scenarios = @(` +
        `Run-Scenario -Name 'exited' -InventorySequence @(0) -TimeoutSeconds 10; ` +
        `Run-Scenario -Name 'zero-timeout' -InventorySequence @(1) -TimeoutSeconds 0; ` +
        `Run-Scenario -Name 'converged' -InventorySequence @(1, 1, 0) -TimeoutSeconds 10; ` +
        `Run-Scenario -Name 'timed-out' -InventorySequence @(1) -TimeoutSeconds 1` +
      `); ` +
      `[pscustomobject]@{ helper = $waitFunction.Extent.Text; stop = $stopFunction.Extent.Text; scenarios = $scenarios } | ConvertTo-Json -Depth 6 -Compress`,
  ], {
    encoding: "utf8",
    windowsHide: true,
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const report = JSON.parse(result.stdout.trim());
  const scenarios = Object.fromEntries(report.scenarios.map((scenario) => [scenario.name, scenario]));

  assert.match(report.helper, /Get-DreamSkinCodexProcesses -Codex \$Codex/);
  assert.match(report.helper, /Start-Sleep -Milliseconds 250/);
  assert.deepEqual(scenarios.exited, {
    name: "exited",
    result: true,
    inventoryCalls: 1,
    sleeps: [],
  });
  assert.deepEqual(scenarios["zero-timeout"], {
    name: "zero-timeout",
    result: false,
    inventoryCalls: 1,
    sleeps: [],
  });
  assert.deepEqual(scenarios.converged, {
    name: "converged",
    result: true,
    inventoryCalls: 3,
    sleeps: [250, 250],
  });
  assert.deepEqual(scenarios["timed-out"], {
    name: "timed-out",
    result: false,
    inventoryCalls: 5,
    sleeps: [250, 250, 250, 250],
  });
  assert.match(report.stop, /Wait-DreamSkinCodexExit -Codex \$Codex -TimeoutSeconds 10/);
  assert.doesNotMatch(report.stop, /Start-Sleep -Milliseconds 500/);
});

test("watcher heartbeat replacement and cleanup preserve the current owner", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dream-skin-heartbeat-"));
  const heartbeat = path.join(directory, "watcher-heartbeat.json");
  const { writeWatcherHeartbeat, removeWatcherHeartbeat } = await import(injectorUrl);

  try {
    await writeWatcherHeartbeat(heartbeat, 1_000, 101);
    assert.deepEqual(JSON.parse(await fs.readFile(heartbeat, "utf8")), {
      processId: 101,
      updatedAt: 1_000,
    });
    await writeWatcherHeartbeat(heartbeat, 2_000, 202);
    await removeWatcherHeartbeat(heartbeat, 101);
    assert.equal(JSON.parse(await fs.readFile(heartbeat, "utf8")).processId, 202);
    await removeWatcherHeartbeat(heartbeat, 202);
    await assert.rejects(fs.stat(heartbeat), { code: "ENOENT" });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("watcher-only recovery refuses to stop or launch Codex without a verified identity", async () => {
  const startScript = await fs.readFile(startScriptPath, "utf8");
  const guard = startScript.indexOf("if ($RecoverWatcherOnly -and $null -eq $cdpIdentity)");
  const stop = startScript.indexOf("Stop-DreamSkinCodex");
  const launch = startScript.indexOf("Start-DreamSkinCodex");

  assert.ok(guard >= 0, "watcher-only recovery guard is missing");
  assert.ok(guard < stop, "watcher-only guard must run before Codex can be stopped");
  assert.ok(guard < launch, "watcher-only guard must run before Codex can be launched");
  assert.match(startScript, /exit\s+4/);
});

test("watcher-only recovery preserves an existing paused state", async () => {
  const startScript = await fs.readFile(startScriptPath, "utf8");

  assert.match(
    startScript,
    /\$preservePausedState\s*=\s*\[bool\]\(\$RecoverWatcherOnly\s*-and\s*\$pauseWasSet\)/,
  );
  assert.match(
    startScript,
    /if\s*\(-not\s+\$preservePausedState\)\s*\{[\s\S]*?Set-DreamSkinPaused\s+-Paused\s+\$false/,
  );
});

async function runInjector(args) {
  const child = spawn(process.execPath, [injectorPath, ...args], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("injector child did not exit after its operation deadline"));
    }, 3000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

async function withHangingMainTarget(run) {
  const upgradedSockets = new Set();
  let port;
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/json/list") {
      response.end(JSON.stringify([{
        id: "main",
        type: "page",
        url: "app://-/index.html",
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/main`,
      }]));
    } else if (request.url === "/json/version") {
      response.end(JSON.stringify({
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/test-browser`,
      }));
    } else {
      response.statusCode = 404;
      response.end("{}");
    }
  });
  server.on("upgrade", (_request, socket) => {
    upgradedSockets.add(socket);
    socket.once("close", () => upgradedSockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      port = server.address().port;
      resolve();
    });
  });
  try {
    return await run(port);
  } finally {
    for (const socket of upgradedSockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("orders the canonical main renderer before avatar overlay", async () => {
  const { orderCodexTargets } = await import(injectorUrl);
  const overlay = { id: "overlay", url: "app://-/index.html?initialRoute=%2Favatar-overlay" };
  const main = { id: "main", url: "app://-/index.html" };
  const other = { id: "other", url: "app://-/index.html?initialRoute=%2Fsettings" };

  assert.deepEqual(orderCodexTargets([overlay, other, main]).map((item) => item.id), [
    "main", "other", "overlay",
  ]);
});

test("shared deadline never grants more than the remaining wall clock", async () => {
  let now = 1_000;
  const { OperationDeadline } = await import(injectorUrl);
  const deadline = new OperationDeadline(80, () => now);

  assert.equal(deadline.timeoutFor(10_000), 80);
  now += 55;
  assert.equal(deadline.timeoutFor(10_000), 25);
  now += 25;
  assert.throws(() => deadline.timeoutFor(10_000), /deadline/i);
});

test("one-shot completion flushes output before requesting process exit", async () => {
  const events = [];
  const { finishOneShot } = await import(injectorUrl);
  await finishOneShot({ output: "{\"pass\":true}\n", exitCode: 0 }, {
    write(value) { events.push(["write", value]); return Promise.resolve(); },
    exit(code) { events.push(["exit", code]); },
  });
  assert.deepEqual(events, [["write", "{\"pass\":true}\n"], ["exit", 0]]);
});

test("one-shot verification preserves failure exit code", async () => {
  const events = [];
  const { finishOneShot } = await import(injectorUrl);
  await finishOneShot({ output: "failure\n", exitCode: 2 }, {
    write(value) { events.push(value); return Promise.resolve(); },
    exit(code) { events.push(code); },
  });
  assert.deepEqual(events, ["failure\n", 2]);
});

test("reentrant CDP close closes the socket and rejects pending commands once", async () => {
  const originalWebSocket = globalThis.WebSocket;
  let session;
  class ReentrantWebSocket {
    constructor() {
      this.listeners = new Map();
      this.closeCalls = 0;
      this.closedBeforeCallback = false;
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    emit(type) {
      for (const listener of this.listeners.get(type) ?? []) listener(new Event(type));
    }

    close() {
      this.closeCalls += 1;
      this.closedBeforeCallback = session.closed;
      if (this.closeCalls === 1) this.emit("error");
    }
  }

  try {
    globalThis.WebSocket = ReentrantWebSocket;
    const { CdpSession } = await import(injectorUrl);
    session = new CdpSession({
      id: "main",
      webSocketDebuggerUrl: "ws://127.0.0.1:9335/devtools/page/main",
    }, 9335);
    session.ws.addEventListener("error", () => session.close());
    let pendingRejections = 0;
    const timeout = setTimeout(() => {}, 60_000);
    timeout.unref();
    session.pending.set(1, {
      timeout,
      reject() { pendingRejections += 1; },
    });

    const firstClose = session.close();
    const secondClose = session.close();
    let closeSettled = false;
    firstClose.then(() => { closeSettled = true; });

    assert.strictEqual(firstClose, secondClose);
    assert.equal(session.ws.closeCalls, 1);
    assert.equal(session.ws.closedBeforeCallback, true);
    assert.equal(pendingRejections, 1);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(closeSettled, false);
    session.ws.emit("close");
    await firstClose;
    assert.equal(closeSettled, true);
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});

test("silent CDP close watchdog keeps one-shot alive until close settles", () => {
  const result = spawnSync(process.execPath, [
    "--input-type=module",
    "--eval",
    `globalThis.WebSocket = class SilentWebSocket {
      addEventListener() {}
      close() {}
    };
    const { CdpSession } = await import(${JSON.stringify(injectorUrl)});
    const session = new CdpSession({
      id: "main",
      webSocketDebuggerUrl: "ws://127.0.0.1:9335/devtools/page/main",
    }, 9335);
    await session.closeAndWait();
    process.stdout.write("CLOSE_SETTLED\\n");`,
  ], {
    encoding: "utf8",
    timeout: 3000,
    windowsHide: true,
  });

  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(result.stdout.trim(), "CLOSE_SETTLED");
  assert.doesNotMatch(result.stderr, /unsettled top-level await/i);
});

test("CDP open drains its socket before rejecting a command timeout", async () => {
  const originalWebSocket = globalThis.WebSocket;
  class PageTimeoutWebSocket {
    constructor() {
      this.listeners = new Map();
      this.closeCalls = 0;
      queueMicrotask(() => this.emit("open", new Event("open")));
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    emit(type, event) {
      for (const listener of this.listeners.get(type) ?? []) listener(event);
    }

    send(value) {
      const message = JSON.parse(value);
      if (message.method === "Runtime.enable") {
        queueMicrotask(() => this.emit("message", {
          data: JSON.stringify({ id: message.id, result: {} }),
        }));
      }
    }

    close() {
      this.closeCalls += 1;
      this.emit("close", new Event("close"));
    }
  }

  try {
    globalThis.WebSocket = PageTimeoutWebSocket;
    const { CdpSession, OperationDeadline } = await import(injectorUrl);
    const session = new CdpSession({
      id: "main",
      webSocketDebuggerUrl: "ws://127.0.0.1:9335/devtools/page/main",
    }, 9335, new OperationDeadline(50));

    await assert.rejects(session.open(), /CDP command timed out: Page\.enable/);
    assert.equal(session.ws.closeCalls, 1);
    assert.equal(session.closed, true);
    assert.ok(session.closePromise);
    let closeSettled = false;
    session.closePromise.then(() => { closeSettled = true; });
    await Promise.resolve();
    assert.equal(closeSettled, true);
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});

test("failed CDP handshake keeps the process alive until its silent socket drains", () => {
  const result = spawnSync(process.execPath, [
    "--input-type=module",
    "--eval",
    `globalThis.WebSocket = class SilentHandshakeWebSocket {
      constructor() {
        this.listeners = new Map();
        this.closeCalls = 0;
        queueMicrotask(() => this.emit("open", new Event("open")));
      }
      addEventListener(type, listener) {
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
      }
      emit(type, event) {
        for (const listener of this.listeners.get(type) ?? []) listener(event);
      }
      send(value) {
        const message = JSON.parse(value);
        if (message.method === "Runtime.enable") {
          queueMicrotask(() => this.emit("message", {
            data: JSON.stringify({ id: message.id, result: {} }),
          }));
        }
      }
      close() { this.closeCalls += 1; }
    };
    const { CdpSession, OperationDeadline } = await import(${JSON.stringify(injectorUrl)});
    const session = new CdpSession({
      id: "main",
      webSocketDebuggerUrl: "ws://127.0.0.1:9335/devtools/page/main",
    }, 9335, new OperationDeadline(50));
    const startedAt = Date.now();
    try {
      await session.open();
    } catch (error) {
      process.stdout.write(JSON.stringify({
        message: error.message,
        closeCalls: session.ws.closeCalls,
        closed: session.closed,
        elapsedMs: Date.now() - startedAt,
      }));
    }`,
  ], {
    encoding: "utf8",
    timeout: 3000,
    windowsHide: true,
  });

  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.doesNotMatch(result.stderr, /unsettled top-level await|UV_HANDLE_CLOSING|Assertion failed/i);
  const payload = JSON.parse(result.stdout);
  assert.match(payload.message, /CDP command timed out: Page\.enable/);
  assert.equal(payload.closeCalls, 1);
  assert.equal(payload.closed, true);
  assert.ok(payload.elapsedMs >= 240, `socket drain settled too early after ${payload.elapsedMs}ms`);
});

test("one-shot waits for CDP close before writing output and setting exit code", async () => {
  const events = [];
  let releaseClose;
  const closePromise = new Promise((resolve) => { releaseClose = resolve; });
  const { finishOneShot } = await import(injectorUrl);
  const resultAfterClose = closePromise.then(() => ({ output: "done\n", exitCode: 0 }));
  const completion = finishOneShot(resultAfterClose, {
    write(value) { events.push(["write", value]); return Promise.resolve(); },
    exit(code) { events.push(["exit", code]); },
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, []);
  releaseClose();
  await completion;
  assert.deepEqual(events, [["write", "done\n"], ["exit", 0]]);
});

test("a hanging canonical renderer preserves its specific WebSocket deadline error", async () => {
  const result = await withHangingMainTarget((port) => runInjector([
    "--verify",
    "--port", String(port),
    "--browser-id", "test-browser",
    "--timeout-ms", "250",
  ]));

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /CDP (?:WebSocket open timed out|operation deadline exceeded)/);
  assert.doesNotMatch(result.stderr, /No page matched the expected Codex shell markers/);
  assert.doesNotMatch(result.stderr, /UV_HANDLE_CLOSING|Assertion failed/);
});

test("startup emits a structured terminal state", async () => {
  const startScript = await fs.readFile(startScriptPath, "utf8");
  assert.match(
    startScript,
    /Write-DreamSkinStartResult\s+-State\s+'active'\s+-Port\s+\$Port/,
  );
  assert.match(
    startScript,
    /Write-DreamSkinStartResult\s+-State\s+'starting'\s+-Port\s+\$Port/,
  );

  const escapedScriptPath = startScriptPath.replaceAll("'", "''");
  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    `$errors = $null; $ast = [System.Management.Automation.Language.Parser]::ParseFile('${escapedScriptPath}', [ref]$null, [ref]$errors); ` +
      `if ($errors.Count) { $errors | ForEach-Object { Write-Error $_ }; exit 1 }; ` +
      `$function = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Write-DreamSkinStartResult' }, $true); ` +
      `if ($null -eq $function) { Write-Error 'structured start result writer is missing'; exit 1 }; ` +
      `Invoke-Expression $function.Extent.Text; ` +
      `Write-DreamSkinStartResult -State 'active' -Port 9335; ` +
      `Write-DreamSkinStartResult -State 'starting' -Port 9335`,
  ], {
    encoding: "utf8",
    windowsHide: true,
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const results = result.stdout
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line));
  assert.deepEqual(results, [
    { mode: "start", state: "active", port: 9335 },
    { mode: "start", state: "starting", port: 9335 },
  ]);
});

test("startup keeps every bounded no-renderer verification pending", async () => {
  const { rendererConnectionFailureDetail } = await import(injectorUrl);
  assert.equal(
    rendererConnectionFailureDetail(null, true),
    "No page matched the expected Codex shell markers",
  );
  assert.equal(
    rendererConnectionFailureDetail(new Error("CDP WebSocket open timed out"), true),
    "CDP WebSocket open timed out",
  );
  assert.notEqual(
    rendererConnectionFailureDetail(null, false),
    "No page matched the expected Codex shell markers",
  );

  const startScript = await fs.readFile(startScriptPath, "utf8");
  assert.match(
    startScript,
    /\$rendererPending\s*=\s*Test-DreamSkinVerificationWaitingForRenderer\s+-VerificationText\s+\$verifyText/,
  );

  const escapedScriptPath = startScriptPath.replaceAll("'", "''");
  const samples = [
    "No verified Codex renderer on 127.0.0.1:9335: No page matched the expected Codex shell markers",
    "No verified Codex renderer on 127.0.0.1:9335: CDP command timed out: Runtime.enable",
    "CDP command timed out: Runtime.evaluate",
    "  CDP command timed out: Runtime.evaluate\r\n",
    "cdp command timed out: runtime.evaluate",
    "CDP COMMAND TIMED OUT: RUNTIME.EVALUATE",
    "CDP command timed out: Runtime.enable",
    "CDP command timed out: Runtime.evaluate: payload invalid",
    "CDP command timed out: Runtime.evaluate\n    at verifyRenderer (injector.mjs:1:1)",
    "CDP command timed out: Runtime.evaluate and browser identity mismatch",
    "WebSocket closed after CDP command timed out: Runtime.evaluate",
    "CDP command timed out: Page.captureScreenshot",
    "Dream Skin verification failed because the theme payload is invalid",
  ];
  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    `$errors = $null; $ast = [System.Management.Automation.Language.Parser]::ParseFile('${escapedScriptPath}', [ref]$null, [ref]$errors); ` +
      `if ($errors.Count) { $errors | ForEach-Object { Write-Error $_ }; exit 1 }; ` +
      `$function = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Test-DreamSkinVerificationWaitingForRenderer' }, $true); ` +
      `if ($null -eq $function) { Write-Error 'renderer pending classifier is missing'; exit 1 }; ` +
      `Invoke-Expression $function.Extent.Text; ` +
      `$samples = $env:DREAM_SKIN_RENDERER_PENDING_SAMPLES | ConvertFrom-Json; ` +
      `@($samples | ForEach-Object { [bool](Test-DreamSkinVerificationWaitingForRenderer -VerificationText $_) }) | ConvertTo-Json -Compress`,
  ], {
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      DREAM_SKIN_RENDERER_PENDING_SAMPLES: JSON.stringify(samples),
    },
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(
    JSON.parse(result.stdout.trim()),
    [
      true, true, true, true,
      false, false, false, false, false, false, false, false, false,
    ],
  );
});

test("structured unskinned renderer stays pending but a mixed target failure does not", async () => {
  const startScript = await fs.readFile(startScriptPath, "utf8");
  const escapedScriptPath = startScriptPath.replaceAll("'", "''");
  const verifierOutput = JSON.stringify({
    mode: "verify",
    port: 9335,
    targets: [{
      targetId: "page-1",
      result: {
        installed: false,
        version: null,
        expectedVersion: "1.7.0",
        pass: false,
      },
    }],
  });
  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    `$errors = $null; $ast = [System.Management.Automation.Language.Parser]::ParseFile('${escapedScriptPath}', [ref]$null, [ref]$errors); ` +
      `if ($errors.Count) { $errors | ForEach-Object { Write-Error $_ }; exit 1 }; ` +
      `$function = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Test-DreamSkinVerificationWaitingForRenderer' }, $true); ` +
      `if ($null -eq $function) { Write-Error 'renderer pending classifier is missing'; exit 1 }; ` +
      `Invoke-Expression $function.Extent.Text; ` +
      `$samples = $env:DREAM_SKIN_STRUCTURED_VERIFY | ConvertFrom-Json; ` +
      `@($samples | ForEach-Object { [bool](Test-DreamSkinVerificationWaitingForRenderer -VerificationText $_) }) | ConvertTo-Json -Compress`,
  ], {
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      DREAM_SKIN_STRUCTURED_VERIFY: JSON.stringify([
        verifierOutput,
        JSON.stringify({
          mode: "verify",
          targets: [
            { result: {
              installed: false,
              version: null,
              expectedVersion: "1.7.0",
              pass: false,
            } },
            { result: {
              installed: true,
              version: "1.7.0",
              expectedVersion: "1.7.0",
              pass: true,
            } },
          ],
        }),
        "{bad-json",
        JSON.stringify({ mode: "inspect", targets: [{ result: {
          installed: false,
          expectedVersion: "1.7.0",
        } }] }),
        JSON.stringify({
          mode: "verify",
          targets: [
            { result: {
              installed: false,
              version: null,
              expectedVersion: "1.7.0",
              pass: false,
            } },
            { result: {
              installed: true,
              version: "1.5.1",
              expectedVersion: "1.7.0",
              pass: false,
            } },
          ],
        }),
      ]),
    },
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(JSON.parse(result.stdout.trim()), [true, true, false, false, false]);
  assert.match(
    startScript,
    /\$rendererPending\s*=\s*\$rendererPending\s*-and\s*\$null\s*-ne\s*\$daemon\s*-and\s*-not\s*\$daemon\.HasExited/,
  );
  assert.match(
    startScript,
    /if\s*\(\$rendererPending\)\s*\{[\s\S]*?verified watcher will inject as soon as the renderer is ready[\s\S]*?\}\s*else\s*\{\s*throw ["']Dream Skin verification failed/,
  );
});

test("retries primary renderers without letting avatar overlay consume their deadline", async () => {
  let now = 0;
  let mainConnections = 0;
  let overlayConnections = 0;
  const { connectCodexTargets, OperationDeadline } = await import(injectorUrl);
  const main = { id: "main", url: "app://-/index.html" };
  const overlay = { id: "overlay", url: "app://-/index.html?initialRoute=%2Favatar-overlay" };
  const deadline = new OperationDeadline(800, () => now);

  const connected = await connectCodexTargets(9335, deadline, "test-browser", {
    async listAppTargets() { return [overlay, main]; },
    async connectTarget(target) {
      if (target.id === "overlay") {
        overlayConnections += 1;
        throw new Error("avatar overlay connection consumed the renderer deadline");
      }
      mainConnections += 1;
      return { target, close() {} };
    },
    async probeSession(session) {
      return {
        codex: session.target.id === "main" && mainConnections >= 2,
        markers: {},
      };
    },
    async sleepWithinDeadline(requestedDelay, activeDeadline) {
      now += activeDeadline.timeoutFor(requestedDelay);
    },
  });

  assert.equal(mainConnections, 2);
  assert.equal(overlayConnections, 0);
  assert.equal(connected[0].target.id, "main");
  assert.equal(deadline.expired(), false);
});

test("tries avatar overlay as a fallback only when no primary target exists", async () => {
  let overlayConnections = 0;
  const { connectCodexTargets, OperationDeadline } = await import(injectorUrl);
  const overlay = { id: "overlay", url: "app://-/index.html?initialRoute=%2Favatar-overlay" };
  const deadline = new OperationDeadline(250);

  const connected = await connectCodexTargets(9335, deadline, "test-browser", {
    async listAppTargets() { return [overlay]; },
    async connectTarget(target) {
      overlayConnections += 1;
      return { target, close() {} };
    },
    async probeSession() { return { codex: true, markers: {} }; },
    async sleepWithinDeadline() {},
  });

  assert.equal(overlayConnections, 1);
  assert.equal(connected[0].target.id, "overlay");
});
