# Data Model and Contracts

Last updated: 2026-02-26

## Goal
Define one clear semantic contract for fiche metadata, especially HACCP/storage/label fields.

## Canonical entities
- `FicheTechnique`
- `HaccpProfile`
- `StorageProfile`
- `LabelHints`

Reference implementation:
- `src/types/fiche.ts`
- `src/components/FicheForm.tsx`
- `src/utils/exportV11.ts`

## Field semantics (critical clarification)

### 1) `haccpProfiles`: process controls
Use for process-level HACCP context and controls, not for label layout.

Core fields to keep as operational:
- `process`
- `packaging`
- `coreTempC` (if relevant)
- `holdTimeMin` (if relevant)
- `notes`

Secondary fields (allowed, but avoid duplicating storage logic):
- `tempMinC`, `tempMaxC`
- `shelfLifeValue`, `shelfLifeUnit`
- `dlcType`, `startPoint`

Rule: if shelf life is needed for labeling/export, prefer `storageProfiles` as source of truth.

### 2) `storageProfiles`: conservation and DLC/DDM basis
Use as canonical source for conservation and date policy.

Core fields:
- `id`
- `mode`
- `tempMinC`, `tempMaxC`
- `shelfLifeValue`, `shelfLifeUnit`
- `dlcType`
- `startPoint`
- `notes`

Advanced fields:
- `allowedTransformations`
- `source`

Rule: label default profile must reference a valid `storageProfiles[].id`.

### 3) `labelHints`: rendering hints only
Use only for label presentation/templating hints, not regulatory logic.

Core fields:
- `labelType`
- `displayName`
- `legalName`
- `allergenDisplayMode`
- `allergenManualText`
- `defaultStorageProfileId`
- `showInternalLot`
- `showSupplierLot`
- `showTempRange`
- `qrTarget`

Optional fields:
- `productionLabel`
- `dlcLabel`
- `templateHint`

Rule: `labelHints` does not replace storage/process data.

## Practical UI profile (proposed)

### Basic mode (default visible)
- Storage profile: mode, temp range, shelf life, unit, DLC/DDM, start point.
- Label hints: label type, display name, allergens mode/manual text, default storage profile, lot toggles, temp toggle.
- HACCP: process + packaging + notes.

### Advanced mode (collapsed)
- HACCP extra numbers (core temp, hold time, duplicate shelf-life inputs)
- Storage advanced (`allowedTransformations`, `source`)
- Label template internals (`templateHint`, custom date labels)

## Export contract status
Current JSON export v1.1 maps all three blocks and validates:
- numeric parse warnings
- date parse warnings
- default storage profile reference consistency

Source: `src/utils/exportV11.ts`.

## Migration plan (soft, no data break)
1. Keep existing stored fields compatible.
2. Update docs and team conventions immediately.
3. In UI, move non-essential fields under "Advanced".
4. In export, keep all fields but mark duplicated semantics as legacy in docs.
5. Later, optionally deprecate duplicated HACCP shelf-life fields after usage audit.

## Decision log (2026-02-26)
- `storageProfiles` is the canonical source for DLC/DDM and conservation display defaults.
- `haccpProfiles` focuses on process-level control context.
- `labelHints` is a rendering hint layer.
