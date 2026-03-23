param(
  [string]$OutDir = "backups",
  [int]$Keep = 14,
  [int]$KeepDays = 7,
  [string]$EnvFile = ".env.railway"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptRoot "..")

if (-not [System.IO.Path]::IsPathRooted($OutDir)) {
  $OutDir = Join-Path $projectRoot $OutDir
}

if (-not (Test-Path $OutDir)) {
  New-Item -ItemType Directory -Path $OutDir | Out-Null
}

$logPath = Join-Path $OutDir "backup-railway.log"

function Write-Log([string]$Level, [string]$Message) {
  $line = "[{0}] [{1}] {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Level, $Message
  Add-Content -Path $logPath -Value $line
  if ($Level -eq "ERROR") {
    Write-Host $line -ForegroundColor Red
    return
  }
  if ($Level -eq "WARN") {
    Write-Host $line -ForegroundColor Yellow
    return
  }
  Write-Host $line -ForegroundColor Cyan
}

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

try {
  Load-EnvFile (Join-Path $projectRoot $EnvFile)

  $pgHost = $env:PGHOST
  $port = $env:PGPORT
  $user = $env:PGUSER
  $password = $env:PGPASSWORD
  $db = $env:PGDATABASE

  if (-not $pgHost -or -not $port -or -not $user -or -not $password -or -not $db) {
    throw "Missing PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE. Set them in $EnvFile or environment."
  }

  Write-Log "INFO" "Checking Docker..."
  docker info | Out-Null

  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $filePath = Join-Path $OutDir "railway-$timestamp.dump"

  Write-Log "INFO" "Running backup: $filePath"
  $env:PGPASSWORD = $password
  docker run --rm -e PGPASSWORD=$env:PGPASSWORD -v "${OutDir}:/backup" postgres:18 `
    pg_dump -Fc -h $pgHost -p $port -U $user -d $db -f "/backup/railway-$timestamp.dump"

  if ($LASTEXITCODE -ne 0) {
    throw "pg_dump returned exit code $LASTEXITCODE."
  }

  $minDate = (Get-Date).AddDays(-$KeepDays)
  Write-Log "INFO" "Deleting backups older than $KeepDays days (before $($minDate.ToString("yyyy-MM-dd HH:mm:ss")))."
  Get-ChildItem -Path $OutDir -Filter "railway-*.dump" -File |
    Where-Object { $_.LastWriteTime -lt $minDate } |
    Remove-Item -Force

  Write-Log "INFO" "Keeping only the most recent $Keep dump files (safety cap)."
  Get-ChildItem -Path $OutDir -Filter "railway-*.dump" -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip $Keep |
    Remove-Item -Force

  Write-Log "INFO" "Backup completed."
  exit 0
} catch {
  Write-Log "ERROR" $_.Exception.Message
  exit 1
}
