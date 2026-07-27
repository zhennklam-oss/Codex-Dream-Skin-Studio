param(
    [switch]$AllowLifecycle,
    [switch]$AllowRestartPair,
    [string]$OutputPath = 'docs/verification/runtime-lifecycle-reconciliation.json',
    [int]$StudioCdpPort = 9444,
    [string]$StudioExecutable = (Join-Path $env:LOCALAPPDATA 'Codex Dream Skin Studio\Codex Dream Skin Studio.exe'),
    [string]$InstallerPath = 'src-tauri\target\release\bundle\nsis\Codex Dream Skin Studio_0.2.1_x64-setup.exe',
    [int]$LifecycleTimeoutSeconds = 180
)
if (-not $AllowLifecycle) {
    throw 'Refusing real Restore/Start acceptance without -AllowLifecycle.'
}
if (-not $AllowRestartPair) {
    throw 'Refusing paired Codex restart acceptance without -AllowRestartPair.'
}

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$managedRoot = Join-Path $env:LOCALAPPDATA 'CodexDreamSkin'
$managedEngine = Join-Path $managedRoot 'engine'
$managedNode = Join-Path $managedEngine 'runtime\node.exe'
$sourceNode = Join-Path $projectRoot 'src-tauri\resources\dream-skin-engine\runtime\node.exe'
$driverNode = if (Test-Path -LiteralPath $managedNode -PathType Leaf) { $managedNode } else { $sourceNode }
$studioDriver = Join-Path $PSScriptRoot 'cdp-tauri-invoke.mjs'
$pathHelpers = Join-Path $PSScriptRoot 'runtime-lifecycle-path.ps1'
. $pathHelpers
$verifyScript = Join-Path $managedEngine 'scripts\verify-dream-skin.ps1'
$resolvedOutput = if ([System.IO.Path]::IsPathRooted($OutputPath)) {
    [System.IO.Path]::GetFullPath($OutputPath)
} else {
    [System.IO.Path]::GetFullPath((Join-Path $projectRoot $OutputPath))
}
$resolvedInstaller = if ([System.IO.Path]::IsPathRooted($InstallerPath)) {
    [System.IO.Path]::GetFullPath($InstallerPath)
} else {
    [System.IO.Path]::GetFullPath((Join-Path $projectRoot $InstallerPath))
}
$acceptanceStarted = Get-Date
$timeline = [System.Collections.Generic.List[object]]::new()
$evidence = [ordered]@{
    schemaVersion = 1
    checkedAt = $acceptanceStarted.ToUniversalTime().ToString('o')
    success = $false
    gate = 'AllowLifecycle+AllowRestartPair'
    studioCdpPort = $StudioCdpPort
    installer = [ordered]@{
        path = $resolvedInstaller
        installerSha256 = $null
        bytes = $null
    }
    before = $null
    environment = $null
    uiLifecycle = $null
    deepVerifier = $null
    after = $null
    preservation = $null
    elapsedMilliseconds = $null
    error = $null
    errorDetail = $null
    evidenceWriteError = $null
}

function Get-StringSha256 {
    param([AllowNull()][string]$Value)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($(if ($null -eq $Value) { '' } else { $Value }))
        return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '')
    } finally {
        $sha.Dispose()
    }
}

function Get-RegistryValueSnapshot {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)
    $names = @('Path', 'NODE_BINARY', 'NVM_HOME', 'NVM_SYMLINK', 'FNM_DIR',
        'FNM_MULTISHELL_PATH', 'NODE_HOME', 'NODEJS_HOME', 'VOLTA_HOME')
    $item = Get-ItemProperty -LiteralPath $LiteralPath -ErrorAction SilentlyContinue
    $result = [ordered]@{}
    foreach ($name in $names) {
        $value = if ($null -ne $item) { $item.$name } else { $null }
        $result[$name] = [ordered]@{
            present = $null -ne $value
            sha256 = Get-StringSha256 -Value $(if ($null -ne $value) { "$value" } else { $null })
        }
    }
    return $result
}

function Get-NodeLocationSnapshot {
    $candidates = [System.Collections.Generic.List[string]]::new()
    foreach ($candidate in @($managedNode, $sourceNode)) {
        if ($candidate) { $candidates.Add($candidate) }
    }
    foreach ($directory in @($env:PATH -split ';')) {
        if ($directory) { $candidates.Add((Join-Path $directory 'node.exe')) }
    }
    foreach ($name in @('NODE_BINARY', 'NVM_SYMLINK', 'NODE_HOME', 'NODEJS_HOME')) {
        $value = [Environment]::GetEnvironmentVariable($name, 'Process')
        if (-not $value) { continue }
        if ($name -eq 'NODE_BINARY') { $candidates.Add($value) } else { $candidates.Add((Join-Path $value 'node.exe')) }
    }
    foreach ($candidate in @(
        $(if ($env:ProgramFiles) { Join-Path $env:ProgramFiles 'nodejs\node.exe' }),
        $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe' }),
        $(if ($env:USERPROFILE) { Join-Path $env:USERPROFILE '.volta\bin\node.exe' }),
        $(if ($env:USERPROFILE) { Join-Path $env:USERPROFILE 'scoop\apps\nodejs\current\node.exe' })
    )) {
        if ($candidate) { $candidates.Add($candidate) }
    }
    try {
        foreach ($candidate in @(& where.exe node.exe 2>$null)) {
            if ($candidate) { $candidates.Add("$candidate") }
        }
    } catch {}

    $seen = @{}
    $locations = [System.Collections.Generic.List[object]]::new()
    foreach ($candidate in $candidates) {
        try { $fullPath = [System.IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($candidate)) } catch { continue }
        if ($seen.ContainsKey($fullPath)) { continue }
        $seen[$fullPath] = $true
        if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { continue }
        $version = $null
        try { $version = "$(& $fullPath -p 'process.versions.node' 2>$null | Select-Object -First 1)" } catch {}
        $locations.Add([ordered]@{
            path = $fullPath
            version = $version
            sha256 = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash
        })
    }
    return @($locations | Sort-Object path)
}

function Get-EnvironmentSnapshot {
    $processPath = [Environment]::GetEnvironmentVariable('Path', 'Process')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    return [ordered]@{
        PathSnapshot = [ordered]@{
            processSha256 = Get-StringSha256 -Value $processPath
            userSha256 = Get-StringSha256 -Value $userPath
            machineSha256 = Get-StringSha256 -Value $machinePath
        }
        RegistrySnapshot = [ordered]@{
            user = Get-RegistryValueSnapshot -LiteralPath 'Registry::HKEY_CURRENT_USER\Environment'
            machine = Get-RegistryValueSnapshot -LiteralPath 'Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Session Manager\Environment'
        }
        NodeSnapshot = Get-NodeLocationSnapshot
    }
}

function Get-ProcessSnapshot {
    $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
    $StudioPids = @($processes | Where-Object {
        $_.Name -ieq 'Codex Dream Skin Studio.exe' -or "$($_.CommandLine)" -like '*Codex Dream Skin Studio*'
    } | ForEach-Object { [int]$_.ProcessId } | Sort-Object -Unique)
    $CodexPids = @($processes | Where-Object { $_.Name -ieq 'ChatGPT.exe' } |
        ForEach-Object { [int]$_.ProcessId } | Sort-Object -Unique)
    $WatcherPids = @($processes | Where-Object {
        "$($_.CommandLine)" -match '(?i)injector\.mjs' -and "$($_.CommandLine)" -match '(?i)(?:^|\s)--watch(?:\s|$)'
    } | ForEach-Object { [int]$_.ProcessId } | Sort-Object -Unique)
    $VerifierPids = @($processes | Where-Object {
        "$($_.CommandLine)" -match '(?i)injector\.mjs' -and "$($_.CommandLine)" -match '(?i)(?:^|\s)--verify(?:\s|$)'
    } | ForEach-Object { [int]$_.ProcessId } | Sort-Object -Unique)
    $Port9335OwnerPids = @()
    if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
        $Port9335OwnerPids = @(Get-NetTCPConnection -State Listen -LocalPort 9335 -ErrorAction SilentlyContinue |
            ForEach-Object { [int]$_.OwningProcess } | Sort-Object -Unique)
    }
    $VisibleTerminalPids = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
        $_.Id -ne $PID -and $_.MainWindowHandle -ne 0 -and
        $_.ProcessName -in @('powershell', 'pwsh', 'cmd', 'conhost', 'node', 'WindowsTerminal')
    } | ForEach-Object { [int]$_.Id } | Sort-Object -Unique)
    return [ordered]@{
        capturedAt = (Get-Date).ToUniversalTime().ToString('o')
        StudioPids = $StudioPids
        CodexPids = $CodexPids
        WatcherPids = $WatcherPids
        VerifierPids = $VerifierPids
        Port9335OwnerPids = $Port9335OwnerPids
        VisibleTerminalPids = $VisibleTerminalPids
    }
}

function Test-StudioCdpTarget {
    try {
        $targets = @(Invoke-RestMethod -Uri "http://127.0.0.1:$StudioCdpPort/json" -TimeoutSec 2 -MaximumRedirection 0)
        return $null -ne ($targets | Where-Object {
            $_.type -eq 'page' -and "$($_.url)".StartsWith('http://tauri.localhost')
        } | Select-Object -First 1)
    } catch {
        return $false
    }
}

function Wait-StudioCdpTarget {
    param([int]$TimeoutSeconds = 30)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        if (Test-StudioCdpTarget) { return $true }
        Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $deadline)
    return $false
}

function Ensure-StudioCdpTarget {
    if (Test-StudioCdpTarget) { return }
    $running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like '*Codex*Dream*Skin*Studio*' })
    if ($running.Count -gt 0) {
        throw "Studio is running without a WebView2 CDP target on port $StudioCdpPort. Close it normally and rerun this gated acceptance; the script will not terminate it."
    }
    if (-not (Test-Path -LiteralPath $StudioExecutable -PathType Leaf)) {
        throw "Studio CDP target is unavailable and the installed executable was not found: $StudioExecutable"
    }
    $previousArguments = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
    try {
        $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$StudioCdpPort"
        Start-Process -FilePath $StudioExecutable -WorkingDirectory (Split-Path -Parent $StudioExecutable) | Out-Null
    } finally {
        $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previousArguments
    }
    if (-not (Wait-StudioCdpTarget -TimeoutSeconds 30)) {
        throw "Studio did not expose a WebView2 CDP target on port $StudioCdpPort."
    }
}

function ConvertTo-DriverPayload {
    param([Parameter(Mandatory = $true)][string]$Expression)
    $json = @{ expression = $Expression } | ConvertTo-Json -Compress
    return 'base64:' + [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($json))
}

function Invoke-StudioEval {
    param([Parameter(Mandatory = $true)][string]$Expression)
    $payload = ConvertTo-DriverPayload -Expression $Expression
    $output = @(& $driverNode $studioDriver "$StudioCdpPort" '--eval' $payload '--timeout-ms' '30000' 2>&1)
    if ($LASTEXITCODE -ne 0) { throw "Studio CDP evaluation failed: $($output -join [Environment]::NewLine)" }
    return (($output -join [Environment]::NewLine) | ConvertFrom-Json)
}

function Start-StudioLifecycleDriver {
    param(
        [Parameter(Mandatory = $true)][string]$Expression,
        [Parameter(Mandatory = $true)][string]$StdoutPath,
        [Parameter(Mandatory = $true)][string]$StderrPath
    )
    $payload = ConvertTo-DriverPayload -Expression $Expression
    $driverTimeoutMilliseconds = ($LifecycleTimeoutSeconds + 10) * 1000
    $quotedStudioDriver = ConvertTo-WindowsCommandLineArgument -Value $studioDriver
    return Start-Process -FilePath $driverNode -WindowStyle Hidden -PassThru `
        -ArgumentList @($quotedStudioDriver, "$StudioCdpPort", '--eval', $payload, '--timeout-ms', "$driverTimeoutMilliseconds") `
        -RedirectStandardOutput $StdoutPath -RedirectStandardError $StderrPath
}

function Invoke-DeepVerifier {
    param([Parameter(Mandatory = $true)][string]$NodePath)
    if (-not (Test-Path -LiteralPath $verifyScript -PathType Leaf)) {
        throw "Managed deep verifier is missing: $verifyScript"
    }
    $token = [guid]::NewGuid().ToString('N')
    $stdout = Join-Path $env:TEMP "dream-skin-deep-verify-$token.stdout"
    $stderr = Join-Path $env:TEMP "dream-skin-deep-verify-$token.stderr"
    try {
        $arguments = @(
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $verifyScript + '"'),
            '-Port', '9335', '-NodePath', ('"' + $NodePath + '"'), '-TimeoutMilliseconds', '30000'
        )
        $started = Get-Date
        $process = Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -PassThru `
            -ArgumentList $arguments -RedirectStandardOutput $stdout -RedirectStandardError $stderr
        $deadline = (Get-Date).AddSeconds(45)
        while (-not $process.HasExited) {
            $timeline.Add((Get-ProcessSnapshot))
            if ((Get-Date) -ge $deadline) {
                & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null
                throw 'Deep verifier exceeded its 45 second acceptance process budget.'
            }
            Start-Sleep -Milliseconds 100
            $process.Refresh()
        }
        $process.WaitForExit()
        $stdoutText = if (Test-Path -LiteralPath $stdout) { Get-Content -Raw -LiteralPath $stdout } else { '' }
        $stderrText = if (Test-Path -LiteralPath $stderr) { Get-Content -Raw -LiteralPath $stderr } else { '' }
        $parsed = $null
        if ($stdoutText) { $parsed = $stdoutText | ConvertFrom-Json }
        $passed = $false
        if ($null -ne $parsed) {
            $passed = @($parsed.targets | Where-Object { $_.result.pass -eq $true }).Count -gt 0
        }
        $result = [ordered]@{
            exitCode = $process.ExitCode
            elapsedMilliseconds = [int]((Get-Date) - $started).TotalMilliseconds
            pass = $passed
            result = $parsed
            stderr = $stderrText.Trim()
        }
        if ($process.ExitCode -ne 0 -or -not $passed) {
            throw "Deep verifier failed: $($result | ConvertTo-Json -Depth 12 -Compress)"
        }
        return $result
    } finally {
        Remove-Item -LiteralPath $stdout, $stderr -Force -ErrorAction SilentlyContinue
    }
}

function Write-EvidenceAtomically {
    param([Parameter(Mandatory = $true)][object]$Value)
    $directory = Split-Path -Parent $resolvedOutput
    if ($directory) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
    $temporary = Join-Path $directory ('.' + [System.IO.Path]::GetFileName($resolvedOutput) + '.' + [guid]::NewGuid().ToString('N') + '.tmp')
    $json = $Value | ConvertTo-Json -Depth 20
    [System.IO.File]::WriteAllText($temporary, $json + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $resolvedOutput -Force
}

$lifecycleExpression = @'
(async () => {
  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const deadline = Date.now() + __LIFECYCLE_TIMEOUT_MS__;
  const observations = [];
  const domTimeline = [];
  const invoke = (command, args = {}) => window.__TAURI_INTERNALS__.invoke(command, args);
  const dialogIndex = () => document.querySelector('.runtime-dialog__index')?.textContent?.trim() ?? null;
  const dialogBusy = () => document.querySelector('.runtime-dialog[aria-busy="true"]') !== null;
  /* lifecycle-helper:start */
  const failedTransitionMode = (index) => {
    const match = /^(RESTORE|START) \/ FAILED$/.exec(typeof index === 'string' ? index : '');
    return match ? match[1].toLowerCase() : null;
  };
  const createOfficialStabilityGate = ({ requiredStableMs = 4000, codexWasRunning = false }) => {
    let stableSince = null;
    return ({ now, dialogIndex, runtime }) => {
      const official = dialogIndex === null && runtime && !runtime.skinActive && !runtime.starting &&
        (!codexWasRunning || runtime.codexRunning);
      if (!official) {
        stableSince = null;
        return false;
      }
      if (stableSince === null) stableSince = now;
      return now - stableSince >= requiredStableMs;
    };
  };
  const createLifecycleDeadlineGuard = ({ deadline, now = () => Date.now() }) => ({
    expired: () => now() >= deadline,
    assertActive: (label) => {
      if (now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    }
  });
  const createLifecycleWaitFor = ({ deadlineGuard, record, sleep }) =>
    async (predicate, label, requireDialogPrefix = null) => {
      while (!deadlineGuard.expired()) {
        const sample = await record(label);
        deadlineGuard.assertActive(label);
        const { runtime, dialogIndex: index } = sample;
        deadlineGuard.assertActive(label);
        const matched = await predicate(runtime, index);
        deadlineGuard.assertActive(label);
        if (matched) return sample;
        if (requireDialogPrefix && (!index || !index.startsWith(requireDialogPrefix))) {
          throw new Error(`${label}: progress dialog closed before the target state; current dialog=${index}`);
        }
        await sleep(250);
      }
      deadlineGuard.assertActive(label);
      throw new Error(`Timed out waiting for ${label}`);
    };
  const createGuardedLifecycleClick = ({ deadlineGuard, findButton, isButton, captureDom }) =>
    (selector, label) => {
      deadlineGuard.assertActive(label);
      const button = findButton(selector);
      if (!isButton(button) || button.disabled) throw new Error(`${label} is unavailable`);
      deadlineGuard.assertActive(label);
      button.click();
      captureDom(`${label} clicked`);
    };
  const normalizeStudioError = (candidate, source = 'react-fiber') => {
    if (!candidate || typeof candidate !== 'object' ||
        typeof candidate.code !== 'string' || typeof candidate.message !== 'string') return null;
    return {
      code: candidate.code,
      message: candidate.message,
      detail: typeof candidate.detail === 'string' ? candidate.detail : null,
      source
    };
  };
  const reactFiberFor = (element) => {
    if (!element || (typeof element !== 'object' && typeof element !== 'function')) return null;
    const key = Object.keys(element).find((name) => name.startsWith('__reactFiber$'));
    return key ? element[key] : null;
  };
  const errorFromFiberProps = (fiber) => {
    for (const props of [fiber?.memoizedProps, fiber?.pendingProps]) {
      const error = normalizeStudioError(props?.error);
      if (error) return error;
    }
    return null;
  };
  const readStudioErrorFromReactFiber = (element) => {
    const seed = reactFiberFor(element);
    if (!seed) return null;
    let root = seed;
    const ancestry = new Set();
    while (root && !ancestry.has(root)) {
      ancestry.add(root);
      const error = errorFromFiberProps(root);
      if (error) return error;
      if (!root.return) break;
      root = root.return;
    }
    const pending = [root];
    const visited = new Set();
    while (pending.length > 0 && visited.size < 4096) {
      const fiber = pending.pop();
      if (!fiber || visited.has(fiber)) continue;
      visited.add(fiber);
      const error = errorFromFiberProps(fiber);
      if (error) return error;
      if (fiber.sibling) pending.push(fiber.sibling);
      if (fiber.child) pending.push(fiber.child);
    }
    return null;
  };
  const readCurrentStudioError = (documentLike) => {
    const statusStrip = documentLike?.querySelector?.('.runtime-status-strip') ?? null;
    const dialog = documentLike?.querySelector?.('.runtime-dialog') ?? null;
    for (const element of [statusStrip, dialog]) {
      const error = readStudioErrorFromReactFiber(element);
      if (error) return error;
    }
    const text = (element) => element?.textContent?.trim() || null;
    const dialogFailureMode = failedTransitionMode(text(dialog?.querySelector?.('.runtime-dialog__index')));
    const code = text(statusStrip?.querySelector?.('.runtime-status-strip__code')) ||
      (dialogFailureMode ? `${dialogFailureMode.toUpperCase()}_FAILED` : null);
    const message = text(statusStrip?.querySelector?.('p')) ||
      text(dialog?.querySelector?.('[aria-live="polite"]')) || text(statusStrip) || text(dialog);
    return message ? { code: code || 'LIFECYCLE_UI_ERROR', message, detail: null, source: 'dom' } : null;
  };
  const failIfTransitionFailed = ({ phase, currentDom, latestDom, readCurrentError }) => {
    const failedSnapshot = [currentDom, latestDom?.()].find((snapshot) =>
      failedTransitionMode(snapshot?.dialogIndex) !== null
    );
    const failedMode = failedTransitionMode(failedSnapshot?.dialogIndex);
    if (!failedMode) return;
    const errorDetail = readCurrentError() || {
      code: `${failedMode.toUpperCase()}_FAILED`,
      message: `${phase}: ${failedSnapshot.dialogIndex}`,
      detail: null,
      source: 'dialog-index'
    };
    const detailSuffix = errorDetail.detail ? `; detail=${errorDetail.detail}` : '';
    const failure = new Error(`${phase}: ${failedSnapshot.dialogIndex}; ${errorDetail.code}: ${errorDetail.message}${detailSuffix}`);
    failure.errorDetail = errorDetail;
    throw failure;
  };
  const createRuntimeRecorder = ({ captureDom, latestDom, readCurrentError, invokeRuntime, observations, now = () => new Date().toISOString() }) =>
    async (phase) => {
      const dom = captureDom(phase);
      failIfTransitionFailed({ phase, currentDom: dom, latestDom, readCurrentError });
      const runtime = await invokeRuntime();
      failIfTransitionFailed({ phase, currentDom: dom, latestDom, readCurrentError });
      const sample = { at: now(), phase, ...dom, runtime };
      observations.push(sample);
      return sample;
    };
  /* lifecycle-helper:end */
  const captureDom = (phase) => {
    const snapshot = { at: new Date().toISOString(), phase, dialogIndex: dialogIndex(), dialogBusy: dialogBusy() };
    const previous = domTimeline.at(-1);
    if (!previous || previous.dialogIndex !== snapshot.dialogIndex || previous.dialogBusy !== snapshot.dialogBusy || phase !== 'mutation') {
      domTimeline.push(snapshot);
    }
    return snapshot;
  };
  const observer = new MutationObserver(() => captureDom('mutation'));
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  captureDom('observer-installed');
  const record = createRuntimeRecorder({
    captureDom,
    latestDom: () => domTimeline.at(-1),
    readCurrentError: () => readCurrentStudioError(document),
    invokeRuntime: () => invoke('get_runtime_status'),
    observations
  });
  const deadlineGuard = createLifecycleDeadlineGuard({ deadline });
  const guardedRecord = async (label) => {
    deadlineGuard.assertActive(label);
    const sample = await record(label);
    deadlineGuard.assertActive(label);
    return sample;
  };
  const waitFor = createLifecycleWaitFor({ deadlineGuard, record: guardedRecord, sleep });
  const click = createGuardedLifecycleClick({
    deadlineGuard,
    findButton: (selector) => document.querySelector(selector),
    isButton: (button) => button instanceof HTMLButtonElement,
    captureDom
  });
  try {
  const initial = (await guardedRecord('initial')).runtime;

  click('.runtime-bar__actions > button.brutal-button--danger', 'Restore official appearance');
  await waitFor((_runtime, index) => index === 'RESTORE / CONFIRM', 'restore confirmation');
  click('.runtime-dialog .runtime-dialog__actions button.brutal-button--danger:not(:disabled)', 'Restore confirmation action');
  await waitFor((_runtime, index) => index === 'RESTORE / PROGRESS' || domTimeline.some((item) => item.dialogIndex === 'RESTORE / PROGRESS' && item.dialogBusy), 'restore progress');
  const restore = (await waitFor(
    (runtime) => !runtime.skinActive && !runtime.starting && (!initial.codexRunning || runtime.codexRunning),
    'official target',
    'RESTORE / PROGRESS'
  )).runtime;
  await waitFor((_runtime, index) => index === null, 'restore dialog close');
  const officialStabilityGate = createOfficialStabilityGate({ requiredStableMs: 4000, codexWasRunning: initial.codexRunning });
  await waitFor(
    (runtime, index) => officialStabilityGate({ now: Date.now(), dialogIndex: index, runtime }),
    'official stability gate'
  );

  click('.runtime-bar__actions > button.brutal-button:first-child', 'Start skin');
  const startDialog = await waitFor(
    (_runtime, index) => index === 'START / CONFIRM' || index === 'START / PROGRESS' ||
      domTimeline.some((item) => item.dialogIndex === 'START / PROGRESS'),
    'start dialog'
  );
  if (startDialog.dialogIndex === 'START / CONFIRM') {
    click('.runtime-dialog .runtime-dialog__actions button.brutal-button--primary:not(:disabled)', 'Start confirmation action');
  }
  await waitFor((_runtime, index) => index === 'START / PROGRESS' || domTimeline.some((item) => item.dialogIndex === 'START / PROGRESS' && item.dialogBusy), 'start progress');
  const start = (await waitFor((runtime) => runtime.skinActive, 'skin active target', 'START / PROGRESS')).runtime;
  await waitFor((_runtime, index) => index === null, 'start dialog close');
  const final = (await guardedRecord('final')).runtime;
  const bodyText = document.body?.innerText ?? '';
    return {
      success: true,
      initial,
      restore,
      start,
      final,
      observations,
      domTimeline,
      restoreProgressObserved: domTimeline.some((item) => item.dialogIndex === 'RESTORE / PROGRESS' && item.dialogBusy),
      startProgressObserved: domTimeline.some((item) => item.dialogIndex === 'START / PROGRESS' && item.dialogBusy),
      rawVerifierJsonVisible: /["']mode["']\s*:\s*["']verify["']/.test(bodyText),
      timeoutErrorVisible: /PROCESS_TIMEOUT|timed out|timeout/i.test(bodyText),
      errorDetail: null
    };
    } catch (error) {
      captureDom('failure');
      const errorDetail = error?.errorDetail || readCurrentStudioError(document) || {
        code: 'LIVE_ACCEPTANCE_FAILED',
        message: error instanceof Error ? error.message : String(error),
        detail: null,
        source: 'exception'
      };
      const bodyText = document.body?.innerText ?? '';
      return {
        success: false,
        failure: {
          name: error instanceof Error ? error.name : 'Error',
          message: error instanceof Error ? error.message : String(error)
        },
        observations,
        domTimeline,
        restoreProgressObserved: domTimeline.some((item) => item.dialogIndex === 'RESTORE / PROGRESS' && item.dialogBusy),
        startProgressObserved: domTimeline.some((item) => item.dialogIndex === 'START / PROGRESS' && item.dialogBusy),
        rawVerifierJsonVisible: /["']mode["']\s*:\s*["']verify["']/.test(bodyText),
        timeoutErrorVisible: /PROCESS_TIMEOUT|timed out|timeout/i.test(bodyText),
        errorDetail
      };
    } finally {
      observer.disconnect();
    }
})()
'@.Replace('__LIFECYCLE_TIMEOUT_MS__', "$($LifecycleTimeoutSeconds * 1000)")

$failure = $null
try {
    if (-not (Test-Path -LiteralPath $resolvedInstaller -PathType Leaf)) { throw "Fresh NSIS installer is missing: $resolvedInstaller" }
    $installerItem = Get-Item -LiteralPath $resolvedInstaller
    $evidence.installer.installerSha256 = (Get-FileHash -LiteralPath $resolvedInstaller -Algorithm SHA256).Hash
    $evidence.installer.bytes = $installerItem.Length
    if (-not (Test-Path -LiteralPath $driverNode -PathType Leaf)) { throw "Node driver runtime is missing: $driverNode" }
    if (-not (Test-Path -LiteralPath $studioDriver -PathType Leaf)) { throw "Studio CDP driver is missing: $studioDriver" }
    Ensure-StudioCdpTarget

    $beforeProcesses = Get-ProcessSnapshot
    $beforeEnvironment = Get-EnvironmentSnapshot
    $evidence.before = [ordered]@{ processes = $beforeProcesses; environment = $beforeEnvironment }

    $studioContext = Invoke-StudioEval -Expression @'
Promise.all([
  window.__TAURI_INTERNALS__.invoke('get_environment_status'),
  window.__TAURI_INTERNALS__.invoke('get_runtime_status')
]).then(([environment, runtime]) => ({ environment, runtime }))
'@
    $evidence.environment = [ordered]@{
        NodeSource = $studioContext.environment.nodeSource
        NodeVersion = $studioContext.environment.nodeVersion
        NodePath = $studioContext.environment.nodePath
        skinRuntimeReady = $studioContext.environment.skinRuntimeReady
        initialRuntime = $studioContext.runtime
    }
    if ($studioContext.environment.nodeSource -ne 'bundled') { throw "Studio did not select bundled Node: $($studioContext.environment.nodeSource)" }
    if ($studioContext.environment.nodeVersion -ne '24.18.0') { throw "Studio selected unexpected Node version: $($studioContext.environment.nodeVersion)" }
    if (-not $studioContext.environment.nodePath -or
        -not (Test-DreamSkinPathInsideRoot -Path "$($studioContext.environment.nodePath)" -Root $managedEngine)) {
        throw "Studio Node path is not inside the managed engine: $($studioContext.environment.nodePath)"
    }

    $token = [guid]::NewGuid().ToString('N')
    $driverOut = Join-Path $env:TEMP "dream-skin-live-driver-$token.stdout"
    $driverErr = Join-Path $env:TEMP "dream-skin-live-driver-$token.stderr"
    $driver = $null
    $driverStarted = Get-Date
    $evidence.uiLifecycle = [ordered]@{
        elapsedMilliseconds = $null
        result = $null
        processTimeline = @()
    }
    try {
        $driver = Start-StudioLifecycleDriver -Expression $lifecycleExpression -StdoutPath $driverOut -StderrPath $driverErr
        while (-not $driver.HasExited) {
            $timeline.Add((Get-ProcessSnapshot))
            if (((Get-Date) - $driverStarted).TotalSeconds -gt ($LifecycleTimeoutSeconds + 20)) {
                throw 'Studio UI lifecycle driver exceeded its outer process budget.'
            }
            Start-Sleep -Milliseconds 250
            $driver.Refresh()
        }
        $driver.WaitForExit()
        $driverOutput = if (Test-Path -LiteralPath $driverOut) { Get-Content -Raw -LiteralPath $driverOut } else { '' }
        $driverError = if (Test-Path -LiteralPath $driverErr) { Get-Content -Raw -LiteralPath $driverErr } else { '' }
        if ($driver.ExitCode -ne 0) { throw "Studio UI lifecycle driver failed: $driverError`n$driverOutput" }
        $uiLifecycle = $driverOutput | ConvertFrom-Json
        $evidence.uiLifecycle.result = $uiLifecycle
        $evidence.errorDetail = $uiLifecycle.errorDetail
        if ($uiLifecycle.success -eq $false) {
            $errorDetailJson = $uiLifecycle.errorDetail | ConvertTo-Json -Depth 6 -Compress
            throw "Studio UI lifecycle failed: $($uiLifecycle.failure.message); errorDetail=$errorDetailJson"
        }
        if (-not $uiLifecycle.restoreProgressObserved -or -not $uiLifecycle.startProgressObserved) {
            throw 'Studio did not expose both lifecycle progress dialogs.'
        }
        if ($uiLifecycle.rawVerifierJsonVisible -or $uiLifecycle.timeoutErrorVisible) {
            throw 'Studio displayed raw verifier JSON or a false timeout during lifecycle acceptance.'
        }
    } finally {
        if ($null -ne $driver -and -not $driver.HasExited) {
            Stop-Process -Id $driver.Id -Force -ErrorAction SilentlyContinue
        }
        $evidence.uiLifecycle.elapsedMilliseconds = [int]((Get-Date) - $driverStarted).TotalMilliseconds
        $evidence.uiLifecycle.processTimeline = @($timeline)
        Remove-Item -LiteralPath $driverOut, $driverErr -Force -ErrorAction SilentlyContinue
    }

    try {
        $evidence.deepVerifier = Invoke-DeepVerifier -NodePath "$($studioContext.environment.nodePath)"
    } finally {
        $processTimeline = @($timeline)
        if ($null -ne $evidence.uiLifecycle) {
            $evidence.uiLifecycle.processTimeline = $processTimeline
        }
    }
    Start-Sleep -Milliseconds 500
    $afterProcesses = Get-ProcessSnapshot
    $afterEnvironment = Get-EnvironmentSnapshot
    $evidence.after = [ordered]@{ processes = $afterProcesses; environment = $afterEnvironment }

    $environmentUnchanged = (ConvertTo-Json $beforeEnvironment -Depth 12 -Compress) -ceq
        (ConvertTo-Json $afterEnvironment -Depth 12 -Compress)
    $newVisibleTerminalPidsDuringLifecycle = @(@(
        $processTimeline | ForEach-Object { @($_.VisibleTerminalPids) }
        $afterProcesses.VisibleTerminalPids
    ) | Where-Object {
        $_ -notin @($beforeProcesses.VisibleTerminalPids)
    } | Sort-Object -Unique)
    $evidence.preservation = [ordered]@{
        pathRegistryAndNodeUnchanged = $environmentUnchanged
        newVisibleTerminalPidsDuringLifecycle = $newVisibleTerminalPidsDuringLifecycle
        orphanVerifierPids = @($afterProcesses.VerifierPids)
        port9335OwnerPids = @($afterProcesses.Port9335OwnerPids)
    }
    if (-not $environmentUnchanged) { throw 'PATH, Node registry discovery state, or existing Node locations changed.' }
    if ($newVisibleTerminalPidsDuringLifecycle.Count -ne 0) {
        throw "Visible terminal windows were created during lifecycle acceptance: $($newVisibleTerminalPidsDuringLifecycle -join ', ')"
    }
    if (@($afterProcesses.VerifierPids).Count -ne 0) { throw "Orphan verifier processes remain: $($afterProcesses.VerifierPids -join ', ')" }
    if (@($afterProcesses.WatcherPids).Count -eq 0) { throw 'No Dream Skin watcher remains after Start.' }
    if (@($afterProcesses.Port9335OwnerPids).Count -eq 0) { throw 'No verified listener owns loopback port 9335 after Start.' }

    $evidence.success = $true
} catch {
    $failure = $_
    $evidence.error = [ordered]@{
        message = $_.Exception.Message
        category = "$($_.CategoryInfo.Category)"
        fullyQualifiedErrorId = "$($_.FullyQualifiedErrorId)"
    }
    try {
        if ($null -eq $evidence.after) {
            $evidence.after = [ordered]@{ processes = Get-ProcessSnapshot; environment = Get-EnvironmentSnapshot }
        }
    } catch {}
} finally {
    $evidence.elapsedMilliseconds = [int]((Get-Date) - $acceptanceStarted).TotalMilliseconds
    try {
        Write-EvidenceAtomically -Value $evidence
    } catch {
        $evidence.evidenceWriteError = [ordered]@{
            message = $_.Exception.Message
            fullyQualifiedErrorId = "$($_.FullyQualifiedErrorId)"
        }
        if ($null -eq $failure) { $failure = $_ }
    }
}

$evidence | ConvertTo-Json -Depth 20
if ($null -ne $failure) { throw $failure }
