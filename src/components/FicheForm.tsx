import { useEffect, useMemo, useState } from "react";
import type { FicheTechnique, IngredientLine } from "../types/fiche";
import { computeIngredientCost, formatCurrency } from "../utils/costing";
import {
  listSupplierProducts,
  listSuppliers,
  type Supplier,
  type SupplierProduct,
  upsertSupplier,
  upsertSupplierProduct,
} from "../utils/suppliers";

type Props = {
  fiche: FicheTechnique;
  onChange: (next: FicheTechnique) => void;
  getPriceForIngredient: (
    ing: FicheTechnique["ingredients"][number]
  ) => { unitPrice: number | null; unit: string | null } | null;
  onPriceIndexRefresh: (ingredientsv: FicheTechnique["ingredients"]) => Promise<void> | void;
};

function updateIngredient(
  ingredients: IngredientLine[],
  index: number,
  patch: Partial<IngredientLine>
) {
  return ingredients.map((ing, i) => (i === index ? { ...ing, ...patch } : ing));
}

export default function FicheForm({ fiche, onChange, getPriceForIngredient, onPriceIndexRefresh }: Props) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [productsBySupplier, setProductsBySupplier] = useState<Record<string, SupplierProduct[]>>({});
  const [supplierBusy, setSupplierBusy] = useState(false);
  const [priceDrafts, setPriceDrafts] = useState<Record<string, { unitPrice: string; unit: string }>>({});

  useEffect(() => {
    let active = true;
    listSuppliers()
      .then((items) => {
        if (active) setSuppliers(items);
      })
      .catch(() => {
        if (active) setSuppliers([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const suppliersByName = useMemo(() => {
    const map = new Map<string, Supplier>();
    for (const s of suppliers) {
      map.set(s.name.toLowerCase(), s);
    }
    return map;
  }, [suppliers]);

  const set = (patch: Partial<FicheTechnique>) => {
    onChange({ ...fiche, ...patch, updatedAt: new Date().toISOString() });
  };

  const addIngredient = () => {
    set({
      ingredients: [...fiche.ingredients, { name: "", qty: "", note: "" }],
    });
  };

  const removeIngredient = (idx: number) => {
    set({ ingredients: fiche.ingredients.filter((_, i) => i !== idx) });
  };

  const addStep = () => set({ steps: [...fiche.steps, ""] });
  const removeStep = (idx: number) => set({ steps: fiche.steps.filter((_, i) => i !== idx) });

  const moveItem = <T,>(items: T[], from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
  };

  const insertItem = <T,>(items: T[], index: number, item: T) => {
    const next = [...items];
    next.splice(index, 0, item);
    return next;
  };

  const addEquipment = () => set({ equipment: [...fiche.equipment, ""] });
  const removeEquipment = (idx: number) => set({ equipment: fiche.equipment.filter((_, i) => i !== idx) });

  const addAllergen = () => set({ allergens: [...fiche.allergens, ""] });
  const removeAllergen = (idx: number) => set({ allergens: fiche.allergens.filter((_, i) => i !== idx) });

  const ensureSupplier = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const existing = suppliersByName.get(trimmed.toLowerCase());
    if (existing) return existing;
    const created = await upsertSupplier(trimmed);
    setSuppliers((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
    return created;
  };

  const ensureSupplierId = async (ing: IngredientLine, idx: number) => {
    const name = ing.supplierv.trim();
    if (!name) return null;
    if (ing.supplierId) return ing.supplierId;
    const supplier = await ensureSupplier(name);
    if (!supplier) return null;
    set({
      ingredients: updateIngredient(fiche.ingredients, idx, {
        supplier: supplier.name,
        supplierId: supplier.id,
      }),
    });
    await loadProducts(supplier.id);
    return supplier.id;
  };

  const loadProducts = async (supplierId: string) => {
    if (productsBySupplier[supplierId]) return productsBySupplier[supplierId];
    const items = await listSupplierProducts(supplierId);
    setProductsBySupplier((prev) => ({ ...prev, [supplierId]: items }));
    return items;
  };

  const ensureSupplierProduct = async (
    supplierId: string,
    name: string,
    unitPrice: number | null,
    unit: string | null
  ) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const items = await loadProducts(supplierId);
    const existing = items.find((p) => p.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing;
    const created = await upsertSupplierProduct(supplierId, trimmed, unitPrice, unit);
    setProductsBySupplier((prev) => ({
      ...prev,
      [supplierId]: [...(prev[supplierId] || []), created].sort((a, b) => a.name.localeCompare(b.name)),
    }));
    return created;
  };

  const writeSupplierProduct = async (
    supplierId: string,
    name: string,
    unitPrice: number | null,
    unit: string | null
  ) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const created = await upsertSupplierProduct(supplierId, trimmed, unitPrice, unit);
    setProductsBySupplier((prev) => ({
      ...prev,
      [supplierId]: [...(prev[supplierId] || []).filter((p) => p.id !== created.id), created].sort((a, b) =>
        a.name.localeCompare(b.name)
      ),
    }));
    await onPriceIndexRefresh();
    return created;
  };


  return (
    <div className="form">
      <h2 className="section-title">Editor fiche</h2>

      <label className="field">
        <span className="field-label">Titolo</span>
        <input
          className="input"
          value={fiche.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder="Es: Risotto ai funghi"
        />
      </label>

      <div className="field-row">
        <label className="field">
          <span className="field-label">Categoria (opzionale)</span>
          <input
            className="input"
            value={fiche.category ?? ""}
            onChange={(e) => set({ category: e.target.value })}
            placeholder="Es: Primo, Dessert..."
          />
        </label>
        <label className="field field-compact">
          <span className="field-label">Porzioni</span>
          <input
            className="input"
            type="number"
            min={1}
            value={fiche.portions}
            onChange={(e) => set({ portions: Number(e.target.value || 1) })}
          />
        </label>
      </div>

      <div className="divider" />

      <div className="section-header">
        <h3>Ingredienti</h3>
        <button className="btn btn-ghost" type="button" onClick={addIngredient}>
          + Aggiungi ingrediente
        </button>
      </div>

      <div className="list">
        {fiche.ingredients.map((ing, idx) => (
          <div key={idx} className="ingredient-card">
            <div className="grid-row grid-ingredients-main">
              <input
                className="input"
                list={`supplier-products-${idx}`}
                value={ing.name}
                onChange={(e) => {
                  const value = e.target.value;
                  set({
                    ingredients: updateIngredient(fiche.ingredients, idx, {
                      name: value,
                      supplierProductId: undefined,
                    }),
                  });
                }}
                onBlur={async (e) => {
                  let supplierId = ing.supplierId;
                  try {
                    setSupplierBusy(true);
                    supplierId = await ensureSupplierId(ing, idx);
                  } finally {
                    setSupplierBusy(false);
                  }
                  if (!supplierId) return;
                  const value = e.currentTarget.value;
                  if (!value.trim()) return;
                  try {
                    setSupplierBusy(true);
                    const items = await loadProducts(supplierId);
                    const match = items.find((p) => p.name.toLowerCase() === value.toLowerCase());
                    if (match) {
                      const nextIngredients = updateIngredient(fiche.ingredients, idx, {
                        name: match.name,
                        supplierProductId: match.id,
                        unitPrice: undefined,
                        unitPriceUnit: undefined,
                      });
                      set({ ingredients: nextIngredients });
                      await onPriceIndexRefresh(nextIngredients);
                      return;
                    }
                    const created = await ensureSupplierProduct(supplierId, value, null, null);
                    if (created) {
                      const nextIngredients = updateIngredient(fiche.ingredients, idx, {
                        name: created.name,
                        supplierProductId: created.id,
                      });
                      set({ ingredients: nextIngredients });
                      await onPriceIndexRefresh(nextIngredients);
                    }
                  } finally {
                    setSupplierBusy(false);
                  }
                }}
                placeholder="Ingrediente / Prodotto"
              />
              <datalist id={`supplier-products-${idx}`}>
                {(ing.supplierId ? productsBySupplier[ing.supplierId] || [] : []).map((p) => (
                  <option key={p.id} value={p.name} />
                ))}
              </datalist>
              <input
                className="input"
                value={ing.qty}
                onChange={(e) => set({ ingredients: updateIngredient(fiche.ingredients, idx, { qty: e.target.value }) })}
                placeholder="Quantità"
              />
              <input
                className="input"
                value={ing.note ?? ""}
                onChange={(e) => set({ ingredients: updateIngredient(fiche.ingredients, idx, { note: e.target.value }) })}
                placeholder="Note (opz.)"
              />
              <button className="icon-button icon-small" type="button" onClick={() => removeIngredient(idx)} title="Rimuovi">
                x
              </button>
              <button
                className="icon-button icon-small"
                type="button"
                onClick={() => set({ ingredients: moveItem(fiche.ingredients, idx, idx - 1) })}
                disabled={idx === 0}
                title="Sposta su"
              >
                ^
              </button>
              <button
                className="icon-button icon-small"
                type="button"
                onClick={() => set({ ingredients: moveItem(fiche.ingredients, idx, idx + 1) })}
                disabled={idx === fiche.ingredients.length - 1}
                title="Sposta giu"
              >
                v
              </button>
              <button
                className="icon-button icon-small"
                type="button"
                onClick={() =>
                  set({
                    ingredients: insertItem(fiche.ingredients, idx + 1, { name: "", qty: "", note: "" }),
                  })
                }
                title="Aggiungi sotto"
              >
                +
              </button>
            </div>

            <div className="grid-row grid-ingredients-extra">
              <input
                className="input"
                list={`supplier-list-${idx}`}
                value={ing.supplier ?? ""}
                onChange={(e) => {
                  const value = e.target.value;
                  set({
                    ingredients: updateIngredient(fiche.ingredients, idx, {
                      supplier: value,
                      supplierId: undefined,
                      supplierProductId: undefined,
                      unitPrice: undefined,
                      unitPriceUnit: undefined,
                    }),
                  });
                }}
                onBlur={async (e) => {
                  const value = e.currentTarget.value;
                  if (!value.trim()) return;
                  try {
                    setSupplierBusy(true);
                    const supplier = await ensureSupplier(value);
                    if (!supplier) return;
                    set({
                      ingredients: updateIngredient(fiche.ingredients, idx, {
                        supplier: supplier.name,
                        supplierId: supplier.id,
                      }),
                    });
                    await loadProducts(supplier.id);
                  } finally {
                    setSupplierBusy(false);
                  }
                }}
                placeholder="Fornitore"
              />
              <datalist id={`supplier-list-${idx}`}>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.name} />
                ))}
              </datalist>
              <input
                className="input input-price"
                type="number"
                min={0}
                step="0.01"
                value={
                  priceDrafts[String(idx)]?.unitPrice ??
                  (getPriceForIngredient(ing)?.unitPrice != null
                    ? String(getPriceForIngredient(ing)?.unitPrice)
                    : "")
                }
                onChange={(e) =>
                  setPriceDrafts((prev) => ({
                    ...prev,
                    [String(idx)]: {
                      unitPrice: e.target.value,
                      unit: prev[String(idx)]?.unit ?? (getPriceForIngredient(ing)?.unit ?? ""),
                    },
                  }))
                }
                onBlur={async () => {
                  try {
                    setSupplierBusy(true);
                    const supplierId = await ensureSupplierId(ing, idx);
                    if (!supplierId || !ing.name.trim()) return;
                    const draft = priceDrafts[String(idx)];
                    const unitPrice =
                      draft?.unitPrice === "" ? null : Number(draft?.unitPrice ?? getPriceForIngredient(ing)?.unitPrice ?? "");
                    const unit =
                      (draft?.unit ?? getPriceForIngredient(ing)?.unit ?? "") || null;
                    const created = await writeSupplierProduct(supplierId, ing.name, unitPrice, unit);
                    if (created) {
                      const nextIngredients = updateIngredient(fiche.ingredients, idx, {
                        supplierProductId: created.id,
                      });
                      set({ ingredients: nextIngredients });
                      await onPriceIndexRefresh(nextIngredients);
                    }
                    setPriceDrafts((prev) => {
                      const next = { ...prev };
                      delete next[String(idx)];
                      return next;
                    });
                  } finally {
                    setSupplierBusy(false);
                  }
                }}
                placeholder="Prezzo unita"
              />
              <select
                className="input input-unit"
                value={priceDrafts[String(idx)]?.unit ?? getPriceForIngredient(ing)?.unit ?? ""}
                onChange={(e) =>
                  setPriceDrafts((prev) => ({
                    ...prev,
                    [String(idx)]: {
                      unitPrice: prev[String(idx)]?.unitPrice ?? "",
                      unit: e.target.value,
                    },
                  }))
                }
                onBlur={async () => {
                  try {
                    setSupplierBusy(true);
                    const supplierId = await ensureSupplierId(ing, idx);
                    if (!supplierId || !ing.name.trim()) return;
                    const draft = priceDrafts[String(idx)];
                    const unitPrice =
                      draft?.unitPrice === "" ? null : Number(draft?.unitPrice ?? getPriceForIngredient(ing)?.unitPrice ?? "");
                    const unit =
                      (draft?.unit ?? getPriceForIngredient(ing)?.unit ?? "") || null;
                    const created = await writeSupplierProduct(supplierId, ing.name, unitPrice, unit);
                    if (created) {
                      const nextIngredients = updateIngredient(fiche.ingredients, idx, {
                        supplierProductId: created.id,
                      });
                      set({ ingredients: nextIngredients });
                      await onPriceIndexRefresh(nextIngredients);
                    }
                    setPriceDrafts((prev) => {
                      const next = { ...prev };
                      delete next[String(idx)];
                      return next;
                    });
                  } finally {
                    setSupplierBusy(false);
                  }
                }}
              >
                <option value="">Unita</option>
                <option value="kg">EUR/kg</option>
                <option value="g">EUR/g</option>
                <option value="l">EUR/l</option>
                <option value="ml">EUR/ml</option>
                <option value="cl">EUR/cl</option>
                <option value="pc">EUR/pz</option>
              </select>
              <div className="cost-chip">
                {(() => {
                  const info = getPriceForIngredient(ing);
                  const unitPrice = info?.unitPrice ?? null;
                  const unit = info?.unit ?? null;
                  const cost =
                    unitPrice != null && unit
                      ? computeIngredientCost({
                          ...ing,
                          unitPrice,
                          unitPriceUnit: unit as IngredientLine["unitPriceUnit"],
                        })
                      : null;
                  return cost != null ? formatCurrency(cost) : "-";
                })()}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="divider" />

      <div className="section-header">
        <h3>Procedura</h3>
        <button className="btn btn-ghost" type="button" onClick={addStep}>
          + Aggiungi step
        </button>
      </div>

      <div className="list">
        {fiche.steps.map((s, idx) => (
          <div key={idx} className="step-card">
            <div className="grid-row grid-steps">
              <textarea
                className="input textarea"
                value={s}
                onChange={(e) => set({ steps: fiche.steps.map((x, i) => (i === idx ? e.target.value : x)) })}
                placeholder={`Step ${idx + 1}`}
              />
              <button className="icon-button icon-small" type="button" onClick={() => removeStep(idx)} title="Rimuovi">
                x
              </button>
              <button
                className="icon-button icon-small"
                type="button"
                onClick={() => set({ steps: moveItem(fiche.steps, idx, idx - 1) })}
                disabled={idx === 0}
                title="Sposta su"
              >
                ^
              </button>
              <button
                className="icon-button icon-small"
                type="button"
                onClick={() => set({ steps: moveItem(fiche.steps, idx, idx + 1) })}
                disabled={idx === fiche.steps.length - 1}
                title="Sposta giu"
              >
                v
              </button>
              <button
                className="icon-button icon-small"
                type="button"
                onClick={() => set({ steps: insertItem(fiche.steps, idx + 1, "") })}
                title="Aggiungi sotto"
              >
                +
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="divider" />

      <div className="section-header">
        <h3>Attrezzatura (opz.)</h3>
        <button className="btn btn-ghost" type="button" onClick={addEquipment}>
          + Aggiungi attrezzo
        </button>
      </div>

      <div className="list">
        {fiche.equipment.map((eq, idx) => (
          <div key={idx} className="grid-row grid-single">
            <input
              className="input"
              value={eq}
              onChange={(e) => set({ equipment: fiche.equipment.map((x, i) => (i === idx ? e.target.value : x)) })}
              placeholder="Es: planetaria, forno ventilato..."
            />
            <button className="icon-button" type="button" onClick={() => removeEquipment(idx)} title="Rimuovi">
              x
            </button>
          </div>
        ))}
      </div>

      <div className="divider" />

      <div className="section-header">
        <h3>Allergeni (opz.)</h3>
        <button className="btn btn-ghost" type="button" onClick={addAllergen}>
          + Aggiungi allergene
        </button>
      </div>

      <div className="list">
        {fiche.allergens.map((al, idx) => (
          <div key={idx} className="grid-row grid-single">
            <input
              className="input"
              value={al}
              onChange={(e) => set({ allergens: fiche.allergens.map((x, i) => (i === idx ? e.target.value : x)) })}
              placeholder="Es: glutine, latte..."
            />
            <button className="icon-button" type="button" onClick={() => removeAllergen(idx)} title="Rimuovi">
              x
            </button>
          </div>
        ))}
      </div>

      <div className="divider" />

      <h3>Note (opz.)</h3>
      <textarea
        className="input textarea"
        value={fiche.notes ?? ""}
        onChange={(e) => set({ notes: e.target.value })}
        placeholder="Note di servizio, conservazione, impiattamento..."
      />
    </div>
  );
}
