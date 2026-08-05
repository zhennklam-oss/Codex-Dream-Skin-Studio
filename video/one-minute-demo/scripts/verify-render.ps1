$ErrorActionPreference = "Stop"

function Resolve-VideoTool {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string[]]$Candidates
  )
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  foreach ($candidate in $Candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
  }
  throw "$Name was not found"
}

$project = Split-Path -Parent $PSScriptRoot
$render = Join-Path $project "renders\codex-dream-skin-demo.mp4"
$review = Join-Path $project "renders\review"
$ffprobe = Resolve-VideoTool -Name "ffprobe" -Candidates @(
  "D:\Codex-Video-Runtimes\ffmpeg-npm\node_modules\@ffprobe-installer\win32-x64\ffprobe.exe",
  "E:\OpenMontage\vendor\ffmpeg\bin\ffprobe.exe"
)
$ffmpeg = Resolve-VideoTool -Name "ffmpeg" -Candidates @(
  "D:\Codex-Video-Runtimes\ffmpeg-npm\node_modules\@ffmpeg-installer\win32-x64\ffmpeg.exe",
  "E:\OpenMontage\vendor\ffmpeg\bin\ffmpeg.exe"
)

if (-not (Test-Path -LiteralPath $render -PathType Leaf)) {
  throw "Render does not exist: $render"
}

$probe = (& $ffprobe -v error -show_streams -show_format -of json $render | Out-String) | ConvertFrom-Json
$video = @($probe.streams | Where-Object codec_type -eq "video")[0]
$audio = @($probe.streams | Where-Object codec_type -eq "audio")[0]
if (-not $video) { throw "The render has no video stream" }
if (-not $audio) { throw "The render has no audio stream" }
if ($video.codec_name -ne "h264") { throw "Expected h264 video, got $($video.codec_name)" }
if ([int]$video.width -ne 1920 -or [int]$video.height -ne 1080) { throw "Expected 1920x1080, got $($video.width)x$($video.height)" }
$rateParts = "$($video.avg_frame_rate)".Split("/")
$frameRate = [double]$rateParts[0] / [double]$rateParts[1]
if ([math]::Abs($frameRate - 30) -ge 0.01) { throw "Expected 30fps, got $frameRate" }
if ($audio.codec_name -ne "aac") { throw "Expected aac audio, got $($audio.codec_name)" }
$duration = [double]$probe.format.duration
if ($duration -lt 59.9 -or $duration -gt 60.1) { throw "Expected duration from 59.9 to 60.1 seconds, got $duration" }

New-Item -ItemType Directory -Force -Path $review | Out-Null
$frames = @(
  @{ Time = "4"; File = "final-04.png" },
  @{ Time = "23"; File = "final-23.png" },
  @{ Time = "49"; File = "final-49.png" },
  @{ Time = "58.5"; File = "final-58_5.png" }
)
foreach ($frame in $frames) {
  $output = Join-Path $review $frame.File
  & $ffmpeg -loglevel error -y -ss $frame.Time -i $render -frames:v 1 $output
  if ($LASTEXITCODE -ne 0) { throw "Failed to extract review frame at $($frame.Time)s" }
}

Write-Output "Render verification passed: h264, aac, 1920x1080, 30fps, $duration seconds"
