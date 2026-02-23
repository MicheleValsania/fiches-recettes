param(
  [Parameter(Mandatory = $true)]
  [string]$Path,
  [string]$ApiBase = "http://localhost:3001/api",
  [switch]$AllowSuspectText
)

$ErrorActionPreference = "Stop"

function Read-Utf8Strict([string]$filePath) {
  $bytes = [System.IO.File]::ReadAllBytes($filePath)
  $utf8 = New-Object System.Text.UTF8Encoding($false, $true)
  return $utf8.GetString($bytes)
}

function Find-SuspectText([string]$text) {
  if ([string]::IsNullOrEmpty($text)) { return $false }
  if ($text.Contains([char]0xFFFD)) { return $true }
  if ($text.Contains([char]0x00C3)) { return $true } # C3 marker
  if ($text.Contains([char]0x00C2)) { return $true } # C2 marker
  return $false
}

function Normalize-Unit([string]$unit) {
  if ([string]::IsNullOrWhiteSpace($unit)) { return $null }
  $u = $unit.Trim().ToLowerInvariant()
  switch ($u) {
    "kg" { return "kg" }
    "g" { return "g" }
    "l" { return "l" }
    "ml" { return "ml" }
    "cl" { return "cl" }
    "pc" { return "pc" }
    default { return $null }
  }
}

function Guess-UnitFromQty([string]$qty) {
  if ([string]::IsNullOrWhiteSpace($qty)) { return $null }
  $q = $qty.ToLowerInvariant()
  if ($q -match "\bkg\b") { return "kg" }
  if ($q -match "\bg\b") { return "g" }
  if ($q -match "\bml\b") { return "ml" }
  if ($q -match "\bcl\b") { return "cl" }
  if ($q -match "\bl\b") { return "l" }
  if ($q -match "\b(pc|pcs|piece|pieces)\b") { return "pc" }
  return $null
}

function To-Array($value) {
  if ($null -eq $value) { return @() }
  if ($value -is [System.Array]) { return @($value) }
  return @($value)
}

function Convert-ExportToFiche($item) {
  $now = (Get-Date).ToUniversalTime().ToString("o")

  $ingredients = @()
  foreach ($ing in (To-Array $item.ingredients)) {
    $qty = if ($ing.quantity_raw) { [string]$ing.quantity_raw } else { "" }
    $unit = Normalize-Unit $ing.unit_price_unit
    if (-not $unit) { $unit = Guess-UnitFromQty $qty }

    $ingredients += [pscustomobject]@{
      name = if ($ing.ingredient_name_raw) { [string]$ing.ingredient_name_raw } else { "" }
      qty = $qty
      note = if ($ing.note) { [string]$ing.note } else { "" }
      supplier = if ($ing.supplier_name) { [string]$ing.supplier_name } else { "" }
      supplierId = if ($ing.supplier_id) { [string]$ing.supplier_id } else { "" }
      supplierProductId = if ($ing.supplier_product_id) { [string]$ing.supplier_product_id } else { "" }
      unitPrice = if ($null -ne $ing.unit_price_value) { [double]$ing.unit_price_value } else { $null }
      unitPriceUnit = $unit
    }
  }

  $storageProfiles = @()
  foreach ($sp in (To-Array $item.storage_profiles)) {
    $storageProfiles += [pscustomobject]@{
      id = if ($sp.id) { [string]$sp.id } else { [guid]::NewGuid().ToString() }
      mode = if ($sp.mode) { [string]$sp.mode } else { "" }
      dlcType = if ($sp.dlc_type) { [string]$sp.dlc_type } else { "" }
      shelfLifeValue = if ($null -ne $sp.shelf_life.value) { [string]$sp.shelf_life.value } else { "" }
      shelfLifeUnit = if ($sp.shelf_life.unit) { [string]$sp.shelf_life.unit } else { "" }
      tempMinC = if ($null -ne $sp.temp_range_c.min) { [string]$sp.temp_range_c.min } else { "" }
      tempMaxC = if ($null -ne $sp.temp_range_c.max) { [string]$sp.temp_range_c.max } else { "" }
      startPoint = if ($sp.start_point) { [string]$sp.start_point } else { "" }
      allowedTransformations = To-Array $sp.allowed_transformations
      source = if ($sp.source) { [string]$sp.source } else { "imported" }
      notes = if ($sp.notes) { [string]$sp.notes } else { "" }
    }
  }

  $labelHints = $null
  if ($item.label_hints) {
    $labelHints = [pscustomobject]@{
      labelType = if ($item.label_hints.label_type) { [string]$item.label_hints.label_type } else { "" }
      displayName = if ($item.label_hints.display_name) { [string]$item.label_hints.display_name } else { "" }
      legalName = ""
      allergenDisplayMode = if ($item.label_hints.allergen_display.mode) { [string]$item.label_hints.allergen_display.mode } else { "" }
      allergenManualText = if ($item.label_hints.allergen_display.manual_text) { [string]$item.label_hints.allergen_display.manual_text } else { "" }
      productionLabel = if ($item.label_hints.date_fields.production_label) { [string]$item.label_hints.date_fields.production_label } else { "" }
      dlcLabel = if ($item.label_hints.date_fields.dlc_label) { [string]$item.label_hints.date_fields.dlc_label } else { "" }
      showInternalLot = [bool]$item.label_hints.lot_fields.show_internal_lot
      showSupplierLot = [bool]$item.label_hints.lot_fields.show_supplier_lot
      showTempRange = [bool]$item.label_hints.storage_display.show_temp_range
      defaultStorageProfileId = if ($item.label_hints.storage_display.default_storage_profile_id) { [string]$item.label_hints.storage_display.default_storage_profile_id } else { "" }
      qrTarget = if ($item.label_hints.qr_target) { [string]$item.label_hints.qr_target } else { "" }
      templateHint = if ($item.label_hints.template_hint) { [string]$item.label_hints.template_hint } else { "" }
    }
  }

  return [pscustomobject]@{
    id = if ($item.fiche_id) { [string]$item.fiche_id } elseif ($item.id) { [string]$item.id } else { [guid]::NewGuid().ToString() }
    title = if ($item.title) { [string]$item.title } else { "Untitled" }
    category = if ($item.category) { [string]$item.category } else { "" }
    portions = 1
    allergens = To-Array $item.allergens
    equipment = @()
    ingredients = $ingredients
    steps = To-Array $item.procedure_steps
    haccpProfiles = @()
    storageProfiles = $storageProfiles
    labelHints = $labelHints
    notes = ""
    createdAt = if ($item.updated_at) { [string]$item.updated_at } else { $now }
    updatedAt = if ($item.updated_at) { [string]$item.updated_at } else { $now }
  }
}

if (-not (Test-Path $Path)) {
  throw "File not found: $Path"
}

$raw = Read-Utf8Strict $Path
if ((-not $AllowSuspectText) -and (Find-SuspectText $raw)) {
  throw "Suspect encoding detected in source JSON. Aborting import. Use -AllowSuspectText only if intentional."
}

$parsed = $raw | ConvertFrom-Json
$items = @()
if ($parsed.fiches) {
  $items = To-Array $parsed.fiches
} elseif ($parsed -is [System.Array]) {
  $items = @($parsed)
} else {
  $items = @($parsed)
}

$ok = 0
$errors = @()
foreach ($item in $items) {
  try {
    $fiche = Convert-ExportToFiche $item
    $body = $fiche | ConvertTo-Json -Depth 100
    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    Invoke-RestMethod -Method Post -Uri "$ApiBase/fiches" -ContentType "application/json; charset=utf-8" -Body $bodyBytes | Out-Null
    $ok++
  } catch {
    $errors += [pscustomobject]@{
      id = if ($item.fiche_id) { [string]$item.fiche_id } elseif ($item.id) { [string]$item.id } else { "" }
      title = if ($item.title) { [string]$item.title } else { "" }
      error = $_.Exception.Message
    }
  }
}

Write-Output ("IMPORT_OK=" + $ok)
Write-Output ("IMPORT_ERRORS=" + $errors.Count)
if ($errors.Count -gt 0) {
  $errors | Format-Table -AutoSize | Out-String | Write-Output
}
