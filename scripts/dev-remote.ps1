param(
  [string]$EnvFile = ".env.railway"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Load-EnvFile([string]$Path) {
  if (-not (Test-Path $Path)) {
    return
  }
  Get-Content $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $parts = $line -split "=", 2
    if ($parts.Length -ne 2) { return }
    $name = $parts[0].Trim()
    $value = $parts[1].Trim()
    if ($name) {
      [System.Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
  }
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptRoot "..")
Set-Location $projectRoot

Load-EnvFile (Join-Path $projectRoot $EnvFile)

if (-not $env:VITE_API_BASE) {
  throw "Missing VITE_API_BASE. Set it in $EnvFile or in the environment."
}

Write-Host "Starting Vite with VITE_API_BASE=$env:VITE_API_BASE"
npm run dev
