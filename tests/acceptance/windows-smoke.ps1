param(
    [Parameter(Mandatory = $true)]
    [string]$InstallRoot,
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$resolvedRoot = [System.IO.Path]::GetFullPath($InstallRoot)
$desktop = [Environment]::GetFolderPath('Desktop')
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Codex Dream Skin Studio'
$uninstall = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
    Where-Object DisplayName -eq 'Codex Dream Skin Studio' |
    Select-Object -First 1

$checks = [ordered]@{
    appExecutable = Test-Path -LiteralPath (Join-Path $resolvedRoot 'Codex Dream Skin Studio.exe')
    bundledEngine = Test-Path -LiteralPath (Join-Path $resolvedRoot 'resources\dream-skin-engine\scripts\injector.mjs')
    engineManifest = Test-Path -LiteralPath (Join-Path $resolvedRoot 'resources\dream-skin-engine\ENGINE-SOURCE.json')
    desktopShortcut = Test-Path -LiteralPath (Join-Path $desktop 'Codex Dream Skin Studio.lnk')
    startMenuShortcut = Test-Path -LiteralPath (Join-Path $startMenu 'Codex Dream Skin Studio.lnk')
    uninstallEntry = $null -ne $uninstall
    managedEngine = Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'CodexDreamSkin\engine\scripts\injector.mjs')
    retainedThemes = Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'CodexDreamSkin\themes')
    removedRegionAssets = -not @(
        'resources\dream-skin-engine\assets\codex-region-contract.json',
        'resources\dream-skin-engine\assets\region-contract.js',
        'resources\dream-skin-engine\tests\region-contract.test.mjs'
    ).Where({ Test-Path -LiteralPath (Join-Path $resolvedRoot $_) }, 'First')
}

$result = [ordered]@{
    checkedAt = (Get-Date).ToString('o')
    installRoot = $resolvedRoot
    checks = $checks
    passed = -not ($checks.Values -contains $false)
}
$json = $result | ConvertTo-Json -Depth 4
if ($OutputPath) {
    $parent = Split-Path -Parent $OutputPath
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    Set-Content -LiteralPath $OutputPath -Value $json -Encoding utf8
}
$json
if (-not $result.passed) { exit 1 }
