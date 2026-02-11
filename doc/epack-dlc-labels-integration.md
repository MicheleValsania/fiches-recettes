# ePack Pro Integration (DLC Labels) — Design Notes

> Stack: React + Node.js + PostgreSQL (Docker)  
> Scope: **Generate DLC labels** from internal *fiches techniques* data and (optionally) push the minimum dataset to **ePack Pro** via **API or import**.  
> Non-goals: Food cost, supplier price lists, inventory valuation.

---

## 1. Goal & Philosophy

**Primary goal:** eliminate double-entry by using this app as the **source of truth** for:
- recipes / fiches techniques
- allergens
- default storage mode
- default shelf life (DLC)

…and have ePack Pro handle **HACCP / labeling / traceability** if needed.

> Design principle: **Our app remains authoritative**; ePack is a downstream consumer for labeling/compliance.

---

## 2. Minimum Data Needed for DLC Labels

For label printing, the absolute minimum is:

### 2.1 Product / Preparation master data
- `product_code` (string, unique; can be UUID or human code)
- `product_name` (string)
- `storage_mode` (enum: `CHILLED`, `FROZEN`, `AMBIENT`, `HOT_HOLD`)
- `default_dlc_hours` (int)
- `allergens` (array of EU-14 allergen codes + optional free text)

### 2.2 Production batch (what is produced today)
- `product_code`
- `produced_at` (timestamp with timezone)
- `use_by_at` (timestamp with timezone) — computed
- `lot_code` (string; e.g. `YYYYMMDD-SEQ`)
- `quantity` + `unit` (optional but recommended)
- `operator` (optional: initials / user id)

These fields cover **~99%** of “DLC label” needs even without full traceability.

---

## 3. Data Model (Proposed)

### 3.1 Tables

#### `fiches`
Stores the recipe / fiche technique (existing).
- `id` UUID PK
- `name` text
- `sector` text / enum (entrée, pâtes, etc.)
- `allergens` jsonb (EU-14 codes + labels)
- `storage_mode` enum
- `default_dlc_hours` int
- `updated_at` timestamptz

#### `productions`
Represents a real production run that creates labels.
- `id` UUID PK
- `fiche_id` UUID FK -> `fiches(id)`
- `produced_at` timestamptz (default now)
- `use_by_at` timestamptz (computed)
- `lot_code` text (unique per day recommended)
- `quantity` numeric (optional)
- `unit` text (optional)
- `created_by` UUID / text (optional)
- `created_at` timestamptz

> Note: If you later add traceability, you can extend `productions` with ingredient lots.

---

## 4. DLC Calculation Rules

### 4.1 Basic rule
`use_by_at = produced_at + default_dlc_hours`

### 4.2 Overrides (future)
Allow per-production overrides:
- `dlc_hours_override` (int nullable)
- `storage_mode_override` (nullable)

### 4.3 Timezone
Store all timestamps in PostgreSQL as `timestamptz`.  
Render in UI using local timezone (camp / restaurant timezone).

---

## 5. Label Generation (Inside Our App)

Even if ePack integration is unavailable, we can fully print labels ourselves.

### 5.1 Label template content (recommended)
- Product name
- Produced date/time
- Use-by (DLC) date/time
- Storage mode (e.g. “+3°C”)
- Lot code
- Allergens (EU-14 list)
- Optional: QR code with production id

### 5.2 Output formats
- **PDF A4** with a grid of labels (fast to implement)
- **Thermal printer** formats (ZPL for Zebra, Brother templates) — later

---

## 6. ePack Pro Integration Strategies

### Strategy A — **API push** (best case)
If ePack provides endpoints, we push:

1) Create/update product master
2) Create production batch (lot) and request label print

**Questions to confirm:**
- Is there a REST API / SOAP / webservices?
- Authentication method (API key, OAuth, basic auth)?
- Endpoints for:
  - product creation/update
  - batch/lot creation
  - label printing
- Allergen field format: free text vs EU-14 coded

### Strategy B — **Import file** (most common)
We generate a CSV/Excel that ePack can import.

We should support exports:
- `epack_products.csv`
- `epack_productions.csv`

**Example columns:**

`epack_products.csv`
- product_code, product_name, storage_mode, default_dlc_hours, allergens

`epack_productions.csv`
- product_code, produced_at, use_by_at, lot_code, quantity, unit

### Strategy C — **No integration**
We print labels ourselves from our app and keep ePack as a separate HACCP archive if required.

---

## 7. Implementation Plan (Node.js)

### 7.1 Backend endpoints (internal)
- `POST /api/productions`
  - payload: `fiche_id`, optional `quantity`, optional override
  - response: production + computed `use_by_at` + `lot_code`

- `GET /api/productions/:id/label.pdf`
  - returns a PDF label (single or sheet)

### 7.2 Integration module abstraction
Create a provider interface:

- `EpackProvider`
  - `upsertProduct(fiche)`
  - `createProduction(production)`
  - `printLabels(productionId | payload)`

Then implementations:
- `EpackApiProvider` (future)
- `EpackCsvExporter` (immediately useful)

---

## 8. Open Items (To Decide Later)
- Exact DLC policies by category (e.g. sous-vide vs cooked vs chilled)
- EU-14 allergen mapping (codes + FR labels)
- Label size & printer target (A4 vs thermal)
- Whether to include nutrition / ingredients list (usually not required for internal DLC labels)

---

## 9. “Ask ePack” Checklist (Technical)

Request from ePack Pro support:
- Documentation for API/import
- Supported import formats (CSV/Excel) and required columns
- Allergen format requirements
- Whether label print can be triggered externally
- Sandbox/test environment availability

---

## 10. Quick Wins (Do now, integrate later)
- Add `storage_mode` + `default_dlc_hours` fields to fiches
- Add `productions` table
- Implement DLC calculation + PDF label export
- Prepare CSV exporter that matches likely ePack import needs

---

*Last updated:* 2026-02-10
