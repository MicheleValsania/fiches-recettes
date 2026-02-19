import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./App.css";
import "./print.css";

import type { FicheTechnique } from "./types/fiche";
import FicheForm from "./components/FicheForm";
import FichePreview from "./components/FichePreview";
import { getInitialLang, LANG_STORAGE_KEY, localeByLang, t, type Lang } from "./i18n";
import { downloadBlob, downloadJson, readJsonFile, safeFilename } from "./utils/exporters";
import { exportElementToA4Pdf, exportSupplierOrderListPdf, renderElementToA4PdfBlob } from "./utils/pdf";
import { createZipBlob } from "./utils/zip";
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
type PriceMatch = { unitPrice: number | null; unit: string | null };
type PriceIndex = {
  byProductId: Record<string, PriceMatch>;
  bySupplierKey: Record<string, PriceMatch>;
};

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
  const [lang, setLang] = useState<Lang>(() => getInitialLang());
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
  const lastDbSnapshotRef = useRef<string>(JSON.stringify(fiche));

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fiche));
  }, [fiche]);

  useEffect(() => {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  }, [lang]);

  const previewRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const librarySearchRef = useRef<HTMLInputElement>(null);
  const supplierSearchRef = useRef<HTMLInputElement>(null);
  const productsSearchRef = useRef<HTMLInputElement>(null);
  const supplierProductsSearchRef = useRef<HTMLInputElement>(null);
  const [dbStatus, setDbStatus] = useState<string>("");
  const [dbBusy, setDbBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importStatus, setImportStatus] = useState("");
  const [view, setView] = useState<"editor" | "library" | "suppliers" | "supplierDetail" | "products">("editor");
  const [library, setLibrary] = useState<FicheListItem[]>([]);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryCategoryQuery, setLibraryCategoryQuery] = useState("");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierQuery, setSupplierQuery] = useState("");
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [supplierProducts, setSupplierProducts] = useState<SupplierProduct[]>([]);
  const [supplierProductEdits, setSupplierProductEdits] = useState<
    Record<
      string,
      { name: string; supplierCode: string; sourcePrice: string; sourceUnit: string; unitPrice: string; unit: string }
    >
  >({});
  const [newSupplierName, setNewSupplierName] = useState("");
  const [supplierNameEdit, setSupplierNameEdit] = useState("");
  const [newProductName, setNewProductName] = useState("");
  const [newProductCode, setNewProductCode] = useState("");
  const [newProductSourcePrice, setNewProductSourcePrice] = useState("");
  const [newProductSourceUnit, setNewProductSourceUnit] = useState("");
  const [newProductPrice, setNewProductPrice] = useState("");
  const [newProductUnit, setNewProductUnit] = useState("");
  const [supplierProductQuery, setSupplierProductQuery] = useState("");
  const [allProducts, setAllProducts] = useState<
    Array<{
      id: string;
      name: string;
      supplierId: string;
      supplierName: string;
      unitPrice: number | null;
      unit: string | null;
      updatedAt: string;
    }>
  >([]);
  const [allProductsQuery, setAllProductsQuery] = useState("");
  const [priceIndex, setPriceIndex] = useState<PriceIndex>({ byProductId: {}, bySupplierKey: {} });

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isEditable =
        tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!dbBusy) onSaveDb();
        return;
      }

      if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (isEditable) return;
        event.preventDefault();
        if (view === "library") librarySearchRef.current?.focus();
        else if (view === "suppliers") supplierSearchRef.current?.focus();
        else if (view === "products") productsSearchRef.current?.focus();
        else if (view === "supplierDetail") supplierProductsSearchRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dbBusy, view]);

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
      alert(t(lang, "app.invalidJson"));
    }
  }

  async function onExportPdfOneClick() {
    if (!previewRef.current) return;
    await exportElementToA4Pdf(previewRef.current, `${fileNameBase}.pdf`);
  }

  async function onExportSupplierOrderPdf() {
    if (!selectedSupplier) return;
    if (supplierProducts.length === 0) {
      setDbStatus(t(lang, "status.noSupplierProductsToExport"));
      return;
    }
    try {
      setDbBusy(true);
      const fileBase = safeFilename(`${selectedSupplier.name || "supplier"}-lista-ordine`);
      const labels = {
        title: t(lang, "app.supplierOrderPdfTitle"),
        code: t(lang, "app.supplierOrderPdfColCode"),
        name: t(lang, "app.supplierOrderPdfColName"),
        residual: t(lang, "app.supplierOrderPdfColResidual"),
        toOrder: t(lang, "app.supplierOrderPdfColToOrder"),
      };
      const meta = `${selectedSupplier.name || "-"} - ${new Date().toLocaleDateString(locale)}`;
      await exportSupplierOrderListPdf(
        supplierProducts.map((product) => ({
          code: product.supplierCode || "",
          name: product.name || "",
        })),
        labels,
        meta,
        `${fileBase}.pdf`
      );
      setDbStatus(t(lang, "status.supplierOrderPdfExported", { count: supplierProducts.length }));
    } catch {
      setDbStatus(t(lang, "status.supplierOrderPdfExportError"));
    } finally {
      setDbBusy(false);
    }
  }

  async function onSaveDb() {
    try {
      setDbBusy(true);
      await saveFicheToDb(fiche);
      lastDbSnapshotRef.current = JSON.stringify(fiche);
      setDbStatus(t(lang, "status.savedDb"));
    } catch {
      setDbStatus(t(lang, "status.dbServerError"));
    } finally {
      setDbBusy(false);
    }
  }

  async function onOpenLibrary() {
    try {
      setDbBusy(true);
      const canLeave = await autoSaveBeforeLeave();
      if (!canLeave) return;
      const items = await listFichesFromDb();
      setLibrary(items);
      setView("library");
      setDbStatus("");
    } catch {
      setDbStatus(t(lang, "status.libraryLoadError"));
    } finally {
      setDbBusy(false);
    }
  }

  async function onSelectFromLibrary(item: FicheListItem) {
    try {
      setDbBusy(true);
      const loaded = await loadFicheFromDb(item.id);
      const merged = { ...newFiche(), ...loaded, updatedAt: new Date().toISOString() };
      setFiche(merged);
      lastDbSnapshotRef.current = JSON.stringify(merged);
      setView("editor");
      setDbStatus(t(lang, "status.ficheLoaded"));
    } catch {
      setDbStatus(t(lang, "status.ficheLoadError"));
    } finally {
      setDbBusy(false);
    }
  }

  async function onDeleteFromLibrary(item: FicheListItem) {
    if (!confirm(t(lang, "confirm.deleteFiche", { title: item.title || t(lang, "app.untitled") }))) return;
    try {
      setDbBusy(true);
      await deleteFicheFromDb(item.id);
      setLibrary((prev) => prev.filter((f) => f.id !== item.id));
    } catch {
      setDbStatus(t(lang, "status.deleteFicheError"));
    } finally {
      setDbBusy(false);
    }
  }

  async function onExportAllFiches() {
    try {
      setDbBusy(true);
      const items = library.length > 0 ? library : await listFichesFromDb();
      if (items.length === 0) {
        setDbStatus(t(lang, "status.noFicheToExport"));
        return;
      }

      const loaded = await Promise.all(
        items.map(async (item) => {
          try {
            return await loadFicheFromDb(item.id);
          } catch {
            return null;
          }
        })
      );
      const fiches = loaded.filter((item): item is FicheTechnique => item !== null);

      if (fiches.length === 0) {
        setDbStatus(t(lang, "status.noFicheLoadable"));
        return;
      }

      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      downloadJson(
        {
          exportedAt: new Date().toISOString(),
          count: fiches.length,
          fiches,
        },
        `fiches-techniques-${stamp}.json`
      );
      setDbStatus(t(lang, "status.exportedAllJson", { count: fiches.length }));
    } catch {
      setDbStatus(t(lang, "status.exportAllError"));
    } finally {
      setDbBusy(false);
    }
  }

  async function onExportAllFichesPdfZip() {
    try {
      setDbBusy(true);
      const items = library.length > 0 ? library : await listFichesFromDb();
      if (items.length === 0) {
        setDbStatus(t(lang, "status.noFicheToExport"));
        return;
      }

      const loaded = await Promise.all(
        items.map(async (item) => {
          try {
            return await loadFicheFromDb(item.id);
          } catch {
            return null;
          }
        })
      );
      const fiches = loaded.filter((item): item is FicheTechnique => item !== null);
      if (fiches.length === 0) {
        setDbStatus(t(lang, "status.noFicheLoadable"));
        return;
      }

      const files: Array<{ name: string; data: Blob }> = [];
      const usedNames = new Set<string>();

      for (let i = 0; i < fiches.length; i += 1) {
        const current = fiches[i];
        setDbStatus(t(lang, "status.exportPdfProgress", { current: i + 1, total: fiches.length }));

        const wrapper = document.createElement("div");
        wrapper.style.position = "fixed";
        wrapper.style.left = "-99999px";
        wrapper.style.top = "0";
        wrapper.style.width = "210mm";
        wrapper.style.backgroundColor = "#ffffff";
        document.body.appendChild(wrapper);
        const root = createRoot(wrapper);

        try {
          const localPriceIndex = await buildPriceIndexForIngredients(current.ingredients);
          const getLocalPrice = (ing: FicheTechnique["ingredients"][number]) =>
            getPriceForIngredientFromIndex(localPriceIndex, ing);

          root.render(
            <div className="preview-inner">
              <FichePreview fiche={current} lang={lang} getPriceForIngredient={getLocalPrice} />
            </div>
          );

          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          });

          const renderTarget = wrapper.querySelector(".preview-inner");
          if (!renderTarget || !(renderTarget instanceof HTMLElement)) continue;

          const pdfBlob = await renderElementToA4PdfBlob(renderTarget);
          const baseRaw = current.title?.trim() ? current.title : `fiche-${i + 1}`;
          const baseSafe = safeFilename(baseRaw) || `fiche-${i + 1}`;
          let fileName = `${baseSafe}.pdf`;
          if (usedNames.has(fileName)) {
            let suffix = 2;
            while (usedNames.has(`${baseSafe}-${suffix}.pdf`)) suffix += 1;
            fileName = `${baseSafe}-${suffix}.pdf`;
          }
          usedNames.add(fileName);
          files.push({ name: fileName, data: pdfBlob });
        } catch {
          // Continua l'export sulle altre fiches.
        } finally {
          root.unmount();
          wrapper.remove();
        }
      }

      if (files.length === 0) {
        setDbStatus(t(lang, "status.exportPdfNone"));
        return;
      }

      setDbStatus(t(lang, "status.zipCreating"));
      const zipBlob = await createZipBlob(files);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      downloadBlob(zipBlob, `fiches-techniques-pdf-${stamp}.zip`);
      setDbStatus(t(lang, "status.exportedPdfZip", { count: files.length }));
    } catch {
      setDbStatus(t(lang, "status.exportPdfZipError"));
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
      setImportStatus(t(lang, "status.importRunning"));
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
        setImportStatus(t(lang, "status.importNoValidRows"));
        return;
      }

      const deduped = new Map<string, SupplierCsvItem>();
      for (const item of allItems) {
        const key = `${normalize(item.supplier)}::${normalize(item.product)}`;
        const previous = deduped.get(key);
        if (!previous) {
          deduped.set(key, item);
          continue;
        }
        deduped.set(key, {
          supplier: previous.supplier,
          product: previous.product,
          supplierCode: item.supplierCode ?? previous.supplierCode,
          sourcePrice: item.sourcePrice ?? previous.sourcePrice,
          sourceUnit: item.sourceUnit ?? previous.sourceUnit,
          unitPrice: item.unitPrice ?? previous.unitPrice,
          unit: item.unit ?? previous.unit,
        });
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
                t(lang, "confirm.importSupplierSimilar", {
                  existing: similar.name,
                  incoming: name,
                  count,
                })
              );
              const applyAll = window.confirm(
                t(lang, "confirm.importSupplierApplyAll")
              );
              if (applyAll) {
                supplierApplyAll = useExisting;
                supplierApplyAllLabel = useExisting
                  ? t(lang, "status.importSupplierUseExistingAll")
                  : t(lang, "status.importSupplierCreateAll");
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
                  t(lang, "confirm.importProductSimilar", {
                    supplier: supplier.name,
                    existing: similarProduct.name,
                    incoming: item.product,
                    price: item.unitPrice ?? "-",
                    unit: item.unit ?? "",
                  })
                );
                const applyAll = window.confirm(
                  t(lang, "confirm.importProductApplyAll")
                );
                if (applyAll) {
                  productApplyAll = useExisting;
                  productApplyAllLabel = useExisting
                    ? t(lang, "status.importProductUpdateAll")
                    : t(lang, "status.importProductCreateAll");
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

        const existingByName = existingProducts.find(
          (p) => normalize(p.name) === normalize(productNameToUse)
        );
        const supplierCode = item.supplierCode ?? existingByName?.supplierCode ?? null;
        const sourcePrice = item.sourcePrice ?? (existingByName?.sourcePrice == null
          ? null
          : Number(existingByName.sourcePrice));
        const sourceUnit = item.sourceUnit ?? existingByName?.sourceUnit ?? null;
        const unitPrice = item.unitPrice ?? (existingByName?.unitPrice == null
          ? null
          : Number(existingByName.unitPrice));
        const unit = item.unit ?? existingByName?.unit ?? null;

        const created = await upsertSupplierProduct(
          supplier.id,
          productNameToUse,
          supplierCode,
          sourcePrice,
          sourceUnit,
          unitPrice,
          unit
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
      setImportStatus(
        t(lang, "status.importDone", {
          imported,
          suppliers: uniqueSuppliers.length,
          suffix,
        })
      );
    } catch {
      setImportStatus(t(lang, "status.importError"));
    } finally {
      setImportBusy(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  const getPriceForIngredientFromIndex = (
    index: PriceIndex,
    ing: FicheTechnique["ingredients"][number]
  ): PriceMatch | null => {
    if (ing.supplierProductId && index.byProductId[ing.supplierProductId]) {
      return index.byProductId[ing.supplierProductId];
    }
    if (ing.supplierId) {
      const key = `${ing.supplierId}::${normalize(ing.name)}`;
      return index.bySupplierKey[key] || null;
    }
    if (ing.supplier) {
      const key = `${normalize(ing.supplier)}::${normalize(ing.name)}`;
      return index.bySupplierKey[key] || null;
    }
    return null;
  };

  const getPriceForIngredient = (ing: FicheTechnique["ingredients"][number]) =>
    getPriceForIngredientFromIndex(priceIndex, ing);

  const buildPriceIndexForIngredients = async (
    ingredients: FicheTechnique["ingredients"]
  ): Promise<PriceIndex> => {
    const supplierIds = new Set<string>();
    const supplierNames = new Set<string>();
    for (const ing of ingredients) {
      if (ing.supplierId) supplierIds.add(ing.supplierId);
      else if (ing.supplier?.trim()) supplierNames.add(normalize(ing.supplier));
    }

    if (supplierIds.size === 0 && supplierNames.size === 0) {
      return { byProductId: {}, bySupplierKey: {} };
    }

    const suppliersList = await listSuppliers();
    const suppliersByName = new Map(suppliersList.map((s) => [normalize(s.name), s]));
    for (const name of supplierNames) {
      const match = suppliersByName.get(name);
      if (match) supplierIds.add(match.id);
    }

    const byProductId: Record<string, PriceMatch> = {};
    const bySupplierKey: Record<string, PriceMatch> = {};

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

    return { byProductId, bySupplierKey };
  };

  const rebuildPriceIndex = async (ingredients: FicheTechnique["ingredients"]) => {
    const next = await buildPriceIndexForIngredients(ingredients);
    setPriceIndex(next);
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
      setDbStatus(t(lang, "status.syncPricesDone"));
    } catch {
      setDbStatus(t(lang, "status.syncPricesError"));
    } finally {
      setDbBusy(false);
    }
  }

  async function onOpenSuppliers() {
    try {
      setDbBusy(true);
      const canLeave = await autoSaveBeforeLeave();
      if (!canLeave) return;
      const items = await listSuppliers();
      setSuppliers(items);
      setSupplierQuery("");
      setView("suppliers");
      setDbStatus("");
    } catch {
      setDbStatus(t(lang, "status.suppliersLoadError"));
    } finally {
      setDbBusy(false);
    }
  }

  async function onOpenProducts() {
    try {
      setDbBusy(true);
      const canLeave = await autoSaveBeforeLeave();
      if (!canLeave) return;
      const items = await listSuppliers();
      const products = await Promise.all(items.map((s) => listSupplierProducts(s.id)));
      const flat = items.flatMap((s, idx) =>
        products[idx].map((p) => ({
          id: p.id,
          name: p.name,
          supplierId: p.supplierId,
          supplierName: s.name,
          unitPrice: p.unitPrice == null ? null : Number(p.unitPrice),
          unit: p.unit ?? null,
          updatedAt: p.updatedAt,
        }))
      );
      flat.sort((a, b) => {
        const nameCmp = a.name.localeCompare(b.name);
        if (nameCmp !== 0) return nameCmp;
        return a.supplierName.localeCompare(b.supplierName);
      });
      setAllProducts(flat);
      setAllProductsQuery("");
      setView("products");
      setDbStatus("");
    } catch {
      setDbStatus(t(lang, "status.productsLoadError"));
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
              supplierCode: p.supplierCode ?? "",
              sourcePrice: p.sourcePrice == null ? "" : String(p.sourcePrice),
              sourceUnit: p.sourceUnit ?? "",
              unitPrice: p.unitPrice == null ? "" : String(p.unitPrice),
              unit: p.unit ?? "",
            },
            ])
          )
        );
        setNewProductName("");
        setNewProductCode("");
        setNewProductSourcePrice("");
        setNewProductSourceUnit("");
        setNewProductPrice("");
        setNewProductUnit("");
        setSupplierProductQuery("");
        setView("supplierDetail");
      } catch {
        setDbStatus(t(lang, "status.supplierListLoadError"));
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
      setDbStatus(t(lang, "status.supplierSaveError"));
    } finally {
      setDbBusy(false);
    }
  }

  async function onDeleteSupplier(supplier: Supplier) {
    if (!confirm(t(lang, "confirm.deleteSupplier", { name: supplier.name }))) return;
    try {
      setDbBusy(true);
      await deleteSupplier(supplier.id);
      setSuppliers((prev) => prev.filter((s) => s.id !== supplier.id));
      if (selectedSupplier?.id === supplier.id) {
        setSelectedSupplier(null);
        setSupplierProducts([]);
        setView("suppliers");
      }
      setDbStatus(t(lang, "status.supplierDeleted"));
    } catch {
      setDbStatus(t(lang, "status.supplierDeleteError"));
    } finally {
      setDbBusy(false);
    }
  }

  async function onAddSupplierProduct() {
    if (!selectedSupplier) return;
    const name = newProductName.trim();
    if (!name) return;
    const supplierCode = newProductCode.trim() || null;
    const sourcePrice = newProductSourcePrice === "" ? null : Number(newProductSourcePrice);
    const sourceUnit = newProductSourceUnit || null;
    const unitPrice = newProductPrice === "" ? null : Number(newProductPrice);
    const unit = newProductUnit || null;
    try {
      setDbBusy(true);
      const created = await upsertSupplierProduct(
        selectedSupplier.id,
        name,
        supplierCode,
        sourcePrice,
        sourceUnit,
        unitPrice,
        unit
      );
      setSupplierProducts((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setSupplierProductEdits((prev) => ({
        ...prev,
        [created.id]: {
          name: created.name,
          supplierCode: created.supplierCode ?? "",
          sourcePrice: created.sourcePrice == null ? "" : String(created.sourcePrice),
          sourceUnit: created.sourceUnit ?? "",
          unitPrice: created.unitPrice == null ? "" : String(created.unitPrice),
          unit: created.unit ?? "",
        },
      }));
      setNewProductName("");
      setNewProductCode("");
      setNewProductSourcePrice("");
      setNewProductSourceUnit("");
      setNewProductPrice("");
      setNewProductUnit("");
    } catch {
      setDbStatus(t(lang, "status.productSaveError"));
    } finally {
      setDbBusy(false);
    }
  }

  async function onUpdateSupplierProduct(
    productId: string,
    supplierCode: string | null,
    sourcePrice: number | null,
    sourceUnit: string | null,
    unitPrice: number | null,
    unit: string | null
  ) {
    if (!selectedSupplier) return;
    try {
      setDbBusy(true);
      const updated = await updateSupplierProduct(
        selectedSupplier.id,
        productId,
        supplierCode,
        sourcePrice,
        sourceUnit,
        unitPrice,
        unit
      );
      setSupplierProducts((prev) =>
        prev
          .map((p) => (p.id === productId ? updated : p))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
      setSupplierProductEdits((prev) => ({
        ...prev,
        [productId]: {
          name: prev[productId]?.name ?? updated.name,
          supplierCode: updated.supplierCode ?? "",
          sourcePrice: updated.sourcePrice == null ? "" : String(updated.sourcePrice),
          sourceUnit: updated.sourceUnit ?? "",
          unitPrice: updated.unitPrice == null ? "" : String(updated.unitPrice),
          unit: updated.unit ?? "",
        },
      }));
      await rebuildPriceIndex(fiche.ingredients);
      setDbStatus(t(lang, "status.productPriceUpdated"));
    } catch {
      setDbStatus(t(lang, "status.productUpdateError"));
    } finally {
      setDbBusy(false);
    }
  }

  async function onSaveSupplierProduct(product: SupplierProduct) {
    const edit = supplierProductEdits[product.id];
    const nextName = (edit?.name ?? product.name).trim();
    const nextSupplierCode = (edit?.supplierCode ?? product.supplierCode ?? "").trim() || null;
    const nextSourcePrice =
      edit?.sourcePrice == null || edit.sourcePrice === "" ? null : Number(edit.sourcePrice);
    const nextSourceUnit = edit?.sourceUnit ? edit.sourceUnit : null;
    const nextUnitPrice =
      edit?.unitPrice == null || edit.unitPrice === "" ? null : Number(edit.unitPrice);
    const nextUnit = edit?.unit ? edit.unit : null;

    const nameChanged = nextName && nextName !== product.name;
    const codeChanged = (product.supplierCode ?? null) !== nextSupplierCode;
    const sourcePriceChanged = (product.sourcePrice ?? null) !== (nextSourcePrice ?? null);
    const sourceUnitChanged = (product.sourceUnit ?? null) !== (nextSourceUnit ?? null);
    const priceChanged = (product.unitPrice ?? null) !== (nextUnitPrice ?? null);
    const unitChanged = (product.unit ?? null) !== (nextUnit ?? null);

    if (nameChanged) {
      await onRenameSupplierProduct(product.id, nextName);
    }
    if (codeChanged || sourcePriceChanged || sourceUnitChanged || priceChanged || unitChanged) {
      await onUpdateSupplierProduct(product.id, nextSupplierCode, nextSourcePrice, nextSourceUnit, nextUnitPrice, nextUnit);
    }
  }

  async function onDeleteSupplierProduct(productId: string) {
    if (!selectedSupplier) return;
    if (!confirm(t(lang, "confirm.deleteProduct"))) return;
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
      setDbStatus(t(lang, "status.productDeleteError"));
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
      setDbStatus(t(lang, "status.supplierRenamed"));
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setDbStatus(message || t(lang, "status.supplierRenameError"));
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
          supplierCode: updated.supplierCode ?? "",
          sourcePrice: updated.sourcePrice == null ? "" : String(updated.sourcePrice),
          sourceUnit: updated.sourceUnit ?? "",
          unitPrice: updated.unitPrice == null ? "" : String(updated.unitPrice),
          unit: updated.unit ?? "",
        },
      }));
      await rebuildPriceIndex(fiche.ingredients);
      setDbStatus(t(lang, "status.productRenamed"));
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setDbStatus(message || t(lang, "status.productRenameError"));
      setSupplierProductEdits((prev) => ({
        ...prev,
        [productId]: {
          name: current?.name ?? prev[productId]?.name ?? "",
          supplierCode: prev[productId]?.supplierCode ?? "",
          sourcePrice: prev[productId]?.sourcePrice ?? "",
          sourceUnit: prev[productId]?.sourceUnit ?? "",
          unitPrice: prev[productId]?.unitPrice ?? "",
          unit: prev[productId]?.unit ?? "",
        },
      }));
    } finally {
      setDbBusy(false);
    }
  }

  const filteredLibrary = useMemo(() => {
    const titleQuery = libraryQuery.trim().toLowerCase();
    const categoryQuery = libraryCategoryQuery.trim().toLowerCase();
    if (!titleQuery && !categoryQuery) return library;
    return library.filter((item) => {
      const titleMatch = !titleQuery || item.title?.toLowerCase().includes(titleQuery);
      const categoryMatch = !categoryQuery || item.category?.toLowerCase().includes(categoryQuery);
      return titleMatch && categoryMatch;
    });
  }, [library, libraryQuery, libraryCategoryQuery]);

  const libraryTitleOptions = useMemo(() => {
    const titles = new Set<string>();
    for (const item of library) {
      const title = item.title?.trim();
      if (title) titles.add(title);
    }
    return Array.from(titles).sort((a, b) => a.localeCompare(b));
  }, [library]);

  const libraryCategoryOptions = useMemo(() => {
    const categories = new Set<string>();
    for (const item of library) {
      const category = item.category?.trim();
      if (category) categories.add(category);
    }
    return Array.from(categories).sort((a, b) => a.localeCompare(b));
  }, [library]);

  const filteredSuppliers = useMemo(() => {
    const q = supplierQuery.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter((s) => s.name.toLowerCase().includes(q));
  }, [suppliers, supplierQuery]);

  const supplierNameOptions = useMemo(() => {
    const names = new Set<string>();
    for (const supplier of suppliers) {
      const name = supplier.name?.trim();
      if (name) names.add(name);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [suppliers]);

  const filteredSupplierProducts = useMemo(() => {
    const q = supplierProductQuery.trim().toLowerCase();
    if (!q) return supplierProducts;
    return supplierProducts.filter((p) => p.name.toLowerCase().includes(q));
  }, [supplierProducts, supplierProductQuery]);

  const filteredAllProducts = useMemo(() => {
    const q = allProductsQuery.trim().toLowerCase();
    if (!q) return allProducts;
    return allProducts.filter(
      (p) => p.name.toLowerCase().includes(q) || p.supplierName.toLowerCase().includes(q)
    );
  }, [allProducts, allProductsQuery]);

  const formatUnitPrice = (value: number | null, unit: string | null) => {
    if (value == null) return "-";
    return unit ? `${value} ${unit}` : String(value);
  };
  const locale = localeByLang[lang];
  const langFlag: Record<Lang, string> = { it: "🇮🇹", fr: "🇫🇷", en: "🇬🇧" };

  const ficheHasContent = (data: FicheTechnique) => {
    if (data.title.trim() || data.category?.trim() || data.notes?.trim()) return true;
    if (data.ingredients.some((ing) => ing.name.trim() || ing.qty.trim() || ing.note?.trim())) return true;
    if (data.steps.some((step) => step.trim())) return true;
    if (data.allergens.some((al) => al.trim())) return true;
    if (data.equipment.some((eq) => eq.trim())) return true;
    return false;
  };

  const autoSaveBeforeLeave = async () => {
    if (view !== "editor") return true;
    if (!ficheHasContent(fiche)) return true;
    const snapshot = JSON.stringify(fiche);
    if (snapshot === lastDbSnapshotRef.current) return true;
    try {
      await saveFicheToDb(fiche);
      lastDbSnapshotRef.current = snapshot;
      return true;
    } catch {
      setDbStatus(t(lang, "status.autoSaveError"));
      return false;
    }
  };

  return (
    <div className="app">
      <header className="topbar no-print">
        <div className="topbar-head">
          <div className="topbar-spacer" aria-hidden="true" />
          <div className="brand">
            <img className="brand-logo-image" src="/chefside-logo.svg" alt="Chef Side" />
          </div>
          <div className="lang-switch">
            <span className="lang-flag" aria-hidden="true">{langFlag[lang]}</span>
            <select
              className="input lang-select"
              value={lang}
              aria-label="Language"
              onChange={(e) => setLang(e.target.value as Lang)}
            >
              <option value="en">English</option>
              <option value="fr">Français</option>
              <option value="it">Italiano</option>
            </select>
          </div>
        </div>

        <div className="toolbar">
          <button
            className={`btn btn-outline nav-btn ${view === "editor" ? "nav-btn--active" : ""}`}
            onClick={() => {
              setFiche(newFiche());
              setView("editor");
              setDbStatus("");
            }}
          >
            {t(lang, "app.newFiche")}
          </button>

          <button
            className={`btn btn-outline nav-btn ${view === "library" ? "nav-btn--active" : ""}`}
            onClick={onOpenLibrary}
            disabled={dbBusy}
          >
            {t(lang, "app.library")}
          </button>

          <button
            className={`btn btn-outline nav-btn ${view === "suppliers" || view === "supplierDetail" ? "nav-btn--active" : ""}`}
            onClick={onOpenSuppliers}
            disabled={dbBusy}
          >
            {t(lang, "app.suppliers")}
          </button>

          <button
            className={`btn btn-outline nav-btn ${view === "products" ? "nav-btn--active" : ""}`}
            onClick={onOpenProducts}
            disabled={dbBusy}
          >
            {t(lang, "app.products")}
          </button>

          {view === "editor" ? (
            <div className="fiche-actions">
              <button className="btn btn-outline btn-fiche" onClick={onSaveDb} disabled={dbBusy}>
                {t(lang, "app.saveDb")}
              </button>

              <button className="btn btn-outline btn-fiche" onClick={() => window.print()}>
                {t(lang, "app.print")}
              </button>

              <button className="btn btn-outline btn-fiche" onClick={onExportPdfOneClick}>
                {t(lang, "app.exportPdf")}
              </button>

              <button className="btn btn-outline btn-fiche" onClick={() => downloadJson(fiche, `${fileNameBase}.json`)}>
                {t(lang, "app.exportJson")}
              </button>

              <label className="btn btn-outline btn-fiche file-button">
                <input
                  type="file"
                  accept="application/json"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onImportJson(f);
                    e.currentTarget.value = "";
                  }}
                />
                {t(lang, "app.importJson")}
              </label>
            </div>

          ) : null}
        </div>

        {view !== "editor" ? (
          <div className="toolbar-hint">
            {t(lang, "app.mode")}:{" "}
            <span className="mode-pill">
              {view === "library"
                ? t(lang, "app.mode.library")
                : view === "suppliers"
                  ? t(lang, "app.mode.suppliers")
                  : view === "products"
                    ? t(lang, "app.mode.products")
                    : t(lang, "app.mode.supplierDetail")}
            </span>
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
                lang={lang}
                onChange={setFiche}
                getPriceForIngredient={getPriceForIngredient}
                onPriceIndexRefresh={(ingredients) => rebuildPriceIndex(ingredients ?? fiche.ingredients)}
              />
            </section>

            <section className="preview">
              <div ref={previewRef} className="preview-inner">
                <FichePreview fiche={fiche} lang={lang} getPriceForIngredient={getPriceForIngredient} />
              </div>
            </section>
          </>
        ) : view === "library" ? (
          <section className="library">
            <div className="library-header">
              <div>
                <h2 className="section-title">{t(lang, "app.sectionLibraryTitle")}</h2>
                <p className="muted">{t(lang, "app.sectionLibraryDesc")}</p>
              </div>
              <div className="library-actions">
                <input
                  className="input"
                  placeholder={t(lang, "app.searchTitle")}
                  list="library-titles"
                  value={libraryQuery}
                  ref={librarySearchRef}
                  onChange={(e) => setLibraryQuery(e.target.value)}
                />
                <datalist id="library-titles">
                  {libraryTitleOptions.map((title) => (
                    <option key={title} value={title} />
                  ))}
                </datalist>
                <input
                  className="input"
                  placeholder={t(lang, "app.searchCategory")}
                  list="library-categories"
                  value={libraryCategoryQuery}
                  onChange={(e) => setLibraryCategoryQuery(e.target.value)}
                />
                <datalist id="library-categories">
                  {libraryCategoryOptions.map((category) => (
                    <option key={category} value={category} />
                  ))}
                </datalist>
                <button className="btn btn-outline" onClick={onExportAllFiches} disabled={dbBusy}>
                  {t(lang, "app.exportAllJson")}
                </button>
                <button className="btn btn-outline" onClick={onExportAllFichesPdfZip} disabled={dbBusy}>
                  {t(lang, "app.exportAllPdfZip")}
                </button>
                <button
                  className="btn btn-outline"
                  onClick={async () => {
                    await syncFicheFromSuppliers();
                    setView("editor");
                  }}
                  disabled={importBusy}
                >
                  {t(lang, "app.backToEditor")}
                </button>
              </div>
            </div>

            <div className="library-list library-list--index">
              {filteredLibrary.length === 0 ? (
                <div className="library-empty">
                  {t(lang, "app.noFiches")}
                </div>
              ) : (
                filteredLibrary.map((item) => (
                  <div key={item.id} className="library-index-row">
                    <button
                      className="library-index-title"
                      onClick={() => onSelectFromLibrary(item)}
                      disabled={dbBusy}
                    >
                      <div className="library-title">{item.title || t(lang, "app.untitled")}</div>
                      <div className="library-meta">
                        {item.category?.trim() ? `${item.category} | ` : ""}
                        {t(lang, "app.updatedAt", { value: new Date(item.updatedAt).toLocaleString(locale) })}
                      </div>
                    </button>
                    <button
                      className="icon-button icon-button--ghost library-delete"
                      onClick={() => onDeleteFromLibrary(item)}
                      disabled={dbBusy}
                      aria-label={t(lang, "app.deleteFicheAria")}
                      data-tooltip={t(lang, "app.delete")}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path
                          d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v9h-2V9zm4 0h2v9h-2V9zM6 7h12l-1 14H7L6 7z"
                          fill="currentColor"
                        />
                      </svg>
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        ) : view === "suppliers" ? (
          <section className="library">
            <div className="library-header">
              <div>
                <h2 className="section-title">{t(lang, "app.sectionSuppliersTitle")}</h2>
                <p className="muted">{t(lang, "app.sectionSuppliersDesc")}</p>
              </div>
              <div className="library-actions">
                <input
                  className="input"
                  placeholder={t(lang, "app.searchSupplier")}
                  list="supplier-names"
                  value={supplierQuery}
                  ref={supplierSearchRef}
                  onChange={(e) => setSupplierQuery(e.target.value)}
                />
                <datalist id="supplier-names">
                  {supplierNameOptions.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
                <label className="btn btn-outline file-button">
                  <input
                    ref={importInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    multiple
                    disabled={dbBusy || importBusy}
                    onChange={(e) => onImportSupplierCsv(e.target.files)}
                  />
                  {t(lang, "app.importCsv")}
                </label>
                <button
                  className="btn btn-outline"
                  onClick={async () => {
                    await syncFicheFromSuppliers();
                    setView("editor");
                  }}
                >
                  {t(lang, "app.backToEditor")}
                </button>
              </div>
            </div>

            {importStatus ? <div className="toolbar-hint">{importStatus}</div> : null}

            <div className="supplier-add supplier-add--simple">
              <input
                className="input"
                placeholder={t(lang, "app.newSupplierPlaceholder")}
                value={newSupplierName}
                onChange={(e) => setNewSupplierName(e.target.value)}
              />
              <button className="btn btn-primary" onClick={onAddSupplier} disabled={dbBusy}>
                {t(lang, "app.addSupplier")}
              </button>
            </div>

            <div className="library-list">
              {filteredSuppliers.length === 0 ? (
                <div className="library-empty">{t(lang, "app.noSuppliers")}</div>
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
                        {t(lang, "app.updatedAt", { value: new Date(supplier.updatedAt).toLocaleString(locale) })}
                      </div>
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => onDeleteSupplier(supplier)}
                      disabled={dbBusy}
                    >
                      {t(lang, "app.delete")}
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        ) : view === "products" ? (
          <section className="library">
            <div className="library-header">
              <div>
                <h2 className="section-title">{t(lang, "app.sectionProductsTitle")}</h2>
                <p className="muted">{t(lang, "app.sectionProductsDesc")}</p>
              </div>
              <div className="library-actions">
                <input
                  className="input"
                  placeholder={t(lang, "app.searchProductOrSupplier")}
                  value={allProductsQuery}
                  ref={productsSearchRef}
                  onChange={(e) => setAllProductsQuery(e.target.value)}
                />
                <button className="btn btn-outline" onClick={() => setView("editor")}>
                  {t(lang, "app.backToEditor")}
                </button>
              </div>
            </div>

            <div className="library-list library-list--index">
              {filteredAllProducts.length > 0 ? (
                <div className="product-index-row product-index-row--header">
                  <div className="product-index-name">{t(lang, "app.productHeaderName")}</div>
                  <div className="product-index-supplier">{t(lang, "app.productHeaderSupplier")}</div>
                  <div className="product-index-price">{t(lang, "app.productHeaderPrice")}</div>
                  <div className="product-index-updated">{t(lang, "app.productHeaderUpdated")}</div>
                </div>
              ) : null}
              {filteredAllProducts.length === 0 ? (
                <div className="library-empty">{t(lang, "app.noProducts")}</div>
              ) : (
                filteredAllProducts.map((product) => (
                  <div key={product.id} className="product-index-row">
                    <div className="product-index-name">{product.name}</div>
                    <div className="product-index-supplier">{product.supplierName}</div>
                    <div className="product-index-price">
                      {formatUnitPrice(product.unitPrice, product.unit)}
                    </div>
                    <div className="product-index-updated">
                      {new Date(product.updatedAt).toLocaleDateString(locale)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        ) : (
          <section className="library">
            <div className="library-header">
              <div>
                <h2 className="section-title">{t(lang, "app.sectionSupplierDetailTitle")}</h2>
                <div className="supplier-title-row">
                  <input
                    className="input"
                    value={supplierNameEdit}
                    onChange={(e) => setSupplierNameEdit(e.target.value)}
                    onBlur={() => onRenameSupplier(supplierNameEdit)}
                    placeholder={t(lang, "app.supplierNamePlaceholder")}
                    disabled={dbBusy}
                  />
                  <button
                    className="btn btn-outline"
                    onClick={() => onRenameSupplier(supplierNameEdit)}
                    disabled={dbBusy}
                  >
                    {t(lang, "app.saveName")}
                  </button>
                </div>
              </div>
              <div className="library-actions">
                <input
                  className="input"
                  placeholder={t(lang, "app.searchProduct")}
                  value={supplierProductQuery}
                  ref={supplierProductsSearchRef}
                  onChange={(e) => setSupplierProductQuery(e.target.value)}
                />
                <button className="btn btn-outline" onClick={onExportSupplierOrderPdf} disabled={dbBusy}>
                  {t(lang, "app.exportSupplierOrderPdf")}
                </button>
                <button className="btn btn-outline" onClick={() => setView("suppliers")}>
                  {t(lang, "app.backToSuppliers")}
                </button>
              </div>
            </div>

            <div className="supplier-add">
              <input
                className="input"
                placeholder={t(lang, "app.supplierCodePlaceholder")}
                value={newProductCode}
                onChange={(e) => setNewProductCode(e.target.value)}
              />
              <input
                className="input"
                placeholder={t(lang, "app.productPlaceholder")}
                value={newProductName}
                onChange={(e) => setNewProductName(e.target.value)}
              />
              <input
                className="input input-price"
                type="number"
                min={0}
                step="0.01"
                placeholder={t(lang, "app.originalPricePlaceholder")}
                value={newProductSourcePrice}
                onChange={(e) => setNewProductSourcePrice(e.target.value)}
              />
              <select
                className="input input-unit"
                value={newProductSourceUnit}
                onChange={(e) => setNewProductSourceUnit(e.target.value)}
              >
                <option value="">{t(lang, "app.originalUnitLabel")}</option>
                <option value="kg">€/kg</option>
                <option value="g">€/g</option>
                <option value="l">€/l</option>
                <option value="ml">€/ml</option>
                <option value="cl">€/cl</option>
                <option value="pc">€/pz</option>
              </select>
              <input
                className="input input-price"
                type="number"
                min={0}
                step="0.01"
                placeholder={t(lang, "app.unitPricePlaceholder")}
                value={newProductPrice}
                onChange={(e) => setNewProductPrice(e.target.value)}
              />
              <select
                className="input input-unit"
                value={newProductUnit}
                onChange={(e) => setNewProductUnit(e.target.value)}
              >
                <option value="">{t(lang, "app.unitLabel")}</option>
                <option value="kg">€/kg</option>
                <option value="g">€/g</option>
                <option value="l">€/l</option>
                <option value="ml">€/ml</option>
                <option value="cl">€/cl</option>
                <option value="pc">€/pz</option>
              </select>
              <button className="btn btn-primary supplier-add-btn" onClick={onAddSupplierProduct} disabled={dbBusy}>
                {t(lang, "app.addProduct")}
              </button>
            </div>

            <div className="library-list supplier-products-list">
              {filteredSupplierProducts.length === 0 ? (
                <div className="library-empty">{t(lang, "app.noSupplierProducts")}</div>
              ) : (
                filteredSupplierProducts.map((product) => (
                  <div key={product.id} className="library-card supplier-product">
                    <input
                        className="input"
                        value={supplierProductEdits[product.id]?.supplierCode ?? ""}
                        onChange={(e) =>
                          setSupplierProductEdits((prev) => ({
                            ...prev,
                            [product.id]: {
                              name: prev[product.id]?.name ?? product.name,
                              supplierCode: e.target.value,
                              sourcePrice: prev[product.id]?.sourcePrice ?? "",
                              sourceUnit: prev[product.id]?.sourceUnit ?? "",
                              unitPrice: prev[product.id]?.unitPrice ?? "",
                              unit: prev[product.id]?.unit ?? "",
                            },
                          }))
                        }
                        onBlur={() => {
                          const edit = supplierProductEdits[product.id];
                          const supplierCode = edit?.supplierCode?.trim() ? edit.supplierCode.trim() : null;
                          const sourcePrice = edit?.sourcePrice === "" ? null : Number(edit?.sourcePrice);
                          const sourceUnit = edit?.sourceUnit ? edit.sourceUnit : null;
                          const price = edit?.unitPrice === "" ? null : Number(edit?.unitPrice);
                          const unit = edit?.unit ? edit.unit : null;
                          onUpdateSupplierProduct(product.id, supplierCode, sourcePrice, sourceUnit, price, unit);
                        }}
                        placeholder={t(lang, "app.supplierCodePlaceholder")}
                      />
                    <div className="supplier-product-row">
                      <input
                        className="input supplier-product-name-input"
                        value={supplierProductEdits[product.id]?.name ?? product.name}
                        onChange={(e) =>
                          setSupplierProductEdits((prev) => ({
                            ...prev,
                            [product.id]: {
                              name: e.target.value,
                              supplierCode: prev[product.id]?.supplierCode ?? "",
                              sourcePrice: prev[product.id]?.sourcePrice ?? "",
                              sourceUnit: prev[product.id]?.sourceUnit ?? "",
                              unitPrice: prev[product.id]?.unitPrice ?? "",
                              unit: prev[product.id]?.unit ?? "",
                            },
                          }))
                        }
                        onBlur={(e) => onRenameSupplierProduct(product.id, e.target.value)}
                        disabled={dbBusy}
                      />
                      <input
                        className="input input-price"
                        type="number"
                        min={0}
                        step="0.01"
                        value={supplierProductEdits[product.id]?.sourcePrice ?? ""}
                        onChange={(e) =>
                          setSupplierProductEdits((prev) => ({
                            ...prev,
                            [product.id]: {
                              name: prev[product.id]?.name ?? product.name,
                              supplierCode: prev[product.id]?.supplierCode ?? "",
                              sourcePrice: e.target.value,
                              sourceUnit: prev[product.id]?.sourceUnit ?? "",
                              unitPrice: prev[product.id]?.unitPrice ?? "",
                              unit: prev[product.id]?.unit ?? "",
                            },
                          }))
                        }
                        onBlur={() => {
                          const edit = supplierProductEdits[product.id];
                          const supplierCode = edit?.supplierCode?.trim() ? edit.supplierCode.trim() : null;
                          const sourcePrice = edit?.sourcePrice === "" ? null : Number(edit?.sourcePrice);
                          const sourceUnit = edit?.sourceUnit ? edit.sourceUnit : null;
                          const price = edit?.unitPrice === "" ? null : Number(edit?.unitPrice);
                          const unit = edit?.unit ? edit.unit : null;
                          onUpdateSupplierProduct(product.id, supplierCode, sourcePrice, sourceUnit, price, unit);
                        }}
                        placeholder={t(lang, "app.originalPricePlaceholder")}
                      />
                      <select
                        className="input input-unit"
                        value={supplierProductEdits[product.id]?.sourceUnit ?? ""}
                        onChange={(e) =>
                          setSupplierProductEdits((prev) => ({
                            ...prev,
                            [product.id]: {
                              name: prev[product.id]?.name ?? product.name,
                              supplierCode: prev[product.id]?.supplierCode ?? "",
                              sourcePrice: prev[product.id]?.sourcePrice ?? "",
                              sourceUnit: e.target.value,
                              unitPrice: prev[product.id]?.unitPrice ?? "",
                              unit: prev[product.id]?.unit ?? "",
                            },
                          }))
                        }
                        onBlur={() => {
                          const edit = supplierProductEdits[product.id];
                          const supplierCode = edit?.supplierCode?.trim() ? edit.supplierCode.trim() : null;
                          const sourcePrice = edit?.sourcePrice === "" ? null : Number(edit?.sourcePrice);
                          const sourceUnit = edit?.sourceUnit ? edit.sourceUnit : null;
                          const price = edit?.unitPrice === "" ? null : Number(edit?.unitPrice);
                          const unit = edit?.unit ? edit.unit : null;
                          onUpdateSupplierProduct(product.id, supplierCode, sourcePrice, sourceUnit, price, unit);
                        }}
                      >
                        <option value="">{t(lang, "app.originalUnitLabel")}</option>
                        <option value="kg">€/kg</option>
                        <option value="g">€/g</option>
                        <option value="l">€/l</option>
                        <option value="ml">€/ml</option>
                        <option value="cl">€/cl</option>
                        <option value="pc">€/pz</option>
                      </select>
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
                              supplierCode: prev[product.id]?.supplierCode ?? "",
                              sourcePrice: prev[product.id]?.sourcePrice ?? "",
                              sourceUnit: prev[product.id]?.sourceUnit ?? "",
                              unitPrice: e.target.value,
                              unit: prev[product.id]?.unit ?? "",
                            },
                          }))
                        }
                        onBlur={() => {
                          const edit = supplierProductEdits[product.id];
                          const supplierCode = edit?.supplierCode?.trim() ? edit.supplierCode.trim() : null;
                          const sourcePrice = edit?.sourcePrice === "" ? null : Number(edit?.sourcePrice);
                          const sourceUnit = edit?.sourceUnit ? edit.sourceUnit : null;
                          const price = edit?.unitPrice === "" ? null : Number(edit?.unitPrice);
                          const unit = edit?.unit ? edit.unit : null;
                          onUpdateSupplierProduct(product.id, supplierCode, sourcePrice, sourceUnit, price, unit);
                        }}
                        placeholder={t(lang, "app.pricePlaceholder")}
                      />
                      <select
                        className="input input-unit"
                        value={supplierProductEdits[product.id]?.unit ?? ""}
                        onChange={(e) =>
                          setSupplierProductEdits((prev) => ({
                            ...prev,
                            [product.id]: {
                              name: prev[product.id]?.name ?? product.name,
                              supplierCode: prev[product.id]?.supplierCode ?? "",
                              sourcePrice: prev[product.id]?.sourcePrice ?? "",
                              sourceUnit: prev[product.id]?.sourceUnit ?? "",
                              unitPrice: prev[product.id]?.unitPrice ?? "",
                              unit: e.target.value,
                            },
                          }))
                        }
                        onBlur={() => {
                          const edit = supplierProductEdits[product.id];
                          const supplierCode = edit?.supplierCode?.trim() ? edit.supplierCode.trim() : null;
                          const sourcePrice = edit?.sourcePrice === "" ? null : Number(edit?.sourcePrice);
                          const sourceUnit = edit?.sourceUnit ? edit.sourceUnit : null;
                          const price = edit?.unitPrice === "" ? null : Number(edit?.unitPrice);
                          const unit = edit?.unit ? edit.unit : null;
                          onUpdateSupplierProduct(product.id, supplierCode, sourcePrice, sourceUnit, price, unit);
                        }}
                      >
                        <option value="">{t(lang, "app.unitLabel")}</option>
                        <option value="kg">€/kg</option>
                        <option value="g">€/g</option>
                        <option value="l">€/l</option>
                        <option value="ml">€/ml</option>
                        <option value="cl">€/cl</option>
                        <option value="pc">€/pz</option>
                      </select>
                      <button
                        className="btn btn-outline"
                        onClick={() => onSaveSupplierProduct(product)}
                        disabled={dbBusy}
                      >
                        {t(lang, "app.save")}
                      </button>
                      <button
                        className="btn btn-ghost"
                        onClick={() => onDeleteSupplierProduct(product.id)}
                        disabled={dbBusy}
                      >
                        {t(lang, "app.delete")}
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
