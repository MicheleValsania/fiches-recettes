export type SupplierCsvItem = {
  supplier: string;
  product: string;
  supplierCode?: string;
  sourcePrice?: number;
  sourceUnit?: string;
  unit?: string;
  unitPrice?: number;
};

function normalizeText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ");
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ",") {
      row.push(current);
      current = "";
      continue;
    }

    if (ch === "\n") {
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
      continue;
    }

    if (ch === "\r") {
      if (text[i + 1] === "\n") {
        i += 1;
      }
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
      continue;
    }

    current += ch;
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  return rows;
}

function normalizeUnit(value: string): string | null {
  const cleaned = normalizeText(value);
  if (!cleaned) return null;

  const directMap: Record<string, string> = {
    kg: "kg",
    g: "g",
    l: "l",
    litre: "l",
    litres: "l",
    liter: "l",
    liters: "l",
    ml: "ml",
    cl: "cl",
    pc: "pc",
    pz: "pc",
    piece: "pc",
    pieces: "pc",
    "piece ": "pc",
    "pieces ": "pc",
    unite: "pc",
    unites: "pc",
    unitee: "pc",
    "unitees": "pc",
    "unite ": "pc",
    "unites ": "pc",
    sachet: "pc",
    sachets: "pc",
    seau: "pc",
    sceau: "pc",
    bouteille: "pc",
    bouteilles: "pc",
    boite: "pc",
    boites: "pc",
    barquette: "pc",
    barquettes: "pc",
    carton: "pc",
    cartons: "pc",
  };

  if (directMap[cleaned]) return directMap[cleaned];

  if (cleaned.includes("kg")) return "kg";
  if (cleaned.includes("g")) return "g";
  if (cleaned.includes("ml")) return "ml";
  if (cleaned.includes("cl")) return "cl";
  if (cleaned.includes("l")) return "l";

  return null;
}

function parsePrice(value: string): number | null {
  const cleaned = value.replace(/[^\d,.-]/g, "").trim();
  if (!cleaned || cleaned === "-" || cleaned === "--") return null;

  let normalized = cleaned;
  if (normalized.includes(",") && normalized.includes(".")) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = normalized.replace(",", ".");
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function findHeaderIndexes(row: string[]) {
  const indexes: {
    supplier?: number;
    product?: number;
    supplierCode?: number;
    sourcePrice?: number;
    sourceUnit?: number;
    unit?: number;
    unitPrice?: number;
  } = {};

  row.forEach((cell, idx) => {
    const normalized = normalizeText(cell);
    if (!normalized) return;

    const hasSupplierWord =
      normalized.includes("fournisseur") ||
      normalized.includes("fornitore") ||
      normalized.includes("supplier");
    const hasProductWord =
      normalized.includes("designation") ||
      normalized.includes("produit") ||
      normalized.includes("prodotto") ||
      normalized.includes("product") ||
      normalized.includes("linea prodotto") ||
      normalized.includes("ligne produit");
    const hasCodeWord =
      normalized.includes("code fournisseur") ||
      normalized.includes("codice fornitore") ||
      normalized.includes("supplier code") ||
      normalized.includes("source code");
    const hasSourceWord = normalized.includes("source") || normalized.includes("origine");
    const hasPriceWord =
      normalized.includes("prix") ||
      normalized.includes("prezzo") ||
      normalized.includes("price");
    const hasUnitWord =
      normalized.includes("unite") ||
      normalized.includes("unita") ||
      normalized === "unit";

    if (hasCodeWord) {
      indexes.supplierCode = idx;
      return;
    }
    if (hasSupplierWord) {
      indexes.supplier = idx;
      return;
    }
    if (hasProductWord) {
      indexes.product = idx;
      return;
    }
    if (hasPriceWord && hasSourceWord) {
      indexes.sourcePrice = idx;
      return;
    }
    if (hasUnitWord && hasSourceWord) {
      indexes.sourceUnit = idx;
      return;
    }
    if (hasPriceWord) {
      indexes.unitPrice = idx;
      return;
    }
    if (hasUnitWord) {
      indexes.unit = idx;
    }
  });

  if (indexes.supplier == null || indexes.product == null) {
    return null;
  }

  return indexes as {
    supplier: number;
    product: number;
    supplierCode?: number;
    sourcePrice?: number;
    sourceUnit?: number;
    unit?: number;
    unitPrice?: number;
  };
}

export function parseSupplierCsv(text: string): SupplierCsvItem[] {
  const rows = parseCsv(text);
  const items: SupplierCsvItem[] = [];
  let header: {
    supplier: number;
    product: number;
    supplierCode?: number;
    sourcePrice?: number;
    sourceUnit?: number;
    unit?: number;
    unitPrice?: number;
  } | null = null;

  for (const row of rows) {
    if (!row.length) continue;

    const maybeHeader = findHeaderIndexes(row);
    if (maybeHeader) {
      header = maybeHeader;
      continue;
    }

    if (!header) continue;

    const supplierRaw = row[header.supplier] ?? "";
    const productRaw = row[header.product] ?? "";
    const supplier = supplierRaw.trim();
    const product = productRaw.trim();

    if (!supplier || !product) continue;

    const normalizedSupplier = normalizeText(supplier);
    const normalizedProduct = normalizeText(product);

    if (
      normalizedSupplier.includes("fournisseur") ||
      normalizedProduct.includes("designation") ||
      normalizedSupplier.includes("merci d'ajouter") ||
      normalizedProduct.includes("merci d'ajouter") ||
      normalizedProduct === "total"
    ) {
      continue;
    }

    const supplierCodeRaw = header.supplierCode == null ? "" : row[header.supplierCode] ?? "";
    const supplierCode = supplierCodeRaw.trim() || undefined;
    const sourcePriceRaw = header.sourcePrice == null ? "" : row[header.sourcePrice] ?? "";
    const parsedSourcePrice = parsePrice(sourcePriceRaw);
    const sourcePrice = parsedSourcePrice == null ? undefined : parsedSourcePrice;
    const sourceUnitRaw = header.sourceUnit == null ? "" : row[header.sourceUnit] ?? "";
    const sourceUnit = normalizeUnit(sourceUnitRaw) ?? undefined;
    const unitRaw = header.unit == null ? "" : row[header.unit] ?? "";
    const unit = normalizeUnit(unitRaw) ?? undefined;
    const unitPriceRaw = header.unitPrice == null ? "" : row[header.unitPrice] ?? "";
    const parsedUnitPrice = parsePrice(unitPriceRaw);
    const unitPrice = parsedUnitPrice == null ? undefined : parsedUnitPrice;

    items.push({
      supplier,
      product,
      supplierCode,
      sourcePrice,
      sourceUnit,
      unit,
      unitPrice,
    });
  }

  return items;
}
