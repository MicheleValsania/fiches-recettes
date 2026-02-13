import type { FicheTechnique, IngredientLine } from "../types/fiche";
import { computeFoodCost, computeIngredientCost, formatCurrency } from "../utils/costing";
import { localeByLang, t, type Lang } from "../i18n";

type Props = {
  fiche: FicheTechnique;
  lang: Lang;
  getPriceForIngredient: (
    ing: FicheTechnique["ingredients"][number]
  ) => { unitPrice: number | null; unit: string | null } | null;
};

export default function FichePreview({ fiche, lang, getPriceForIngredient }: Props) {
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

  const locale = localeByLang[lang];
  const emptyMark = "-";

  return (
    <div className="sheet">
      <div className="preview-header">
        <div>
          <h1 className="preview-title">{fiche.title || t(lang, "preview.ficheTitleFallback")}</h1>
          <div className="preview-meta muted">
            {fiche.category ? <span>{fiche.category} · </span> : null}
            <span>{t(lang, "preview.portions", { value: fiche.portions || 1 })}</span>
          </div>
        </div>

        <div className="preview-dates muted">
          <div>{t(lang, "preview.created", { value: new Date(fiche.createdAt).toLocaleString(locale) })}</div>
          <div>{t(lang, "preview.updated", { value: new Date(fiche.updatedAt).toLocaleString(locale) })}</div>
        </div>
      </div>

      {foodCostPerPortion != null && (
        <div className="foodcost">
          <div className="foodcost-label">{t(lang, "preview.foodCostPerPortion")}</div>
          <div className="foodcost-value">{formatCurrency(foodCostPerPortion)}</div>
          {totalFoodCost != null && (
            <div className="foodcost-sub">{t(lang, "preview.totalRecipe", { value: formatCurrency(totalFoodCost) })}</div>
          )}
        </div>
      )}

      <hr />

      <h2 className="preview-section">{t(lang, "preview.ingredients")}</h2>
      {fiche.ingredients.length === 0 ? (
        <p className="muted">{t(lang, "preview.noIngredients")}</p>
      ) : (
        <table className="preview-table">
          <thead>
            <tr>
              <th>{t(lang, "preview.colIngredient")}</th>
              <th className="col-qty">{t(lang, "preview.colQty")}</th>
              <th>{t(lang, "preview.colNotes")}</th>
              {hasSupplier && <th>{t(lang, "preview.colSupplier")}</th>}
              {hasPricing && <th className="col-price">{t(lang, "preview.colUnitPrice")}</th>}
              {hasPricing && <th className="col-cost">{t(lang, "preview.colCost")}</th>}
            </tr>
          </thead>
          <tbody>
            {fiche.ingredients.map((ing, idx) => (
              <tr key={idx}>
                <td>{ing.name || emptyMark}</td>
                <td>{ing.qty || emptyMark}</td>
                <td>{ing.note || ""}</td>
                {hasSupplier && <td>{ing.supplier || emptyMark}</td>}
                {hasPricing && (
                  <td>
                    {(() => {
                      const info = getPriceForIngredient(ing);
                      if (!info || info.unitPrice == null || !info.unit) return emptyMark;
                      return `${formatCurrency(info.unitPrice)} / ${info.unit}`;
                    })()}
                  </td>
                )}
                {hasPricing && (
                  <td className="cell-cost">
                    {(() => {
                      const info = getPriceForIngredient(ing);
                      if (!info || info.unitPrice == null || !info.unit) return emptyMark;
                      const cost = computeIngredientCost({
                        ...ing,
                        unitPrice: info.unitPrice,
                        unitPriceUnit: info.unit as IngredientLine["unitPriceUnit"],
                      });
                      return cost != null ? formatCurrency(cost) : emptyMark;
                    })()}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <hr />

      <h2 className="preview-section">{t(lang, "preview.procedure")}</h2>
      {fiche.steps.length === 0 ? (
        <p className="muted">{t(lang, "preview.noSteps")}</p>
      ) : (
        <ol className="preview-steps">
          {fiche.steps.map((s, idx) => (
            <li key={idx}>
              <span>{s || emptyMark}</span>
            </li>
          ))}
        </ol>
      )}

      {(fiche.equipment.length > 0 || fiche.allergens.length > 0) && (
        <>
          <hr />
          <div className="preview-columns">
            <div>
              <h3 className="preview-sub">{t(lang, "preview.equipment")}</h3>
              {fiche.equipment.length === 0 ? (
                <p className="muted">{emptyMark}</p>
              ) : (
                <ul className="preview-list">
                  {fiche.equipment.map((e, idx) => (
                    <li key={idx}>{e || emptyMark}</li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="preview-sub">{t(lang, "preview.allergens")}</h3>
              {fiche.allergens.length === 0 ? (
                <p className="muted">{emptyMark}</p>
              ) : (
                <ul className="preview-list">
                  {fiche.allergens.map((a, idx) => (
                    <li key={idx}>{a || emptyMark}</li>
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
          <h2 className="preview-section">{t(lang, "preview.notes")}</h2>
          <div className="preview-notes">{fiche.notes}</div>
        </>
      ) : null}
    </div>
  );
}
