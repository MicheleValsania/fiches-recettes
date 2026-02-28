# Operations Runbook

Last updated: 2026-02-26

## Local startup
1. Start PostgreSQL (Docker).
2. Run backend: `npm run dev:server`
3. Run frontend: `npm run dev`

Alternative: `npm run dev:all`.

## Daily operator flow
1. Open fiche in editor.
2. Update ingredients and supplier mapping.
3. Validate food cost in preview.
4. Save to DB.
5. Export PDF/JSON when needed.

## Backup and recovery
- Manual backup: `npm run backup:db`
- Keep Docker running before backup.
- Restore process should be tested periodically on a non-production copy.

## Import/Export guidance
- Preferred machine-readable exchange: JSON v1.1 envelope export.
- Use UTF-8 strict import script for envelope import:
  - `powershell -ExecutionPolicy Bypass -File scripts/import-fiches-envelope.ps1 -Path "C:\path\file.json"`

## Operational checks (weekly)
- Random load of recently edited fiches from DB.
- One PDF export test.
- One JSON export/import roundtrip test.
- Verify supplier->ingredient price resolution on sample fiches.

## Known operational risks
- Incomplete supplier-product mappings reduce automatic price coverage.
- Free-text fields can contain inconsistent values if team conventions are weak.
- HACCP/storage/label metadata is not yet a fully enforced production labeling workflow.

## Conventions to reduce errors
- Keep one naming convention for suppliers and products.
- Use storage profiles as canonical source for DLC/DDM computation inputs.
- Use label hints only for rendering/templating preferences.
