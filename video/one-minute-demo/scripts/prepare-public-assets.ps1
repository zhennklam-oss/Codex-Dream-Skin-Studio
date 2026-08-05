$ErrorActionPreference = "Stop"

$project = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $project "assets\capture-manifest.json"
$captureSource = Join-Path $project "assets\captures"
$captureTarget = Join-Path $project "public\captures"
$audioSource = Join-Path $project "audio\dream-ambient.wav"
$audioTarget = Join-Path $project "public\audio"

if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw "Capture manifest does not exist: $manifestPath"
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
New-Item -ItemType Directory -Force -Path $captureTarget | Out-Null
foreach ($item in $manifest.items) {
  $source = Join-Path $captureSource $item.file
  if (-not (Test-Path -LiteralPath $source)) {
    throw "Capture listed in the manifest is missing: $source"
  }
  Copy-Item -LiteralPath $source -Destination (Join-Path $captureTarget $item.file) -Force
}

if (Test-Path -LiteralPath $audioSource) {
  New-Item -ItemType Directory -Force -Path $audioTarget | Out-Null
  Copy-Item -LiteralPath $audioSource -Destination (Join-Path $audioTarget "dream-ambient.wav") -Force
}

Write-Output "Prepared $($manifest.items.Count) capture assets."
