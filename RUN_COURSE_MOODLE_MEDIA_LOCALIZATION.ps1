param(
  [string]$Course = "",
  [string]$Kind = ""
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

if (-not $Course) {
  $Course = Read-Host "Course code"
}
$Course = $Course.Trim().ToUpperInvariant()
if (-not $Course) {
  throw "Course code is required."
}

$rawFiles = Get-ChildItem -LiteralPath "inbox" -Filter "moodle-book-raw-$Course-U*.json" |
  Sort-Object Name |
  ForEach-Object { $_.FullName }

if (-not $rawFiles -or $rawFiles.Count -eq 0) {
  throw "No raw Moodle book files found for $Course. Expected inbox\moodle-book-raw-$Course-U*.json"
}

Write-Host ""
Write-Host "Course: $Course"
Write-Host "Raw book files: $($rawFiles.Count)"
Write-Host ""
Write-Host "This uses your Moodle username/password only for this run."
Write-Host "The password is not written to .env or any project file."
Write-Host ""

$env:MOODLE_USERNAME = Read-Host "Moodle username"
$securePassword = Read-Host "Moodle password" -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)

try {
  $env:MOODLE_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  $downloadExitCodes = @()

  npm.cmd run export:moodle-media-localization-queue
  npm.cmd run export:moodle-ispring-embed-queue -- --course $Course
  if ($Kind) {
    $kinds = $Kind.Split(",") | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ }
    foreach ($oneKind in $kinds) {
      node scripts\download-moodle-media-localization-queue.mjs --course $Course --kind $oneKind --force --apply-html --apply-manifest
      $downloadExitCodes += [pscustomobject]@{ Kind = $oneKind; ExitCode = $LASTEXITCODE }
    }
  }
  else {
    node scripts\download-moodle-media-localization-queue.mjs --course $Course --apply-html --apply-manifest
    $downloadExitCodes += [pscustomobject]@{ Kind = "all"; ExitCode = $LASTEXITCODE }
  }
  npm.cmd run generate:lightweight-docx-previews -- --course $Course
  & python tools\import_moodle_book_raw.py --course $Course @rawFiles
  npm.cmd run audit:online-resources
  npm.cmd run validate:manifest
  npm.cmd run build

  $failedDownloads = $downloadExitCodes | Where-Object { $_.ExitCode -ne 0 }
  if ($failedDownloads) {
    Write-Host ""
    Write-Host "Some Moodle resources failed to download. Check deployment\moodle-media-download-report-$Course-*.json for 404 or access details."
    $failedDownloads | Format-Table -AutoSize
  }
}
finally {
  if ($passwordPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  }
  Remove-Item Env:\MOODLE_PASSWORD -ErrorAction SilentlyContinue
}
