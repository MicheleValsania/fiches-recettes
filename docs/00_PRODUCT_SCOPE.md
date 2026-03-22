# Product Scope

Last updated: 2026-02-26

## Vision
Practical technical-sheet tool for restaurant operations, focused on reliability and low-friction workflows.

## Primary users
- Kitchen/production teams
- Chef/manager for cost control and printable sheets

## Product principles
- Operational simplicity first
- Offline-first local usage
- No mandatory account
- Data portability (JSON export/import)

## In scope (current app)
- Fiche editor with ingredients, steps, allergens, equipment
- Supplier and supplier-product catalog
- Food cost per ingredient and per portion
- PDF export, JSON export/import, DB save/load
- Structured categories from backend
- HACCP/storage/label metadata capture on fiche

## Out of scope (current app)
- Multi-user auth/permissions
- Cloud sync and remote collaboration
- Full traceability workflow (production batches, lot lineage, label print pipeline)
- Regulatory legal validation automation

## Compliance position (current)
The app stores useful compliance metadata (HACCP, storage, label hints) but does not yet enforce a full compliance workflow by itself. It is an authoring and data foundation layer.

## Canonical docs
- Operations: `01_OPERATIONS_RUNBOOK.md`
- Data contracts: `02_DATA_MODEL_AND_CONTRACTS.md`
- Roadmap: `03_ROADMAP.md`
