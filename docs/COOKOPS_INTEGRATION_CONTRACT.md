# CookOps Integration Contract

Last updated: 2026-02-26

## Scope
This document defines how `cookops` and `fiches-recettes` should exchange data with stable IDs and predictable behavior.

## Roles
- `cookops`: master for inventory, supplier catalogs, invoice/BL extraction, receiving controls, reconciliations.
- `fiches-recettes`: authoring and execution layer for recipes/fiches and food-cost computation.

## Core integration principle
Use stable product identity from `cookops` into fiche ingredients:
- `supplierId`
- `supplierProductId`

When these IDs are present, food-cost lookup in `fiches-recettes` is deterministic.

## Current backend API surface (`fiches-recettes`)
- `GET /api/health`
- `GET /api/fiches`
- `GET /api/fiches/:id`
- `POST /api/fiches` (upsert by `id`)
- `DELETE /api/fiches/:id`
- `GET /api/categories`
- `GET /api/suppliers`
- `POST /api/suppliers`
- `PUT /api/suppliers/:id`
- `DELETE /api/suppliers/:id`
- `GET /api/suppliers/:id/products`
- `POST /api/suppliers/:id/products`
- `PUT /api/suppliers/:id/products/:productId`
- `PUT /api/suppliers/:id/products/:productId/name`
- `DELETE /api/suppliers/:id/products/:productId`

## Canonical fiche structure
Entity: `FicheTechnique`
- `id`, `title`, `category`, `portions`
- `ingredients[]`: `name`, `displayName`, `qty`, `note`, `supplier`, `supplierId`, `supplierProductId`, `unitPrice`, `unitPriceUnit`
- `allergens[]`
- `haccpProfiles[]`
- `storageProfiles[]`
- `labelHints`
- `createdAt`, `updatedAt`

## Supplier/product model
Entity: `Supplier`
- `id`, `name`

Entity: `SupplierProduct`
- `id`, `supplierId`, `name`
- `supplierCode` (supplier reference code)
- `sourcePrice`, `sourceUnit` (source/origin price)
- `unitPrice`, `unit` (operational price used for food cost)

## Food-cost resolution logic (actual behavior)
Price matching order for each ingredient:
1. `ingredient.supplierProductId` exact match
2. fallback `ingredient.supplierId + normalized(ingredient.name)`
3. fallback `normalized(ingredient.supplier) + normalized(ingredient.name)`

Normalization removes case/diacritics and normalizes spaces/symbols.

## Integration requirements for CookOps
1. Keep supplier IDs and supplier-product IDs stable over time.
2. Push supplier catalog updates to `fiches-recettes` via supplier/product endpoints.
3. Ensure each fiche ingredient sent from `cookops` includes:
   - `supplierId`
   - `supplierProductId`
   - canonical product `name`
4. Keep `unitPrice/unit` updated in supplier products (operational cost baseline).
5. Use fiche upsert (`POST /api/fiches`) for final recipe payload persistence.

## Recommended sync flow
1. `cookops` creates/updates supplier and supplier_products in `fiches-recettes`.
2. `cookops` sends fiche payloads with mapped ingredient references.
3. `fiches-recettes` computes food-cost from synchronized catalog values.
4. `fiches-recettes` exports JSON v1.1 for downstream analytics/ingest validation.

## JSON v1.1 export (recommended machine contract)
Envelope fields:
- `export_version`
- `exported_at`
- `source_app`
- `fiches[]`
- `warnings[]`

Important fiche-level fields in export:
- `fiche_id`, `title`, `updated_at`, `category`
- `ingredients[].supplier_id`
- `ingredients[].supplier_product_id`
- `ingredients[].unit_price_value`
- `ingredients[].unit_price_unit`
- `haccp_profiles`
- `storage_profiles`
- `label_hints`

## Data quality rules
- Use UTC ISO timestamps.
- Avoid changing semantic meaning of existing IDs.
- Prefer explicit ID mapping over text-based matching.
- Keep `unitPrice/unit` operationally consistent for each product.
- Validate non-empty `id` on fiche and product entities.

## Known gaps (current app)
- No auth/versioning on API.
- No pagination.
- No dedicated endpoint for aggregated demand by service window.
- Limited server-side schema validation.

## Next integration milestones
1. Add API versioning (`/api/v1/...`) and token auth.
2. Add bulk upsert endpoints for suppliers/products/fiches.
3. Add endpoint to compute required quantities from selected fiches:
   - input: fiches + quantities
   - output: aggregated supplier-product requirements
4. Add provenance metadata (`source_system`, `source_event_id`, `synced_at`).

## Minimal payload examples
Create/update supplier:
```json
{ "name": "AEM" }
```

Create/update supplier product:
```json
{
  "name": "Cabillaud pane",
  "supplierCode": "AEM-POI-001",
  "sourcePrice": 12.5,
  "sourceUnit": "kg",
  "unitPrice": 15.2,
  "unit": "kg"
}
```

Ingredient reference inside fiche:
```json
{
  "name": "Cabillaud pane",
  "qty": "130 g",
  "supplier": "AEM",
  "supplierId": "b7673b4e-7f37-46b5-bf8e-1d7a287afbe2",
  "supplierProductId": "PRODUCT_UUID"
}
```
