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
import { parseSupplierCsv, type SupplierCsvItem } from "./utils/csvImport";
import {
  listSuppliers,
  listSupplierProducts,
  type Supplier,
  type SupplierProduct,
  upsertSupplier,
  upsertSupplierProduct,
  updateSupplierProduct,
  renameSupplier,
  renameSupplierProduct,
  deleteSupplier,
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
  const importInputRef = useRef<HTMLInputElement>(null);
  const [dbStatus, setDbStatus] = useState<string>("");
  const [dbBusy, setDbBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importStatus, setImportStatus] = useState("");
  const [view, setView] = useState<"editor" | "library" | "suppliers" | "supplierDetail">("editor");
  const [library, setLibrary] = useState<FicheListItem[]>([]);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierQuery, setSupplierQuery] = useState("");
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [supplierProducts, setSupplierProducts] = useState<SupplierProduct[]>([]);
  const [supplierProductEdits, setSupplierProductEdits] = useState<
    Record<string, { name: string; unitPrice: string; unit: string }>
  >({});
  const [newSupplierName, setNewSupplierName] = useState("");
  const [supplierNameEdit, setSupplierNameEdit] = useState("");
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
      .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
      .replace(/\s+/g, " ");

  const looksSimilar = (candidateRaw: string, existingRaw: string) => {
    const candidate = normalize(candidateRaw);
    const existing = normalize(existingRaw);
    if (!candidate || !existing) return false;
    if (candidate === existing) return false;

    const hasMeaning = (value: string) => value.length >= 4;
    if (!hasMeaning(candidate) || !hasMeaning(existing)) return false;

    const candidateRegex = new RegExp(`\\b${candidate}\\b`, "i");
    const existingRegex = new RegExp(`\\b${existing}\\b`, "i");
    if (candidateRegex.test(existing) || existingRegex.test(candidate)) return true;

    const candidateParts = candidate.split(" ").filter((p) => p.length >= 4);
    const existingParts = existing.split(" ").filter((p) => p.length >= 4);
    for (const part of candidateParts) {
      const partRegex = new RegExp(`\\b${part}\\b`, "i");
      if (partRegex.test(existing)) return true;
    }
    for (const part of existingParts) {
      const partRegex = new RegExp(`\\b${part}\\b`, "i");
      if (partRegex.test(candidate)) return true;
    }

    return false;
  };

  const readFileText = async (file: File) => {
    const buffer = await file.arrayBuffer();
    const utf8 = new TextDecoder("utf-8").decode(buffer);
    if (/Ã.|â‚¬/.test(utf8)) {
      try {
        return new TextDecoder("windows-1252").decode(buffer);
      } catch {
        return utf8;
      }
    }
    return utf8;
  };

  async function onImportSupplierCsv(files: FileList | null) {
    if (!files || files.length === 0) return;

    try {
      setImportBusy(true);
      setImportStatus("Import in corso...");
      setDbStatus("");

      const existingSuppliers = await listSuppliers();
      const suppliersByKey = new Map<string, Supplier>();
      for (const s of existingSuppliers) {
        suppliersByKey.set(normalize(s.name), s);
      }

      const allItems: SupplierCsvItem[] = [];
      for (const file of Array.from(files)) {
        const text = await readFileText(file);
        allItems.push(...parseSupplierCsv(text));
      }

      if (allItems.length === 0) {
        setImportStatus("Nessuna riga valida trovata nei CSV.");
        return;
      }

      const deduped = new Map<string, SupplierCsvItem>();
      for (const item of allItems) {
        const key = `${normalize(item.supplier)}::${normalize(item.product)}`;
        deduped.set(key, item);
      }
      const uniqueItems = Array.from(deduped.values());

      const uniqueSuppliers = Array.from(
        new Set(uniqueItems.map((item) => item.supplier.trim()).filter(Boolean))
      );

      const supplierImportCount = new Map<string, number>();
      for (const item of uniqueItems) {
        const key = normalize(item.supplier);
        supplierImportCount.set(key, (supplierImportCount.get(key) ?? 0) + 1);
      }

      const supplierMap = new Map<string, Supplier>();
      const supplierChoice = new Map<string, Supplier | null>();
      let supplierApplyAll: boolean | null = null;
      let supplierApplyAllLabel = "";

      for (const name of uniqueSuppliers) {
        const key = normalize(name);
        const existing = suppliersByKey.get(key);
        if (existing) {
          supplierMap.set(key, existing);
          continue;
        }

        let similar: Supplier | null = null;
        for (const candidate of existingSuppliers) {
          if (looksSimilar(name, candidate.name)) {
            similar = candidate;
            break;
          }
        }

        if (similar) {
          if (!supplierChoice.has(key)) {
            let useExisting: boolean;
            if (supplierApplyAll !== null) {
              useExisting = supplierApplyAll;
            } else {
              const count = supplierImportCount.get(key) ?? 0;
              useExisting = window.confirm(
                `[FORNITORI]\n` +
                  `È stato rilevato un fornitore simile già esistente.\n` +
                  `Esistente: "${similar.name}"\nImport: "${name}"\n` +
                  `Righe importate per questo fornitore: ${count}\n\n` +
                  `OK = importa nel fornitore esistente\nAnnulla = crea un nuovo fornitore`
              );
              const applyAll = window.confirm(
                `[FORNITORI]\n` +
                  `Vuoi applicare questa scelta a tutti i fornitori simili di questo import?\n` +
                  `OK = sì, applica a tutti i fornitori\nAnnulla = chiedi caso per caso`
              );
              if (applyAll) {
                supplierApplyAll = useExisting;
                supplierApplyAllLabel = useExisting
                  ? "Fornitori simili: usa esistenti per tutto l'import."
                  : "Fornitori simili: crea nuovi per tutto l'import.";
              }
            }
            supplierChoice.set(key, useExisting ? similar : null);
          }
          const chosen = supplierChoice.get(key);
          if (chosen) {
            supplierMap.set(key, chosen);
            continue;
          }
        }

        const created = await upsertSupplier(name);
        supplierMap.set(key, created);
        supplierMap.set(normalize(created.name), created);
      }

      const productsCache = new Map<string, SupplierProduct[]>();
      const productChoice = new Map<string, { useExisting: boolean; existingName?: string }>();
      let productApplyAll: boolean | null = null;
      let productApplyAllLabel = "";

      let imported = 0;
      for (const item of uniqueItems) {
        const supplierKey = normalize(item.supplier);
        const supplier = supplierMap.get(supplierKey);
        if (!supplier) continue;

        if (!productsCache.has(supplier.id)) {
          const products = await listSupplierProducts(supplier.id);
          productsCache.set(supplier.id, products);
        }

        const existingProducts = productsCache.get(supplier.id) || [];
        const productKey = normalize(item.product);
        const existingProduct = existingProducts.find((p) => normalize(p.name) === productKey);

        let productNameToUse = item.product;
        if (existingProduct && existingProduct.name !== item.product) {
          // Case-insensitive exact match: merge automatically
          productNameToUse = existingProduct.name;
        } else {
          let similarProduct: SupplierProduct | undefined;
          for (const p of existingProducts) {
            if (looksSimilar(item.product, p.name)) {
              similarProduct = p;
              break;
            }
          }

          if (similarProduct) {
            const choiceKey = `${supplier.id}::${productKey}`;
            if (!productChoice.has(choiceKey)) {
              let useExisting: boolean;
              if (productApplyAll !== null) {
                useExisting = productApplyAll;
              } else {
                useExisting = window.confirm(
                  `[PRODOTTI]\n` +
                    `È stato rilevato un prodotto simile già esistente per "${supplier.name}".\n` +
                    `Esistente: "${similarProduct.name}"\nImport: "${item.product}"\n` +
                    `Prezzo import: ${item.unitPrice ?? "-"} ${item.unit ?? ""}\n\n` +
                    `OK = aggiorna il prodotto esistente\nAnnulla = crea un nuovo prodotto`
                );
                const applyAll = window.confirm(
                  `[PRODOTTI]\n` +
                    `Vuoi applicare questa scelta a tutti i prodotti simili di questo import?\n` +
                    `OK = sì, applica a tutti i prodotti\nAnnulla = chiedi caso per caso`
                );
                if (applyAll) {
                  productApplyAll = useExisting;
                  productApplyAllLabel = useExisting
                    ? "Prodotti simili: aggiorna esistenti per tutto l'import."
                    : "Prodotti simili: crea nuovi per tutto l'import.";
                }
              }
              productChoice.set(choiceKey, {
                useExisting,
                existingName: similarProduct.name,
              });
            }
            const choice = productChoice.get(choiceKey);
            if (choice?.useExisting && choice.existingName) {
              productNameToUse = choice.existingName;
            }
          }
        }

        const created = await upsertSupplierProduct(
          supplier.id,
          productNameToUse,
          item.unitPrice,
          item.unit
        );
        if (created && productsCache.has(supplier.id)) {
          const list = productsCache.get(supplier.id) || [];
          const next = list.filter((p) => p.id !== created.id);
          next.push(created);
          productsCache.set(supplier.id, next);
        }
        imported += 1;
      }

      const updatedSuppliers = await listSuppliers();
      setSuppliers(updatedSuppliers);
      if (view === "supplierDetail" && selectedSupplier) {
        const match =
          updatedSuppliers.find((s) => s.id === selectedSupplier.id) ||
          updatedSuppliers.find((s) => normalize(s.name) === normalize(selectedSupplier.name));
        if (match) {
          await onOpenSupplierDetail(match);
        }
      }

      const extraNotes = [supplierApplyAllLabel, productApplyAllLabel].filter(Boolean).join(" ");
      const suffix = extraNotes ? ` ${extraNotes}` : "";
      setImportStatus(`Import completato: ${imported} prodotti (${uniqueSuppliers.length} fornitori).${suffix}`);
    } catch {
      setImportStatus("Errore durante l'import CSV.");
    } finally {
      setImportBusy(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

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
      setSupplierNameEdit(supplier.name);
      setSupplierProducts(items);
      setSupplierProductEdits(
        Object.fromEntries(
          items.map((p) => [
            p.id,
            {
              name: p.name,
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

  async function onDeleteSupplier(supplier: Supplier) {
    if (!confirm(`Eliminare il fornitore "${supplier.name}" e tutto il suo listino?`)) return;
    try {
      setDbBusy(true);
      await deleteSupplier(supplier.id);
      setSuppliers((prev) => prev.filter((s) => s.id !== supplier.id));
      if (selectedSupplier?.id === supplier.id) {
        setSelectedSupplier(null);
        setSupplierProducts([]);
        setView("suppliers");
      }
      setDbStatus("Fornitore eliminato.");
    } catch {
      setDbStatus("Errore eliminazione fornitore.");
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
          name: created.name,
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
          name: updated.name,
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

  async function onRenameSupplier(nextName: string) {
    if (!selectedSupplier) return;
    const name = nextName.trim();
    if (!name || name === selectedSupplier.name) return;
    try {
      setDbBusy(true);
      const updated = await renameSupplier(selectedSupplier.id, name);
      setSelectedSupplier(updated);
      setSuppliers((prev) =>
        prev
          .map((s) => (s.id === updated.id ? updated : s))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
      setDbStatus("Fornitore rinominato.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setDbStatus(message || "Errore rinomina fornitore.");
      setSupplierNameEdit(selectedSupplier.name);
    } finally {
      setDbBusy(false);
    }
  }

  async function onRenameSupplierProduct(productId: string, nextName: string) {
    if (!selectedSupplier) return;
    const name = nextName.trim();
    if (!name) return;
    const current = supplierProducts.find((p) => p.id === productId);
    if (!current || current.name === name) return;
    try {
      setDbBusy(true);
      const updated = await renameSupplierProduct(selectedSupplier.id, productId, name);
      setSupplierProducts((prev) =>
        prev
          .map((p) => (p.id === productId ? updated : p))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
      setSupplierProductEdits((prev) => ({
        ...prev,
        [productId]: {
          name: updated.name,
          unitPrice: updated.unitPrice == null ? "" : String(updated.unitPrice),
          unit: updated.unit ?? "",
        },
      }));
      await rebuildPriceIndex(fiche.ingredients);
      setDbStatus("Prodotto rinominato.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setDbStatus(message || "Errore rinomina prodotto.");
      setSupplierProductEdits((prev) => ({
        ...prev,
        [productId]: {
          name: current?.name ?? prev[productId]?.name ?? "",
          unitPrice: prev[productId]?.unitPrice ?? "",
          unit: prev[productId]?.unit ?? "",
        },
      }));
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

        {view === "editor" ? (
  <div className="toolbar-hint">
          Suggerimento: per un PDF con testo selezionabile usa <strong>Stampa / Salva PDF</strong>.
          L&apos;export “1 click” è utile ma spesso rasterizza il contenuto.
        </div>
) : null}
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
                  disabled={importBusy}
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
                <label className="btn btn-outline file-button">
                  <input
                    ref={importInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    multiple
                    disabled={dbBusy || importBusy}
                    onChange={(e) => onImportSupplierCsv(e.target.files)}
                  />
                  Importa CSV
                </label>
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

            {importStatus ? <div className="toolbar-hint">{importStatus}</div> : null}

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
                  <div key={supplier.id} className="library-card library-card--row">
                    <button
                      className="library-card-content"
                      onClick={() => onOpenSupplierDetail(supplier)}
                      disabled={dbBusy}
                    >
                      <div className="library-title">{supplier.name}</div>
                      <div className="library-meta">
                        Aggiornato: {new Date(supplier.updatedAt).toLocaleString()}
                      </div>
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => onDeleteSupplier(supplier)}
                      disabled={dbBusy}
                    >
                      Elimina
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        ) : (
          <section className="library">
            <div className="library-header">
              <div>
                <h2 className="section-title">Listino fornitore</h2>
                <div className="supplier-title-row">
                  <input
                    className="input"
                    value={supplierNameEdit}
                    onChange={(e) => setSupplierNameEdit(e.target.value)}
                    onBlur={() => onRenameSupplier(supplierNameEdit)}
                    placeholder="Nome fornitore"
                    disabled={dbBusy}
                  />
                  <button
                    className="btn btn-outline"
                    onClick={() => onRenameSupplier(supplierNameEdit)}
                    disabled={dbBusy}
                  >
                    Salva nome
                  </button>
                </div>
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
                    <input
                      className="input supplier-product-name-input"
                      value={supplierProductEdits[product.id]?.name ?? product.name}
                      onChange={(e) =>
                        setSupplierProductEdits((prev) => ({
                          ...prev,
                          [product.id]: {
                            name: e.target.value,
                            unitPrice: prev[product.id]?.unitPrice ?? "",
                            unit: prev[product.id]?.unit ?? "",
                          },
                        }))
                      }
                      onBlur={(e) => onRenameSupplierProduct(product.id, e.target.value)}
                      disabled={dbBusy}
                    />
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
                              name: prev[product.id]?.name ?? product.name,
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
                              name: prev[product.id]?.name ?? product.name,
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
                          if (edit?.name && edit.name !== product.name) {
                            onRenameSupplierProduct(product.id, edit.name);
                          }
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
