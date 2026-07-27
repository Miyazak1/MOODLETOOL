param(
  [string]$Course = "ENG3U",
  [Parameter(Mandatory = $true)]
  [string]$Remote,
  [string]$Destination = "",
  [int]$Transfers = 8,
  [int]$Checkers = 16,
  [switch]$DryRun,
  [switch]$Background
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$WorkspaceRoot = Resolve-Path (Join-Path $ProjectRoot "..")
$CourseRoot = Join-Path $WorkspaceRoot "courseware\$Course"
$LogDir = Join-Path $PSScriptRoot "logs"
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$LogPath = Join-Path $LogDir "$Course-rclone-upload-$Timestamp.log"
$FilesFromPath = Join-Path $PSScriptRoot "$Course-rclone-files-from.txt"

function Resolve-Destination {
  if ($Destination.Trim().Length -gt 0) {
    return $Destination
  }
  return "$Remote/$Course"
}

if ($Background) {
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
  $argsList = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $PSCommandPath,
    "-Course", $Course,
    "-Remote", $Remote,
    "-Destination", (Resolve-Destination),
    "-Transfers", "$Transfers",
    "-Checkers", "$Checkers"
  )
  if ($DryRun) {
    $argsList += "-DryRun"
  }

  $process = Start-Process -FilePath "powershell.exe" `
    -ArgumentList $argsList `
    -WorkingDirectory $ProjectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $LogPath `
    -RedirectStandardError $LogPath `
    -PassThru

  Write-Host "Started background upload PID $($process.Id)"
  Write-Host "Log: $LogPath"
  exit 0
}

if (-not (Get-Command rclone -ErrorAction SilentlyContinue)) {
  throw "rclone is not installed or not on PATH. Install rclone and configure a remote first."
}

if (-not (Test-Path -LiteralPath $CourseRoot)) {
  throw "Missing course root: $CourseRoot"
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

Push-Location $ProjectRoot
try {
  & npm.cmd run export:courseware-list
  & node scripts/export-rclone-files-from.mjs --course $Course
}
finally {
  Pop-Location
}

if (-not (Test-Path -LiteralPath $FilesFromPath)) {
  throw "Missing rclone files-from list: $FilesFromPath"
}

$target = Resolve-Destination
$rcloneArgs = @(
  "copy",
  $CourseRoot,
  $target,
  "--files-from", $FilesFromPath,
  "--transfers", "$Transfers",
  "--checkers", "$Checkers",
  "--progress",
  "--log-file", $LogPath,
  "--log-level", "INFO"
)

if ($DryRun) {
  $rcloneArgs += "--dry-run"
}

Write-Host "Course: $Course"
Write-Host "Source: $CourseRoot"
Write-Host "Target: $target"
Write-Host "Files-from: $FilesFromPath"
Write-Host "Log: $LogPath"

& rclone @rcloneArgs
if ($LASTEXITCODE -ne 0) {
  throw "rclone failed with exit code $LASTEXITCODE. See log: $LogPath"
}

Write-Host "Upload command completed."
