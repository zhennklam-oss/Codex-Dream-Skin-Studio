$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$common = Get-Content -Raw -LiteralPath (Join-Path $root 'src-tauri\resources\dream-skin-engine\scripts\common-windows.ps1')
if ($common -match 'Wait-Process\s+-Id\s+\$processId\s+-Timeout\s+5') { throw 'recorded injector still uses the fixed five-second wait' }
foreach ($required in @('Wait-DreamSkinRecordedInjectorExit', 'AddSeconds\(\$TimeoutSeconds\)', 'Start-Sleep -Milliseconds 250', 'Test-DreamSkinRecordedInjectorIdentity')) {
  if ($common -notmatch $required) { throw "missing condition-based watcher exit contract: $required" }
}
@{ pass = $true; test = 'condition-based-watcher-exit' } | ConvertTo-Json
