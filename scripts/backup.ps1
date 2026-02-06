param(
  [string]$Container = "fiche-postgres",
  [string]$Db = "fiches",
  [string]$User = "postgres",
  [string]$OutDir = "backups",
  [int]$Keep = 7
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Info($message) {
  Write-Host $message -ForegroundColor Cyan
}

function Write-Warn($message) {
  Write-Host $message -ForegroundColor Yellow
}

Write-Info "Controllo Docker..."
try {
  docker info | Out-Null
} catch {
  Write-Warn "Docker Desktop non è avviato. Aprilo e riprova."
  exit 1
}

$containerId = docker ps -a --filter "name=^${Container}$" --format "{{.ID}}"
if (-not $containerId) {
  Write-Warn "Container '${Container}' non trovato."
  exit 1
}

$isRunning = docker ps --filter "name=^${Container}$" --format "{{.ID}}"
if (-not $isRunning) {
  Write-Info "Avvio il container '${Container}'..."
  docker start $Container | Out-Null
}

if (-not (Test-Path $OutDir)) {
  New-Item -ItemType Directory -Path $OutDir | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$filePath = Join-Path $OutDir "$Db-$timestamp.dump"

Write-Info "Eseguo backup: $filePath"
docker exec $Container pg_dump -U $User -F c $Db > $filePath

Write-Info "Pulizia backup oltre i $Keep più recenti..."
Get-ChildItem -Path $OutDir -Filter "*.dump" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -Skip $Keep |
  Remove-Item -Force

Write-Info "Backup completato."
