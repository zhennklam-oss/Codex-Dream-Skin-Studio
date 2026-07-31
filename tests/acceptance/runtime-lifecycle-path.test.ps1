$ErrorActionPreference = 'Stop'

$helper = Join-Path $PSScriptRoot 'runtime-lifecycle-path.ps1'
if (-not (Test-Path -LiteralPath $helper -PathType Leaf)) {
    throw "Runtime lifecycle path helper is missing: $helper"
}
. $helper

$managedRoot = 'C:\Users\test\AppData\Local\CodexDreamSkin\engine'
$extendedNode = '\\?\C:\Users\test\AppData\Local\CodexDreamSkin\engine\runtime\node.exe'
$externalNode = '\\?\D:\nodejs\node.exe'

if (-not (Test-DreamSkinPathInsideRoot -Path $extendedNode -Root $managedRoot)) {
    throw 'An extended-length managed Node path was rejected.'
}
if (Test-DreamSkinPathInsideRoot -Path $externalNode -Root $managedRoot) {
    throw 'An external Node path was accepted as managed.'
}

Write-Output 'RUNTIME_LIFECYCLE_PATH_TEST=PASS'
