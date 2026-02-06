param(
  [switch]$SkipDocker
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$containerName = "fiche-postgres"
$dbPassword = "postgres"
$dbName = "fiches"
$dbPort = 5432
$image = "postgres:16"

function Write-Info($message) {
  Write-Host $message -ForegroundColor Cyan
}

function Write-Warn($message) {
  Write-Host $message -ForegroundColor Yellow
}

if (-not $SkipDocker) {
  Write-Info "Controllo Docker Desktop..."
  $dockerReady = $true
  try {
    docker info | Out-Null
  } catch {
    $dockerReady = $false
  }

  if (-not $dockerReady) {
    Write-Warn "Docker Desktop non risulta avviato. Aprilo e riprova."
    exit 1
  }

  $containerId = $null
  try {
    $containerId = docker ps -a --filter "name=^${containerName}$" --format "{{.ID}}"
  } catch {
    $containerId = $null
  }

  if (-not $containerId) {
    Write-Info "Creo il container Postgres '${containerName}'..."
    docker run --name $containerName -e "POSTGRES_PASSWORD=$dbPassword" -e "POSTGRES_DB=$dbName" -p "${dbPort}:5432" -d $image | Out-Null
  } else {
    $isRunning = docker ps --filter "name=^${containerName}$" --format "{{.ID}}"
    if (-not $isRunning) {
      Write-Info "Avvio il container Postgres '${containerName}'..."
      docker start $containerName | Out-Null
    } else {
      Write-Info "Container Postgres '${containerName}' già in esecuzione."
    }
  }
} else {
  Write-Info "Skip Docker abilitato: non avvio Postgres."
}

Write-Info "Avvio frontend + backend..."
npm run dev:all
