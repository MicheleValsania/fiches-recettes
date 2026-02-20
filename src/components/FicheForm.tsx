import { useEffect, useMemo, useState } from "react";
import type { FicheTechnique, HaccpProfile, IngredientLine } from "../types/fiche";
import { computeIngredientCost, formatCurrency } from "../utils/costing";
import { t, type Lang } from "../i18n";
import { listCategories, type CategoryListItem } from "../utils/db";
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
  lang: Lang;
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

function updateHaccpProfile(
  profiles: HaccpProfile[],
  index: number,
  patch: Partial<HaccpProfile>
) {
  return profiles.map((profile, i) => (i === index ? { ...profile, ...patch } : profile));
}

export default function FicheForm({ fiche, lang, onChange, getPriceForIngredient, onPriceIndexRefresh }: Props) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [categories, setCategories] = useState<CategoryListItem[]>([]);
  const [categorySelectEnabled, setCategorySelectEnabled] = useState(false);
  const [productsBySupplier, setProductsBySupplier] = useState<Record<string, SupplierProduct[]>>({});
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

  useEffect(() => {
    let active = true;
    listCategories()
      .then((items) => {
        if (!active) return;
        if (items.length > 0) {
          setCategories(items);
          setCategorySelectEnabled(true);
          return;
        }
        setCategories([]);
        setCategorySelectEnabled(false);
      })
      .catch(() => {
        if (!active) return;
        setCategories([]);
        setCategorySelectEnabled(false);
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

  const categoriesByPointVente = useMemo(() => {
    const byPoint: Record<"commun" | "ristorante" | "snack_bar", CategoryListItem[]> = {
      commun: [],
      ristorante: [],
      snack_bar: [],
    };
    for (const item of categories) {
      if (item.pointVente === "commun") byPoint.commun.push(item);
      else if (item.pointVente === "ristorante") byPoint.ristorante.push(item);
      else if (item.pointVente === "snack_bar") byPoint.snack_bar.push(item);
    }
    return byPoint;
  }, [categories]);

  const legacyCategoryValue = useMemo(() => {
    const current = (fiche.category ?? "").trim();
    if (!current) return "";
    const known = categories.some((item) => item.displayName.toLowerCase() === current.toLowerCase());
    return known ? "" : current;
  }, [categories, fiche.category]);

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

  const addHaccpProfile = () =>
    set({
      haccpProfiles: [
        ...(fiche.haccpProfiles ?? []),
        {
          process: "COOK_CHILL",
          packaging: "",
          tempMinC: "",
          tempMaxC: "",
          coreTempC: "",
          holdTimeMin: "",
          shelfLifeValue: "",
          shelfLifeUnit: "",
          dlcType: "DLC",
          startPoint: "production_date",
          notes: "",
        },
      ],
    });
  const removeHaccpProfile = (idx: number) =>
    set({ haccpProfiles: (fiche.haccpProfiles ?? []).filter((_, i) => i !== idx) });

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
    const name = (ing.supplier ?? "").trim();
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
    const created = await upsertSupplierProduct(supplierId, trimmed, null, null, null, unitPrice, unit);
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
    const created = await upsertSupplierProduct(supplierId, trimmed, null, null, null, unitPrice, unit);
    setProductsBySupplier((prev) => ({
      ...prev,
      [supplierId]: [...(prev[supplierId] || []).filter((p) => p.id !== created.id), created].sort((a, b) =>
        a.name.localeCompare(b.name)
      ),
    }));
    return created;
  };

  return (
    <div className="form">
      <h2 className="section-title">{t(lang, "form.editorTitle")}</h2>

      <label className="field">
        <span className="field-label">{t(lang, "form.title")}</span>
        <input
          className="input"
          value={fiche.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder={t(lang, "form.titlePlaceholder")}
        />
      </label>

      <div className="field-row">
        <label className="field">
          <span className="field-label">{t(lang, "form.category")}</span>
          {categorySelectEnabled ? (
            <select
              className="input"
              value={fiche.category ?? ""}
              onChange={(e) => set({ category: e.target.value })}
            >
              <option value="">{t(lang, "form.categorySelectPlaceholder")}</option>
              {legacyCategoryValue ? (
                <option value={legacyCategoryValue}>
                  {t(lang, "form.categoryCurrentValue", { value: legacyCategoryValue })}
                </option>
              ) : null}
              {categoriesByPointVente.commun.length > 0 ? (
                <optgroup label={t(lang, "form.categoryGroupCommon")}>
                  {categoriesByPointVente.commun.map((item) => (
                    <option key={item.id} value={item.displayName}>
                      {item.displayName}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {categoriesByPointVente.ristorante.length > 0 ? (
                <optgroup label={t(lang, "form.categoryGroupRistorante")}>
                  {categoriesByPointVente.ristorante.map((item) => (
                    <option key={item.id} value={item.displayName}>
                      {item.displayName}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {categoriesByPointVente.snack_bar.length > 0 ? (
                <optgroup label={t(lang, "form.categoryGroupSnackBar")}>
                  {categoriesByPointVente.snack_bar.map((item) => (
                    <option key={item.id} value={item.displayName}>
                      {item.displayName}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          ) : (
            <input
              className="input"
              value={fiche.category ?? ""}
              onChange={(e) => set({ category: e.target.value })}
              placeholder={t(lang, "form.categoryPlaceholder")}
            />
          )}
        </label>
        <label className="field field-compact">
          <span className="field-label">{t(lang, "form.portions")}</span>
          <input
            className="input"
            type="number"
            min={1}
            value={fiche.portions > 0 ? fiche.portions : ""}
            onChange={(e) => {
              const next = e.target.value;
              if (next === "") {
                set({ portions: 0 });
                return;
              }
              set({ portions: Math.max(1, Number(next) || 1) });
            }}
            onBlur={() => {
              if (!fiche.portions || fiche.portions < 1) {
                set({ portions: 1 });
              }
            }}
          />
        </label>
      </div>

      <div className="divider" />

      <div className="section-header">
        <h3>{t(lang, "form.ingredients")}</h3>
        <button className="btn btn-ghost" type="button" onClick={addIngredient}>
          {t(lang, "form.addIngredient")}
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
                  const supplierId = await ensureSupplierId(ing, idx);
                  if (!supplierId) return;
                  const value = e.currentTarget.value;
                  if (!value.trim()) return;
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
                }}
                placeholder={t(lang, "form.ingredientPlaceholder")}
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
                placeholder={t(lang, "form.qtyPlaceholder")}
              />
              <input
                className="input"
                value={ing.note ?? ""}
                onChange={(e) => set({ ingredients: updateIngredient(fiche.ingredients, idx, { note: e.target.value }) })}
                placeholder={t(lang, "form.notePlaceholder")}
              />
              <button
                className="icon-button icon-small"
                type="button"
                onClick={() => removeIngredient(idx)}
                title={t(lang, "form.remove")}
              >
                x
              </button>
              <button
                className="icon-button icon-small"
                type="button"
                onClick={() => set({ ingredients: moveItem(fiche.ingredients, idx, idx - 1) })}
                disabled={idx === 0}
                title={t(lang, "form.moveUp")}
              >
                ^
              </button>
              <button
                className="icon-button icon-small"
                type="button"
                onClick={() => set({ ingredients: moveItem(fiche.ingredients, idx, idx + 1) })}
                disabled={idx === fiche.ingredients.length - 1}
                title={t(lang, "form.moveDown")}
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
                title={t(lang, "form.addBelow")}
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
                  const supplier = await ensureSupplier(value);
                  if (!supplier) return;
                  set({
                    ingredients: updateIngredient(fiche.ingredients, idx, {
                      supplier: supplier.name,
                      supplierId: supplier.id,
                    }),
                  });
                  await loadProducts(supplier.id);
                }}
                placeholder={t(lang, "form.supplierPlaceholder")}
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
                  const supplierId = await ensureSupplierId(ing, idx);
                  if (!supplierId || !ing.name.trim()) return;
                  const draft = priceDrafts[String(idx)];
                  const unitPrice =
                    draft?.unitPrice === "" ? null : Number(draft?.unitPrice ?? getPriceForIngredient(ing)?.unitPrice ?? "");
                  const unit = (draft?.unit ?? getPriceForIngredient(ing)?.unit ?? "") || null;
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
                }}
                placeholder={t(lang, "form.unitPricePlaceholder")}
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
                  const supplierId = await ensureSupplierId(ing, idx);
                  if (!supplierId || !ing.name.trim()) return;
                  const draft = priceDrafts[String(idx)];
                  const unitPrice =
                    draft?.unitPrice === "" ? null : Number(draft?.unitPrice ?? getPriceForIngredient(ing)?.unitPrice ?? "");
                  const unit = (draft?.unit ?? getPriceForIngredient(ing)?.unit ?? "") || null;
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
                }}
              >
                <option value="">{t(lang, "form.unitLabel")}</option>
                <option value="kg">EUR/kg</option>
                <option value="g">EUR/g</option>
                <option value="l">EUR/l</option>
                <option value="ml">EUR/ml</option>
                <option value="cl">EUR/cl</option>
                <option value="pc">EUR/pc</option>
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
        <h3>{t(lang, "form.procedure")}</h3>
        <button className="btn btn-ghost" type="button" onClick={addStep}>
          {t(lang, "form.addStep")}
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
              <button className="icon-button icon-small" type="button" onClick={() => removeStep(idx)} title={t(lang, "form.remove")}>
                x
              </button>
              <button
                className="icon-button icon-small"
                type="button"
                onClick={() => set({ steps: moveItem(fiche.steps, idx, idx - 1) })}
                disabled={idx === 0}
                title={t(lang, "form.moveUp")}
              >
                ^
              </button>
              <button
                className="icon-button icon-small"
                type="button"
                onClick={() => set({ steps: moveItem(fiche.steps, idx, idx + 1) })}
                disabled={idx === fiche.steps.length - 1}
                title={t(lang, "form.moveDown")}
              >
                v
              </button>
              <button
                className="icon-button icon-small"
                type="button"
                onClick={() => set({ steps: insertItem(fiche.steps, idx + 1, "") })}
                title={t(lang, "form.addBelow")}
              >
                +
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="divider" />

      <div className="section-header">
        <h3>{t(lang, "form.equipment")}</h3>
        <button className="btn btn-ghost" type="button" onClick={addEquipment}>
          {t(lang, "form.addEquipment")}
        </button>
      </div>

      <div className="list">
        {fiche.equipment.map((eq, idx) => (
          <div key={idx} className="grid-row grid-single">
            <input
              className="input"
              value={eq}
              onChange={(e) => set({ equipment: fiche.equipment.map((x, i) => (i === idx ? e.target.value : x)) })}
              placeholder={t(lang, "form.equipmentPlaceholder")}
            />
            <button className="icon-button" type="button" onClick={() => removeEquipment(idx)} title={t(lang, "form.remove")}>
              x
            </button>
          </div>
        ))}
      </div>

      <div className="divider" />

      <div className="section-header">
        <h3>{t(lang, "form.allergens")}</h3>
        <button className="btn btn-ghost" type="button" onClick={addAllergen}>
          {t(lang, "form.addAllergen")}
        </button>
      </div>

      <div className="list">
        {fiche.allergens.map((al, idx) => (
          <div key={idx} className="grid-row grid-single">
            <input
              className="input"
              value={al}
              onChange={(e) => set({ allergens: fiche.allergens.map((x, i) => (i === idx ? e.target.value : x)) })}
              placeholder={t(lang, "form.allergenPlaceholder")}
            />
            <button className="icon-button" type="button" onClick={() => removeAllergen(idx)} title={t(lang, "form.remove")}>
              x
            </button>
          </div>
        ))}
      </div>

      <div className="divider" />

      <div className="section-header">
        <h3>{t(lang, "form.haccpProfiles")}</h3>
        <button className="btn btn-ghost" type="button" onClick={addHaccpProfile}>
          {t(lang, "form.addHaccpProfile")}
        </button>
      </div>

      <div className="list">
        {(fiche.haccpProfiles ?? []).map((profile, idx) => (
          <div key={idx} className="ingredient-card haccp-card">
            <div className="grid-row haccp-grid">
              <select
                className="input"
                value={profile.process}
                onChange={(e) =>
                  set({ haccpProfiles: updateHaccpProfile(fiche.haccpProfiles ?? [], idx, { process: e.target.value as HaccpProfile["process"] }) })
                }
              >
                <option value="COOK_CHILL">{t(lang, "form.haccpProcess.COOK_CHILL")}</option>
                <option value="MARINATION">{t(lang, "form.haccpProcess.MARINATION")}</option>
                <option value="VACUUM_PASTEURIZATION">{t(lang, "form.haccpProcess.VACUUM_PASTEURIZATION")}</option>
                <option value="SOUS_VIDE_COOK">{t(lang, "form.haccpProcess.SOUS_VIDE_COOK")}</option>
                <option value="FREEZING">{t(lang, "form.haccpProcess.FREEZING")}</option>
                <option value="THAWING">{t(lang, "form.haccpProcess.THAWING")}</option>
                <option value="HOT_HOLDING">{t(lang, "form.haccpProcess.HOT_HOLDING")}</option>
                <option value="OTHER">{t(lang, "form.haccpProcess.OTHER")}</option>
              </select>
              <input
                className="input"
                value={profile.packaging}
                onChange={(e) =>
                  set({ haccpProfiles: updateHaccpProfile(fiche.haccpProfiles ?? [], idx, { packaging: e.target.value }) })
                }
                placeholder={t(lang, "form.haccpPackaging")}
              />
              <input
                className="input"
                value={profile.tempMinC}
                onChange={(e) =>
                  set({ haccpProfiles: updateHaccpProfile(fiche.haccpProfiles ?? [], idx, { tempMinC: e.target.value }) })
                }
                placeholder={t(lang, "form.haccpTempMin")}
              />
              <input
                className="input"
                value={profile.tempMaxC}
                onChange={(e) =>
                  set({ haccpProfiles: updateHaccpProfile(fiche.haccpProfiles ?? [], idx, { tempMaxC: e.target.value }) })
                }
                placeholder={t(lang, "form.haccpTempMax")}
              />
              <input
                className="input"
                value={profile.coreTempC}
                onChange={(e) =>
                  set({ haccpProfiles: updateHaccpProfile(fiche.haccpProfiles ?? [], idx, { coreTempC: e.target.value }) })
                }
                placeholder={t(lang, "form.haccpCoreTemp")}
              />
              <input
                className="input"
                value={profile.holdTimeMin}
                onChange={(e) =>
                  set({ haccpProfiles: updateHaccpProfile(fiche.haccpProfiles ?? [], idx, { holdTimeMin: e.target.value }) })
                }
                placeholder={t(lang, "form.haccpHoldMin")}
              />
              <input
                className="input"
                value={profile.shelfLifeValue}
                onChange={(e) =>
                  set({ haccpProfiles: updateHaccpProfile(fiche.haccpProfiles ?? [], idx, { shelfLifeValue: e.target.value }) })
                }
                placeholder={t(lang, "form.haccpShelfLifeValue")}
              />
              <select
                className="input"
                value={profile.shelfLifeUnit}
                onChange={(e) =>
                  set({ haccpProfiles: updateHaccpProfile(fiche.haccpProfiles ?? [], idx, { shelfLifeUnit: e.target.value as HaccpProfile["shelfLifeUnit"] }) })
                }
              >
                <option value="">{t(lang, "form.haccpShelfLifeUnit")}</option>
                <option value="hours">{t(lang, "form.haccpUnit.hours")}</option>
                <option value="days">{t(lang, "form.haccpUnit.days")}</option>
                <option value="months">{t(lang, "form.haccpUnit.months")}</option>
              </select>
              <select
                className="input"
                value={profile.dlcType}
                onChange={(e) =>
                  set({ haccpProfiles: updateHaccpProfile(fiche.haccpProfiles ?? [], idx, { dlcType: e.target.value as HaccpProfile["dlcType"] }) })
                }
              >
                <option value="">{t(lang, "form.haccpDlcType")}</option>
                <option value="DLC">DLC</option>
                <option value="DDM">DDM</option>
              </select>
              <select
                className="input"
                value={profile.startPoint}
                onChange={(e) =>
                  set({ haccpProfiles: updateHaccpProfile(fiche.haccpProfiles ?? [], idx, { startPoint: e.target.value as HaccpProfile["startPoint"] }) })
                }
              >
                <option value="">{t(lang, "form.haccpStartPoint")}</option>
                <option value="production_date">{t(lang, "form.haccpStart.production_date")}</option>
                <option value="cooling_end">{t(lang, "form.haccpStart.cooling_end")}</option>
                <option value="opening_date">{t(lang, "form.haccpStart.opening_date")}</option>
                <option value="thaw_date">{t(lang, "form.haccpStart.thaw_date")}</option>
                <option value="receipt_date">{t(lang, "form.haccpStart.receipt_date")}</option>
              </select>
            </div>
            <div className="grid-row haccp-grid-note">
              <textarea
                className="input textarea"
                value={profile.notes}
                onChange={(e) =>
                  set({ haccpProfiles: updateHaccpProfile(fiche.haccpProfiles ?? [], idx, { notes: e.target.value }) })
                }
                placeholder={t(lang, "form.haccpNotes")}
              />
              <button className="icon-button" type="button" onClick={() => removeHaccpProfile(idx)} title={t(lang, "form.remove")}>
                x
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="divider" />

      <h3>{t(lang, "form.notes")}</h3>
      <textarea
        className="input textarea"
        value={fiche.notes ?? ""}
        onChange={(e) => set({ notes: e.target.value })}
        placeholder={t(lang, "form.notesPlaceholder")}
      />
    </div>
  );
}
