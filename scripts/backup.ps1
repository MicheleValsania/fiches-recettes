param(
  [string]$Container = "fiche-postgres",
  [string]$Db = "fiches",
  [string]$User = "postgres",
  [string]$OutDir = "backups",
  [int]$Keep = 14,
  [int]$KeepDays = 7
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

$logPath = Join-Path $OutDir "backup.log"

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

try {
  Write-Log "INFO" "Checking Docker..."
  docker info | Out-Null

  $containerId = docker ps -a --filter "name=^${Container}$" --format "{{.ID}}"
  if (-not $containerId) {
    throw "Container '$Container' not found."
  }

  $isRunning = docker ps --filter "name=^${Container}$" --format "{{.ID}}"
  if (-not $isRunning) {
    Write-Log "INFO" "Starting container '$Container'..."
    docker start $Container | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "Unable to start container '$Container'."
    }
  }

  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $filePath = Join-Path $OutDir "$Db-$timestamp.dump"

  Write-Log "INFO" "Running backup: $filePath"
  docker exec $Container pg_dump -U $User -F c $Db > $filePath
  if ($LASTEXITCODE -ne 0) {
    throw "pg_dump returned exit code $LASTEXITCODE."
  }

  $minDate = (Get-Date).AddDays(-$KeepDays)
  Write-Log "INFO" "Deleting backups older than $KeepDays days (before $($minDate.ToString("yyyy-MM-dd HH:mm:ss")))."
  Get-ChildItem -Path $OutDir -Filter "*.dump" -File |
    Where-Object { $_.LastWriteTime -lt $minDate } |
    Remove-Item -Force

  Write-Log "INFO" "Keeping only the most recent $Keep dump files (safety cap)."
  Get-ChildItem -Path $OutDir -Filter "*.dump" -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip $Keep |
    Remove-Item -Force

  Write-Log "INFO" "Backup completed."
  exit 0
} catch {
  Write-Log "ERROR" $_.Exception.Message
  exit 1
}
