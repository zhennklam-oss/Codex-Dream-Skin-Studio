$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$configPath = Join-Path $projectRoot 'src-tauri\tauri.conf.json'
$config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json

$failures = [System.Collections.Generic.List[string]]::new()
if ($config.productName -ne 'Codex Dream Skin Studio') { $failures.Add('productName') }
if ($config.mainBinaryName -ne 'Codex Dream Skin Studio') { $failures.Add('main binary name') }
if ($config.bundle.targets -notcontains 'nsis') { $failures.Add('NSIS target') }
if ($config.bundle.publisher -ne 'AQLTeen') { $failures.Add('publisher') }
if ($config.bundle.icon -notcontains 'icons/icon.ico') { $failures.Add('icon') }
if ($config.bundle.resources -notcontains 'resources/dream-skin-engine') { $failures.Add('engine resource') }
$hookRelative = $config.bundle.windows.nsis.installerHooks
$hookPath = if ($hookRelative) { Join-Path (Split-Path -Parent $configPath) $hookRelative } else { $null }
if (-not $hookPath -or -not (Test-Path -LiteralPath $hookPath -PathType Leaf)) {
    $failures.Add('installer hooks')
} elseif ((Get-Content -Raw -LiteralPath $hookPath) -notmatch 'CreateShortCut\s+"\$DESKTOP\\Codex Dream Skin Studio\.lnk"') {
    $failures.Add('desktop shortcut hook')
}
if ($config.bundle.windows.nsis.startMenuFolder -ne 'Codex Dream Skin Studio') { $failures.Add('start menu folder') }
if ($config.bundle.windows.nsis.installMode -ne 'currentUser') { $failures.Add('current-user install mode') }
if ($config.app.windows[0].decorations -ne $false) { $failures.Add('frameless window') }
if ($config.app.windows[0].resizable -ne $true) { $failures.Add('resizable window') }

$capabilityPath = Join-Path $projectRoot 'src-tauri\capabilities\default.json'
$capability = Get-Content -Raw -LiteralPath $capabilityPath | ConvertFrom-Json
$requiredWindowPermissions = @(
    'core:window:allow-close',
    'core:window:allow-minimize',
    'core:window:allow-start-dragging',
    'core:window:allow-toggle-maximize',
    'core:window:allow-is-maximized'
)
if (@($capability.windows) -notcontains 'main') { $failures.Add('main window capability scope') }
$actualWindowPermissions = @($capability.permissions | Where-Object { $_ -like 'core:window:*' })
foreach ($permission in $requiredWindowPermissions) {
    if ($actualWindowPermissions -notcontains $permission) {
        $failures.Add("window permission $permission")
    }
}
foreach ($permission in $actualWindowPermissions) {
    if ($requiredWindowPermissions -notcontains $permission) {
        $failures.Add("unexpected window permission $permission")
    }
}

if ($failures.Count -gt 0) {
    throw "Packaging configuration is missing: $($failures -join ', ')"
}

[ordered]@{
    productName = $config.productName
    publisher = $config.bundle.publisher
    target = 'nsis'
    desktopShortcut = 'installer hook'
    startMenuFolder = $config.bundle.windows.nsis.startMenuFolder
    installMode = $config.bundle.windows.nsis.installMode
    decorations = $config.app.windows[0].decorations
    resizable = $config.app.windows[0].resizable
    windowPermissions = $actualWindowPermissions
} | ConvertTo-Json
