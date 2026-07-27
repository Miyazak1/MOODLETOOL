param(
  [string]$Course = ""
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

function Import-DotEnv {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }
  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) {
      return
    }
    $index = $line.IndexOf("=")
    if ($index -le 0) {
      return
    }
    $name = $line.Substring(0, $index).Trim()
    $value = $line.Substring($index + 1).Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    if (-not [Environment]::GetEnvironmentVariable($name, "Process")) {
      [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
  }
}

Import-DotEnv -Path (Join-Path $PSScriptRoot ".env")

if (-not $Course) {
  $Course = Read-Host "Course code"
}
$Course = $Course.Trim().ToUpperInvariant()
if (-not $Course) {
  throw "Course code is required."
}

Write-Host ""
Write-Host "Course: $Course"
Write-Host "This localizes Moodle activities listed in the course manifest."
Write-Host "It reads MOODLE_USERNAME/MOODLE_PASSWORD from .env when available."
Write-Host ""

$passwordPointer = [IntPtr]::Zero
$passwordWasPrompted = $false

if (-not $env:MOODLE_USERNAME) {
  $env:MOODLE_USERNAME = Read-Host "Moodle username"
}
if (-not $env:MOODLE_PASSWORD) {
  $securePassword = Read-Host "Moodle password" -AsSecureString
  $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  $env:MOODLE_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  $passwordWasPrompted = $true
}

try {
  node scripts\localize-moodle-activity-resources.mjs --course $Course --force
  npm.cmd run generate:lightweight-docx-previews -- --course $Course
  npm.cmd run audit:online-resources
  npm.cmd run validate:manifest
  npm.cmd run build
}
finally {
  if ($passwordPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  }
  if ($passwordWasPrompted) {
    Remove-Item Env:\MOODLE_PASSWORD -ErrorAction SilentlyContinue
  }
}
