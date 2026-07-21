$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$sourceRoot = (Resolve-Path (Join-Path $projectRoot 'src-tauri\resources\dream-skin-engine')).Path
$releaseRoot = (Resolve-Path (Join-Path $projectRoot '.cargo-target-cache-20260721\release')).Path
$bundleRoot = (Resolve-Path (Join-Path $releaseRoot 'resources\dream-skin-engine')).Path
$installer = Get-ChildItem -LiteralPath (Join-Path $releaseRoot 'bundle\nsis') -Filter '*.exe' -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if (-not $installer) {
    throw 'NSIS installer is missing from the release bundle'
}

function Get-RelativeFiles([string]$root) {
    @(Get-ChildItem -Recurse -File -LiteralPath $root |
        ForEach-Object { $_.FullName.Substring($root.Length + 1).Replace('\', '/') } |
        Sort-Object)
}

$sourceFiles = Get-RelativeFiles $sourceRoot
$bundleFiles = Get-RelativeFiles $bundleRoot
$sourceOnly = @($sourceFiles | Where-Object { $_ -notin $bundleFiles })
$bundleOnly = @($bundleFiles | Where-Object { $_ -notin $sourceFiles })

if ($sourceOnly.Count -gt 0 -or $bundleOnly.Count -gt 0) {
    throw "Release engine payload differs from source. Source-only: $($sourceOnly -join ', '); bundle-only: $($bundleOnly -join ', ')"
}

$hashMismatches = [System.Collections.Generic.List[string]]::new()
foreach ($relative in $sourceFiles) {
    $sourcePath = Join-Path $sourceRoot $relative
    $bundlePath = Join-Path $bundleRoot $relative
    $sourceHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash
    $bundleHash = (Get-FileHash -LiteralPath $bundlePath -Algorithm SHA256).Hash
    if ($sourceHash -ne $bundleHash) {
        $hashMismatches.Add($relative)
    }
}
if ($hashMismatches.Count -gt 0) {
    throw "Release engine payload hash mismatch: $($hashMismatches -join ', ')"
}

$themePath = Join-Path $bundleRoot 'assets\theme.json'
$theme = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($themePath)) |
    ConvertFrom-Json
$effectNames = @($theme.effects.PSObject.Properties.Name)
$removedOpacityFields = @(
    'sidebarOpacity',
    'composerOpacity'
)
$requiredRegionFields = @('leftSidebarOpacity', 'topBarOpacity', 'rightSidebarOpacity', 'bottomBarOpacity')

if ($theme.schemaVersion -ne 4) { throw 'Bundled default theme is not schema 4' }
if ($effectNames -notcontains 'interfaceOpacity') { throw 'Bundled default theme is missing interfaceOpacity' }
foreach ($field in $requiredRegionFields) {
    if ($effectNames -notcontains $field) { throw "Bundled default theme is missing region field: $field" }
}
foreach ($field in $removedOpacityFields) {
    if ($effectNames -contains $field) { throw "Bundled default theme retained removed field: $field" }
}

$renderer = [System.Text.Encoding]::UTF8.GetString(
    [System.IO.File]::ReadAllBytes((Join-Path $bundleRoot 'assets\renderer-inject.js'))
)
if ($renderer -notmatch 'version\s*:\s*[''"]1\.6\.0[''"]') {
    throw 'Bundled renderer is not engine version 1.6.0'
}

$forbiddenNames = @('codex-region-contract.json', 'region-contract.js', 'region-contract.test.mjs')
foreach ($name in $forbiddenNames) {
    if ($bundleFiles | Where-Object { $_.EndsWith($name, [System.StringComparison]::OrdinalIgnoreCase) }) {
        throw "Release engine payload retained removed region asset: $name"
    }
}

[ordered]@{
    installer = $installer.FullName
    installerSha256 = (Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256).Hash
    engineVersion = '1.6.0'
    themeSchema = $theme.schemaVersion
    interfaceOpacity = $theme.effects.interfaceOpacity
    regionOpacity = [ordered]@{
        left = $theme.effects.leftSidebarOpacity
        top = $theme.effects.topBarOpacity
        right = $theme.effects.rightSidebarOpacity
        bottom = $theme.effects.bottomBarOpacity
    }
    sourceFileCount = $sourceFiles.Count
    bundleFileCount = $bundleFiles.Count
    exactFileSet = $true
    allHashesMatch = $true
    removedRegionAssets = $false
} | ConvertTo-Json
