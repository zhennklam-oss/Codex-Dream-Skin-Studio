[CmdletBinding()]
param(
  [int]$Port = 9335,
  [string]$ScreenshotPath,
  [string]$NodePath,
  [ValidateRange(250, 120000)]
  [int]$TimeoutMilliseconds = 30000,
  [switch]$SessionOnly
)

$ErrorActionPreference = 'Stop'
$PortExplicit = $PSBoundParameters.ContainsKey('Port')
$injector = Join-Path $PSScriptRoot 'injector.mjs'
. (Join-Path $PSScriptRoot 'common-windows.ps1')

$verifyExitCode = 1
$StatePath = Join-Path $env:LOCALAPPDATA 'CodexDreamSkin\state.json'
$state = Read-DreamSkinState -Path $StatePath
if (-not $PortExplicit -and $null -ne $state -and $state.port) { $Port = [int]$state.port }
Assert-DreamSkinPort -Port $Port
$node = Get-DreamSkinNodeRuntime -PreferredPath $NodePath
$currentCodex = Get-DreamSkinCodexInstall
$codex = $currentCodex
$cdpIdentity = Get-DreamSkinVerifiedCdpIdentity -Port $Port -Codex $codex
if ($null -eq $cdpIdentity -and $null -ne $state) {
  $savedCodex = Get-DreamSkinCodexInstallFromState -State $state
  if ($null -ne $savedCodex -and
    -not (Test-DreamSkinPathEqual -Left $savedCodex.Executable -Right $currentCodex.Executable)) {
    $savedIdentity = Get-DreamSkinVerifiedCdpIdentity -Port $Port -Codex $savedCodex
    if ($null -ne $savedIdentity) {
      $codex = $savedCodex
      $cdpIdentity = $savedIdentity
    }
  }
}
if ($null -eq $cdpIdentity) {
  throw "No verified Codex CDP endpoint is active on loopback port $Port."
}
if ($null -ne $state -and $state.browserId -and "$($state.browserId)" -cne $cdpIdentity.BrowserId) {
  throw 'The active CDP browser does not match the saved Dream Skin session; state was preserved.'
}
if ($null -ne $state -and $state.injectorPid) {
  $injectorProcess = Get-CimInstance Win32_Process `
    -Filter "ProcessId = $([int]$state.injectorPid)" -ErrorAction SilentlyContinue
  if ($null -eq $injectorProcess -or
    -not (Test-DreamSkinRecordedInjectorIdentity -State $state -Process $injectorProcess)) {
    throw 'The recorded Dream Skin watcher is not running or no longer matches the saved process identity.'
  }
}

if ($SessionOnly) {
  $verifyExitCode = 0
} else {
  $arguments = @($injector, '--verify', '--port', "$Port", '--browser-id', $cdpIdentity.BrowserId,
    '--timeout-ms', "$TimeoutMilliseconds")
  if ($ScreenshotPath) { $arguments += @('--screenshot', $ScreenshotPath) }
  & $node.Path @arguments
  $verifyExitCode = $LASTEXITCODE
}
exit $verifyExitCode
