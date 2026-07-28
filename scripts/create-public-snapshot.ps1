[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Destination,
  [string]$RepositoryName = 'Codex-Dream-Skin-Studio'
)

$ErrorActionPreference = 'Stop'
$sourceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$destinationRoot = [System.IO.Path]::GetFullPath($Destination)

if (Test-Path -LiteralPath $destinationRoot) {
  if (-not (Test-Path -LiteralPath $destinationRoot -PathType Container)) {
    throw "Snapshot destination is not a directory: $destinationRoot"
  }
  if (@(Get-ChildItem -LiteralPath $destinationRoot -Force).Count -gt 0) {
    throw "Snapshot destination must be empty: $destinationRoot"
  }
} else {
  New-Item -ItemType Directory -Path $destinationRoot -Force | Out-Null
}

$temporaryArchive = Join-Path ([System.IO.Path]::GetTempPath()) (
  'codex-dream-skin-public-' + [guid]::NewGuid().ToString('N') + '.tar'
)

try {
  $archiveArguments = @(
    'archive', '--format=tar', "--output=$temporaryArchive", 'HEAD', '--', '.',
    ':(exclude)docs/verification/**',
    ':(exclude)docs/superpowers/**',
    ':(exclude)video/**',
    ':(exclude)node_modules/**',
    ':(exclude)src-tauri/target/**'
  )
  & git -C $sourceRoot @archiveArguments
  if ($LASTEXITCODE -ne 0) { throw 'git archive failed.' }

  & tar.exe -xf $temporaryArchive -C $destinationRoot
  if ($LASTEXITCODE -ne 0) { throw 'Could not expand the public snapshot archive.' }
} finally {
  Remove-Item -LiteralPath $temporaryArchive -Force -ErrorAction SilentlyContinue
}

$forbiddenPatterns = @(
  ('C:' + '\' + 'Users' + '\' + 'aqlte'),
  ('D:' + '\' + 'Codex-Dream-Skin-Studio'),
  ('3840' + '-'),
  ('萦萦' + '.jpg')
)

foreach ($file in Get-ChildItem -LiteralPath $destinationRoot -Recurse -File -Force) {
  $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
  if ($bytes -contains 0) { continue }
  $content = [System.Text.Encoding]::UTF8.GetString($bytes)
  foreach ($pattern in $forbiddenPatterns) {
    if ($content.IndexOf($pattern, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
      $relative = $file.FullName.Substring($destinationRoot.TrimEnd('\').Length + 1)
      throw "Public snapshot contains a private path or asset marker in ${relative}: $pattern"
    }
  }
}

& git -C $destinationRoot init --initial-branch=main
if ($LASTEXITCODE -ne 0) { throw 'Could not initialize the public Git repository.' }
& git -C $destinationRoot config user.name $RepositoryName
& git -C $destinationRoot config user.email 'zhennklam-oss@users.noreply.github.com'
& git -C $destinationRoot add --all
& git -C $destinationRoot commit -m 'Initial public release'
if ($LASTEXITCODE -ne 0) { throw 'Could not create the public snapshot commit.' }
