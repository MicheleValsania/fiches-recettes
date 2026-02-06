export type SupplierCsvItem = {
  supplier: string;
  product: string;
  unit: string | null;
  unitPrice: number | null;
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
    unit?: number;
    price?: number;
  } = {};

  row.forEach((cell, idx) => {
    const normalized = normalizeText(cell);
    if (!normalized) return;

    if (normalized.includes("fournisseur")) indexes.supplier = idx;
    if (normalized.includes("designation")) indexes.product = idx;
    if (normalized.includes("unite") || normalized === "unit") indexes.unit = idx;
    if (normalized.includes("prix unit")) indexes.price = idx;
  });

  if (
    indexes.supplier == null ||
    indexes.product == null ||
    indexes.unit == null ||
    indexes.price == null
  ) {
    return null;
  }

  return indexes as {
    supplier: number;
    product: number;
    unit: number;
    price: number;
  };
}

export function parseSupplierCsv(text: string): SupplierCsvItem[] {
  const rows = parseCsv(text);
  const items: SupplierCsvItem[] = [];
  let header: { supplier: number; product: number; unit: number; price: number } | null = null;

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

    const unit = normalizeUnit(row[header.unit] ?? "");
    const unitPrice = parsePrice(row[header.price] ?? "");

    items.push({
      supplier,
      product,
      unit,
      unitPrice,
    });
  }

  return items;
}
