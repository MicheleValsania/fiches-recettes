import type { FicheTechnique, IngredientLine } from "../types/fiche";
import { computeFoodCost, computeIngredientCost, formatCurrency } from "../utils/costing";

type Props = {
  fiche: FicheTechnique;
  getPriceForIngredient: (
    ing: FicheTechnique["ingredients"][number]
  ) => { unitPrice: number | null; unit: string | null } | null;
};

export default function FichePreview({ fiche, getPriceForIngredient }: Props) {
  const hasSupplier = fiche.ingredients.some((ing) => ing.supplier?.trim());
  const hasPricing = fiche.ingredients.some((ing) => {
    const info = getPriceForIngredient(ing);
    return info?.unitPrice != null && info.unit;
  });
  const totalFoodCost = computeFoodCost(
    fiche.ingredients.map((ing) => {
      const info = getPriceForIngredient(ing);
      if (!info || info.unitPrice == null || !info.unit) return ing;
      return {
        ...ing,
        unitPrice: info.unitPrice,
        unitPriceUnit: info.unit as IngredientLine["unitPriceUnit"],
      };
    })
  );
  const foodCostPerPortion =
    totalFoodCost != null && fiche.portions ? totalFoodCost / fiche.portions : null;

  return (
    <div className="sheet">
      <div className="preview-header">
        <div>
          <h1 className="preview-title">{fiche.title || "Fiche Technique"}</h1>
          <div className="preview-meta muted">
            {fiche.category ? <span>{fiche.category} · </span> : null}
            <span>Porzioni: {fiche.portions || 1}</span>
          </div>
        </div>

        <div className="preview-dates muted">
          <div>Creato: {new Date(fiche.createdAt).toLocaleString()}</div>
          <div>Aggiornato: {new Date(fiche.updatedAt).toLocaleString()}</div>
        </div>
      </div>

      {foodCostPerPortion != null && (
        <div className="foodcost">
          <div className="foodcost-label">Food cost per porzione</div>
          <div className="foodcost-value">{formatCurrency(foodCostPerPortion)}</div>
          {totalFoodCost != null && (
            <div className="foodcost-sub">Totale ricetta: {formatCurrency(totalFoodCost)}</div>
          )}
        </div>
      )}

      <hr />

      <h2 className="preview-section">Ingredienti</h2>
      {fiche.ingredients.length === 0 ? (
        <p className="muted">Nessun ingrediente.</p>
      ) : (
        <table className="preview-table">
          <thead>
            <tr>
              <th>Ingrediente</th>
              <th className="col-qty">Quantità</th>
              <th>Note</th>
              {hasSupplier && <th>Fornitore</th>}
              {hasPricing && <th className="col-price">Prezzo unità</th>}
              {hasPricing && <th className="col-cost">Costo</th>}
            </tr>
          </thead>
          <tbody>
            {fiche.ingredients.map((ing, idx) => (
              <tr key={idx}>
                <td>{ing.name || "—"}</td>
                <td>{ing.qty || "—"}</td>
                <td>{ing.note || ""}</td>
                {hasSupplier && <td>{ing.supplier || "—"}</td>}
                {hasPricing && (
                  <td>
                    {(() => {
                      const info = getPriceForIngredient(ing);
                      if (!info || info.unitPrice == null || !info.unit) return "—";
                      return `${formatCurrency(info.unitPrice)} / ${info.unit}`;
                    })()}
                  </td>
                )}
                {hasPricing && (
                  <td className="cell-cost">
                    {(() => {
                      const info = getPriceForIngredient(ing);
                      if (!info || info.unitPrice == null || !info.unit) return "—";
                      const cost = computeIngredientCost({
                        ...ing,
                        unitPrice: info.unitPrice,
                        unitPriceUnit: info.unit as IngredientLine["unitPriceUnit"],
                      });
                      return cost != null ? formatCurrency(cost) : "—";
                    })()}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <hr />

      <h2 className="preview-section">Procedura</h2>
      {fiche.steps.length === 0 ? (
        <p className="muted">Nessuno step.</p>
      ) : (
        <ol className="preview-steps">
          {fiche.steps.map((s, idx) => (
            <li key={idx}>
              <span>{s || "—"}</span>
            </li>
          ))}
        </ol>
      )}

      {(fiche.equipment.length > 0 || fiche.allergens.length > 0) && (
        <>
          <hr />
          <div className="preview-columns">
            <div>
              <h3 className="preview-sub">Attrezzatura</h3>
              {fiche.equipment.length === 0 ? (
                <p className="muted">—</p>
              ) : (
                <ul className="preview-list">
                  {fiche.equipment.map((e, idx) => (
                    <li key={idx}>{e || "—"}</li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="preview-sub">Allergeni</h3>
              {fiche.allergens.length === 0 ? (
                <p className="muted">—</p>
              ) : (
                <ul className="preview-list">
                  {fiche.allergens.map((a, idx) => (
                    <li key={idx}>{a || "—"}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}

      {fiche.notes?.trim() ? (
        <>
          <hr />
          <h2 className="preview-section">Note</h2>
          <div className="preview-notes">{fiche.notes}</div>
        </>
      ) : null}
    </div>
  );
}
