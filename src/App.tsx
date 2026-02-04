import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import "./print.css";

import type { FicheTechnique } from "./types/fiche";
import FicheForm from "./components/FicheForm";
import FichePreview from "./components/FichePreview";
import { downloadJson, readJsonFile, safeFilename } from "./utils/exporters";
import { exportElementToA4Pdf } from "./utils/pdf";
import {
  deleteFicheFromDb,
  listFichesFromDb,
  loadFicheFromDb,
  saveFicheToDb,
  type FicheListItem,
} from "./utils/db";
import {
  listSuppliers,
  listSupplierProducts,
  type Supplier,
  type SupplierProduct,
  upsertSupplier,
  upsertSupplierProduct,
  updateSupplierProduct,
  deleteSupplierProduct,
} from "./utils/suppliers";

const STORAGE_KEY = "fiche-technique:v1";

function newFiche(): FicheTechnique {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: "",
    category: "",
    portions: 4,
    allergens: [],
    equipment: [],
    ingredients: [{ name: "", qty: "", note: "" }],
    steps: [""],
    notes: "",
    createdAt: now,
    updatedAt: now,
  };
}

export default function App() {
  const [fiche, setFiche] = useState<FicheTechnique>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return newFiche();
      const parsed = JSON.parse(raw) as FicheTechnique;
      return { ...newFiche(), ...parsed };
    } catch {
      return newFiche();
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fiche));
  }, [fiche]);

  const previewRef = useRef<HTMLDivElement>(null);
  const [dbStatus, setDbStatus] = useState<string>("");
  const [dbBusy, setDbBusy] = useState(false);
  const [view, setView] = useState<"editor" | "library" | "suppliers" | "supplierDetail">("editor");
  const [library, setLibrary] = useState<FicheListItem[]>([]);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierQuery, setSupplierQuery] = useState("");
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [supplierProducts, setSupplierProducts] = useState<SupplierProduct[]>([]);
  const [supplierProductEdits, setSupplierProductEdits] = useState<
    Record<string, { unitPrice: string; unit: string }>
  >({});
  const [newSupplierName, setNewSupplierName] = useState("");
  const [newProductName, setNewProductName] = useState("");
  const [newProductPrice, setNewProductPrice] = useState("");
  const [newProductUnit, setNewProductUnit] = useState("");
  const [priceIndex, setPriceIndex] = useState<{
    byProductId: Record<string, { unitPrice: number | null; unit: string | null }>;
    bySupplierKey: Record<string, { unitPrice: number | null; unit: string | null }>;
  }>({ byProductId: {}, bySupplierKey: {} });

  const fileNameBase = useMemo(() => {
    const title = fiche.title?.trim() ? fiche.title.trim() : "fiche-technique";
    return safeFilename(title);
  }, [fiche.title]);

  async function onImportJson(file: File) {
    try {
      const imported = await readJsonFile<FicheTechnique>(file);
      const merged: FicheTechnique = {
        ...newFiche(),
        ...imported,
        updatedAt: new Date().toISOString(),
      };
      setFiche(merged);
    } catch {
      alert("File JSON non valido.");
    }
  }

  async function onExportPdfOneClick() {
    if (!previewRef.current) return;
    await exportElementToA4Pdf(previewRef.current, `${fileNameBase}.pdf`);
  }

  async function onSaveDb() {
    try {
      setDbBusy(true);
      await saveFicheToDb(fiche);
      setDbStatus("Salvata nel DB.");
    } catch {
      setDbStatus("Errore: server DB non raggiungibile.");
    } finally {
      setDbBusy(false);
    }
  }

  async function onLoadDb() {
    try {
      setDbBusy(true);
      const loaded = await loadFicheFromDb(fiche.id);
      setFiche({ ...newFiche(), ...loaded, updatedAt: new Date().toISOString() });
      setDbStatus("Fiche caricata dal DB.");
    } catch {
      setDbStatus("Nessuna fiche trovata con questo ID.");
    } finally {
      setDbBusy(false);
    }
  }

  async function onOpenLibrary() {
    try {
      setDbBusy(true);
      const items = await listFichesFromDb();
      setLibrary(items);
      setView("library");
      setDbStatus("");
    } catch {
      setDbStatus("Errore nel caricamento elenco.");
    } finally {
      setDbBusy(false);
    }
  }

  async function onSelectFromLibrary(item: FicheListItem) {
    try {
      setDbBusy(true);
      const loaded = await loadFicheFromDb(item.id);
      setFiche({ ...newFiche(), ...loaded, updatedAt: new Date().toISOString() });
      setView("editor");
      setDbStatus("Fiche caricata dal DB.");
    } catch {
      setDbStatus("Impossibile caricare la fiche selezionata.");
    } finally {
      setDbBusy(false);
    }
  }

  async function onDeleteFromLibrary(item: FicheListItem) {
    if (!confirm(`Eliminare la fiche "${item.title || "Senza titolo"}"?`)) return;
    try {
      setDbBusy(true);
      await deleteFicheFromDb(item.id);
      setLibrary((prev) => prev.filter((f) => f.id !== item.id));
    } catch {
      setDbStatus("Errore eliminazione fiche.");
    } finally {
      setDbBusy(false);
    }
  }

  const normalize = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/\s+/g, " ");

  const getPriceForIngredient = (ing: FicheTechnique["ingredients"][number]) => {
    if (ing.supplierProductId && priceIndex.byProductId[ing.supplierProductId]) {
      return priceIndex.byProductId[ing.supplierProductId];
    }
    if (ing.supplierId) {
      const key = `${ing.supplierId}::${normalize(ing.name)}`;
      return priceIndex.bySupplierKey[key] || null;
    }
    if (ing.supplier) {
      const key = `${normalize(ing.supplier)}::${normalize(ing.name)}`;
      return priceIndex.bySupplierKey[key] || null;
    }
    return null;
  };

  const rebuildPriceIndex = async (ingredients: FicheTechnique["ingredients"]) => {
    const supplierIds = new Set<string>();
    const supplierNames = new Set<string>();
    for (const ing of ingredients) {
      if (ing.supplierId) supplierIds.add(ing.supplierId);
      else if (ing.supplier?.trim()) supplierNames.add(normalize(ing.supplier));
    }

    if (supplierIds.size === 0 && supplierNames.size === 0) {
      setPriceIndex({ byProductId: {}, bySupplierKey: {} });
      return;
    }

    const suppliersList = await listSuppliers();
    const suppliersByName = new Map(suppliersList.map((s) => [normalize(s.name), s]));
    for (const name of supplierNames) {
      const match = suppliersByName.get(name);
      if (match) supplierIds.add(match.id);
    }

    const byProductId: Record<string, { unitPrice: number | null; unit: string | null }> = {};
    const bySupplierKey: Record<string, { unitPrice: number | null; unit: string | null }> = {};

    for (const id of supplierIds) {
      const supplier = suppliersList.find((s) => s.id === id);
      const products = await listSupplierProducts(id);
      for (const p of products) {
        const info = { unitPrice: p.unitPrice == null ? null : Number(p.unitPrice), unit: p.unit ?? null };
        byProductId[p.id] = info;
        bySupplierKey[`${id}::${normalize(p.name)}`] = info;
        if (supplier) {
          bySupplierKey[`${normalize(supplier.name)}::${normalize(p.name)}`] = info;
        }
      }
    }

    setPriceIndex({ byProductId, bySupplierKey });
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (!active) return;
        await rebuildPriceIndex(fiche.ingredients);
      } catch {
        if (active) setPriceIndex({ byProductId: {}, bySupplierKey: {} });
      }
    })();
    return () => {
      active = false;
    };
  }, [fiche.ingredients]);

  async function syncFicheFromSuppliers() {
    const ingredients = fiche.ingredients;
    if (ingredients.length === 0) return;

    try {
      setDbBusy(true);
      const suppliersList = await listSuppliers();
      const supplierByName = new Map(suppliersList.map((s) => [normalize(s.name), s]));
      const productsCache = new Map<string, SupplierProduct[]>();

      const updatedIngredients = await Promise.all(
        ingredients.map(async (ing) => {
          const supplier =
            ing.supplierId
              ? suppliersList.find((s) => s.id === ing.supplierId)
              : ing.supplier
                ? supplierByName.get(normalize(ing.supplier))
                : undefined;

          if (!supplier || !ing.name.trim()) return ing;

          if (!productsCache.has(supplier.id)) {
            const items = await listSupplierProducts(supplier.id);
            productsCache.set(supplier.id, items);
          }

          const products = productsCache.get(supplier.id) || [];
          const match = products.find((p) => normalize(p.name) === normalize(ing.name));
          if (!match) return ing;

          return {
            ...ing,
            supplierId: supplier.id,
            supplierProductId: match.id,
          };
        })
      );

      setFiche((prev) => ({
        ...prev,
        ingredients: updatedIngredients,
        updatedAt: new Date().toISOString(),
      }));
      setDbStatus("Prezzi sincronizzati dal listino.");
    } catch {
      setDbStatus("Errore durante la sincronizzazione prezzi.");
    } finally {
      setDbBusy(false);
    }
  }

  async function onOpenSuppliers() {
    try {
      setDbBusy(true);
      const items = await listSuppliers();
      setSuppliers(items);
      setSupplierQuery("");
      setView("suppliers");
      setDbStatus("");
    } catch {
      setDbStatus("Errore nel caricamento fornitori.");
    } finally {
      setDbBusy(false);
    }
  }

  async function onOpenSupplierDetail(supplier: Supplier) {
    try {
      setDbBusy(true);
      const items = (await listSupplierProducts(supplier.id)).sort((a, b) => a.name.localeCompare(b.name));
      setSelectedSupplier(supplier);
      setSupplierProducts(items);
      setSupplierProductEdits(
        Object.fromEntries(
          items.map((p) => [
            p.id,
            {
              unitPrice: p.unitPrice == null ? "" : String(p.unitPrice),
              unit: p.unit ?? "",
            },
          ])
        )
      );
      setNewProductName("");
      setNewProductPrice("");
      setNewProductUnit("");
      setView("supplierDetail");
    } catch {
      setDbStatus("Errore nel caricamento listino.");
    } finally {
      setDbBusy(false);
    }
  }

  async function onAddSupplier() {
    const name = newSupplierName.trim();
    if (!name) return;
    try {
      setDbBusy(true);
      const created = await upsertSupplier(name);
      setSuppliers((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setNewSupplierName("");
    } catch {
      setDbStatus("Errore nel salvataggio fornitore.");
    } finally {
      setDbBusy(false);
    }
  }

  async function onAddSupplierProduct() {
    if (!selectedSupplier) return;
    const name = newProductName.trim();
    if (!name) return;
    const unitPrice = newProductPrice === "" ? null : Number(newProductPrice);
    const unit = newProductUnit || null;
    try {
      setDbBusy(true);
      const created = await upsertSupplierProduct(selectedSupplier.id, name, unitPrice, unit);
      setSupplierProducts((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setSupplierProductEdits((prev) => ({
        ...prev,
        [created.id]: {
          unitPrice: created.unitPrice == null ? "" : String(created.unitPrice),
          unit: created.unit ?? "",
        },
      }));
      setNewProductName("");
      setNewProductPrice("");
      setNewProductUnit("");
    } catch {
      setDbStatus("Errore nel salvataggio prodotto.");
    } finally {
      setDbBusy(false);
    }
  }

  async function onUpdateSupplierProduct(productId: string, unitPrice: number | null, unit: string | null) {
    if (!selectedSupplier) return;
    try {
      setDbBusy(true);
      const updated = await updateSupplierProduct(selectedSupplier.id, productId, unitPrice, unit);
      setSupplierProducts((prev) =>
        prev
          .map((p) => (p.id === productId ? updated : p))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
      setSupplierProductEdits((prev) => ({
        ...prev,
        [productId]: {
          unitPrice: updated.unitPrice == null ? "" : String(updated.unitPrice),
          unit: updated.unit ?? "",
        },
      }));
      await rebuildPriceIndex(fiche.ingredients);
      setDbStatus("Prezzo aggiornato nel listino.");
    } catch {
      setDbStatus("Errore aggiornamento prodotto.");
    } finally {
      setDbBusy(false);
    }
  }

  async function onDeleteSupplierProduct(productId: string) {
    if (!selectedSupplier) return;
    if (!confirm("Eliminare questo prodotto dal listino?")) return;
    try {
      setDbBusy(true);
      await deleteSupplierProduct(selectedSupplier.id, productId);
      setSupplierProducts((prev) => prev.filter((p) => p.id !== productId));
      setSupplierProductEdits((prev) => {
        const next = { ...prev };
        delete next[productId];
        return next;
      });
    } catch {
      setDbStatus("Errore eliminazione prodotto.");
    } finally {
      setDbBusy(false);
    }
  }

  const filteredLibrary = useMemo(() => {
    const q = libraryQuery.trim().toLowerCase();
    if (!q) return library;
    return library.filter((item) => item.title?.toLowerCase().includes(q));
  }, [library, libraryQuery]);

  const filteredSuppliers = useMemo(() => {
    const q = supplierQuery.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter((s) => s.name.toLowerCase().includes(q));
  }, [suppliers, supplierQuery]);

  return (
    <div className="app">
      <header className="topbar no-print">
        <div className="brand">
          <div className="brand-mark">FR</div>
          <div>
            <div className="brand-title">Fiches Recettes</div>
            <div className="brand-sub">Schede tecniche pulite, pronte da stampare.</div>
          </div>
        </div>

        <div className="toolbar">
          <button
            className="btn btn-ghost"
            onClick={() => {
              setFiche(newFiche());
              setView("editor");
              setDbStatus("");
            }}
          >
            Nuova fiche
          </button>

          <button className="btn btn-outline" onClick={() => downloadJson(fiche, `${fileNameBase}.json`)}>
            Esporta JSON
          </button>

          <label className="btn btn-outline file-button">
            <input
              type="file"
              accept="application/json"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onImportJson(f);
                e.currentTarget.value = "";
              }}
            />
            Importa JSON
          </label>

          <button className="btn btn-primary" onClick={() => window.print()}>
            Stampa / Salva PDF
          </button>

          <button className="btn btn-outline" onClick={onExportPdfOneClick}>
            Esporta PDF (1 click)
          </button>

          <button className="btn btn-outline" onClick={onSaveDb} disabled={dbBusy}>
            Salva nel DB
          </button>

          <button className="btn btn-outline" onClick={onOpenLibrary} disabled={dbBusy}>
            Libreria fiches
          </button>

          <button className="btn btn-outline" onClick={onOpenSuppliers} disabled={dbBusy}>
            Fornitori
          </button>
        </div>

        <div className="toolbar-hint">
          Suggerimento: per un PDF con testo selezionabile usa <strong>Stampa / Salva PDF</strong>.
          L&apos;export “1 click” è utile ma spesso rasterizza il contenuto.
        </div>
        {dbStatus ? <div className="toolbar-hint">{dbStatus}</div> : null}
      </header>

      <main className="layout">
        {view === "editor" ? (
          <>
            <section className="editor">
              <FicheForm
                fiche={fiche}
                onChange={setFiche}
                getPriceForIngredient={getPriceForIngredient}
                onPriceIndexRefresh={(ingredients) => rebuildPriceIndex(ingredients ?? fiche.ingredients)}
              />
            </section>

            <section className="preview">
              <div ref={previewRef} className="preview-inner">
                <FichePreview fiche={fiche} getPriceForIngredient={getPriceForIngredient} />
              </div>
            </section>
          </>
        ) : view === "library" ? (
          <section className="library">
            <div className="library-header">
              <div>
                <h2 className="section-title">Libreria fiches</h2>
                <p className="muted">Seleziona una fiche per aprirla nell’editor.</p>
              </div>
              <div className="library-actions">
                <input
                  className="input"
                  placeholder="Cerca per titolo..."
                  value={libraryQuery}
                  onChange={(e) => setLibraryQuery(e.target.value)}
                />
                <button
                  className="btn btn-outline"
                  onClick={async () => {
                    await syncFicheFromSuppliers();
                    setView("editor");
                  }}
                >
                  Torna all’editor
                </button>
              </div>
            </div>

            <div className="library-list">
              {filteredLibrary.length === 0 ? (
                <div className="library-empty">
                  Nessuna fiche trovata. Salva una fiche per vederla qui.
                </div>
              ) : (
                filteredLibrary.map((item) => (
                  <div key={item.id} className="library-card library-card--row">
                    <div>
                      <div className="library-title">{item.title || "Senza titolo"}</div>
                      <div className="library-meta">
                        Aggiornata: {new Date(item.updatedAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="library-actions-inline">
                      <button className="btn btn-outline" onClick={() => onSelectFromLibrary(item)} disabled={dbBusy}>
                        Apri
                      </button>
                      <button className="btn btn-ghost" onClick={() => onDeleteFromLibrary(item)} disabled={dbBusy}>
                        Elimina
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        ) : view === "suppliers" ? (
          <section className="library">
            <div className="library-header">
              <div>
                <h2 className="section-title">Fornitori</h2>
                <p className="muted">Gestisci l’elenco fornitori e apri il loro listino.</p>
              </div>
              <div className="library-actions">
                <input
                  className="input"
                  placeholder="Cerca fornitore..."
                  value={supplierQuery}
                  onChange={(e) => setSupplierQuery(e.target.value)}
                />
                <button
                  className="btn btn-outline"
                  onClick={async () => {
                    await syncFicheFromSuppliers();
                    setView("editor");
                  }}
                >
                  Torna all’editor
                </button>
              </div>
            </div>

            <div className="supplier-add supplier-add--simple">
              <input
                className="input"
                placeholder="Nuovo fornitore..."
                value={newSupplierName}
                onChange={(e) => setNewSupplierName(e.target.value)}
              />
              <button className="btn btn-primary" onClick={onAddSupplier} disabled={dbBusy}>
                Aggiungi fornitore
              </button>
            </div>

            <div className="library-list">
              {filteredSuppliers.length === 0 ? (
                <div className="library-empty">Nessun fornitore trovato.</div>
              ) : (
                filteredSuppliers.map((supplier) => (
                  <button
                    key={supplier.id}
                    className="library-card"
                    onClick={() => onOpenSupplierDetail(supplier)}
                    disabled={dbBusy}
                  >
                    <div className="library-title">{supplier.name}</div>
                    <div className="library-meta">
                      Aggiornato: {new Date(supplier.updatedAt).toLocaleString()}
                    </div>
                  </button>
                ))
              )}
            </div>
          </section>
        ) : (
          <section className="library">
            <div className="library-header">
              <div>
                <h2 className="section-title">Listino fornitore</h2>
                <p className="muted">{selectedSupplier?.name}</p>
              </div>
              <div className="library-actions">
                <button className="btn btn-outline" onClick={() => setView("suppliers")}>
                  Torna ai fornitori
                </button>
              </div>
            </div>

            <div className="supplier-add">
              <input
                className="input"
                placeholder="Prodotto..."
                value={newProductName}
                onChange={(e) => setNewProductName(e.target.value)}
              />
              <input
                className="input input-price"
                type="number"
                min={0}
                step="0.01"
                placeholder="Prezzo unità"
                value={newProductPrice}
                onChange={(e) => setNewProductPrice(e.target.value)}
              />
              <select
                className="input input-unit"
                value={newProductUnit}
                onChange={(e) => setNewProductUnit(e.target.value)}
              >
                <option value="">Unità</option>
                <option value="kg">€/kg</option>
                <option value="g">€/g</option>
                <option value="l">€/l</option>
                <option value="ml">€/ml</option>
                <option value="cl">€/cl</option>
                <option value="pc">€/pz</option>
              </select>
              <button className="btn btn-primary" onClick={onAddSupplierProduct} disabled={dbBusy}>
                Aggiungi prodotto
              </button>
            </div>

            <div className="library-list supplier-products-list">
              {supplierProducts.length === 0 ? (
                <div className="library-empty">Nessun prodotto nel listino.</div>
              ) : (
                supplierProducts.map((product) => (
                  <div key={product.id} className="library-card supplier-product">
                    <div className="supplier-product-name">{product.name}</div>
                    <div className="supplier-product-row">
                      <input
                        className="input input-price"
                        type="number"
                        min={0}
                        step="0.01"
                        value={supplierProductEdits[product.id]?.unitPrice ?? ""}
                        onChange={(e) =>
                          setSupplierProductEdits((prev) => ({
                            ...prev,
                            [product.id]: {
                              unitPrice: e.target.value,
                              unit: prev[product.id]?.unit ?? "",
                            },
                          }))
                        }
                        onBlur={() => {
                          const edit = supplierProductEdits[product.id];
                          const price = edit?.unitPrice === "" ? null : Number(edit?.unitPrice);
                          const unit = edit?.unit ? edit.unit : null;
                          onUpdateSupplierProduct(product.id, price, unit);
                        }}
                        placeholder="Prezzo"
                      />
                      <select
                        className="input input-unit"
                        value={supplierProductEdits[product.id]?.unit ?? ""}
                        onChange={(e) =>
                          setSupplierProductEdits((prev) => ({
                            ...prev,
                            [product.id]: {
                              unitPrice: prev[product.id]?.unitPrice ?? "",
                              unit: e.target.value,
                            },
                          }))
                        }
                        onBlur={() => {
                          const edit = supplierProductEdits[product.id];
                          const price = edit?.unitPrice === "" ? null : Number(edit?.unitPrice);
                          const unit = edit?.unit ? edit.unit : null;
                          onUpdateSupplierProduct(product.id, price, unit);
                        }}
                      >
                        <option value="">Unità</option>
                        <option value="kg">€/kg</option>
                        <option value="g">€/g</option>
                        <option value="l">€/l</option>
                        <option value="ml">€/ml</option>
                        <option value="cl">€/cl</option>
                        <option value="pc">€/pz</option>
                      </select>
                      <button
                        className="btn btn-outline"
                        onClick={() => {
                          const edit = supplierProductEdits[product.id];
                          const price = edit?.unitPrice === "" ? null : Number(edit?.unitPrice);
                          const unit = edit?.unit ? edit.unit : null;
                          onUpdateSupplierProduct(product.id, price, unit);
                        }}
                        disabled={dbBusy}
                      >
                        Salva
                      </button>
                      <button
                        className="btn btn-ghost"
                        onClick={() => onDeleteSupplierProduct(product.id)}
                        disabled={dbBusy}
                      >
                        Elimina
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
