# Roadmap

Last updated: 2026-02-26

## Priority 1: stabilize current operating model
- Keep editor/library/suppliers flows stable.
- Reduce ambiguity in HACCP/storage/label fields.
- Add light validation and UX guardrails on critical fields.

Exit criteria:
- No blocking regression during normal kitchen usage.
- Team uses one shared field convention.

## Priority 2: simplify metadata UX
- Add Basic/Advanced split for HACCP/storage/label sections.
- Pre-fill common profile templates to avoid free-text drift.
- Improve preview visibility for selected label-relevant fields.

Exit criteria:
- Faster fiche completion.
- Fewer inconsistent field combinations.

## Priority 3: production labeling workflow foundation
- Introduce production batch entity (produced_at, use_by_at, lot_code).
- Compute use-by date from selected storage profile policy.
- Prepare label output model for printable/internal use.

Exit criteria:
- Reproducible generated label payload per batch.

## Priority 4: packaging/distribution
- Evaluate desktop packaging strategy for easy install.
- Preserve offline-first and backup simplicity.

## Deferred (only if needed)
- Multi-user auth/roles
- Remote sync/cloud
- Full traceability chain and external system integration
