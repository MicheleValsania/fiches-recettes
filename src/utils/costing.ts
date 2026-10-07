import type { IngredientLine } from "../types/fiche";

type QtyUnit = "kg" | "g" | "l" | "ml" | "cl" | "pc";

type ParsedQty = {
  value: number;
  unit?: QtyUnit;
};

export type FoodCostSummary = {
  total: number | null;
  calculatedCount: number;
  ingredientCount: number;
  incompleteIngredients: IngredientLine[];
  complete: boolean;
};

const UNIT_ALIASES: Record<string, QtyUnit> = {
  kg: "kg",
  g: "g",
  gr: "g",
  grammo: "g",
  grammi: "g",
  l: "l",
  lt: "l",
  litro: "l",
  litri: "l",
  ml: "ml",
  cl: "cl",
  pc: "pc",
  pcs: "pc",
  pz: "pc",
  pezzo: "pc",
  pezzi: "pc",
};

function parseQuantity(qty: string): ParsedQty | null {
  const raw = qty.trim().toLowerCase().replace(",", ".");
  if (!raw) return null;

  const match = raw.match(/([\d.]+)\s*([a-zà-ù]*)/i);
  if (!match) return null;

  const value = Number(match[1]);
  if (Number.isNaN(value)) return null;

  const unitRaw = match[2]?.trim();
  if (!unitRaw) return { value };

  const unit = UNIT_ALIASES[unitRaw];
  if (!unit) return { value };

  return { value, unit };
}

function qtyInPriceUnit(parsed: ParsedQty, unitPriceUnit: IngredientLine["unitPriceUnit"]): number | null {
  if (!unitPriceUnit) return null;

  if (unitPriceUnit === "kg") {
    if (parsed.unit === "kg") return parsed.value;
    if (parsed.unit === "g") return parsed.value / 1000;
    return null;
  }

  if (unitPriceUnit === "g") {
    if (parsed.unit === "kg") return parsed.value * 1000;
    if (parsed.unit === "g") return parsed.value;
    return null;
  }

  if (unitPriceUnit === "l") {
    if (parsed.unit === "l") return parsed.value;
    if (parsed.unit === "ml") return parsed.value / 1000;
    if (parsed.unit === "cl") return parsed.value / 100;
    return null;
  }

  if (unitPriceUnit === "ml") {
    if (parsed.unit === "l") return parsed.value * 1000;
    if (parsed.unit === "ml") return parsed.value;
    if (parsed.unit === "cl") return parsed.value * 10;
    return null;
  }

  if (unitPriceUnit === "cl") {
    if (parsed.unit === "l") return parsed.value * 100;
    if (parsed.unit === "ml") return parsed.value / 10;
    if (parsed.unit === "cl") return parsed.value;
    return null;
  }

  if (unitPriceUnit === "pc") {
    if (!parsed.unit || parsed.unit === "pc") return parsed.value;
    return null;
  }

  return null;
}

export function computeIngredientCost(ingredient: IngredientLine): number | null {
  if (ingredient.unitPrice == null || !ingredient.unitPriceUnit) return null;
  const parsed = parseQuantity(ingredient.qty || "");
  if (!parsed) return null;

  const qtyUnit = qtyInPriceUnit(parsed, ingredient.unitPriceUnit);
  if (qtyUnit == null) return null;

  return ingredient.unitPrice * qtyUnit;
}

export function computeFoodCost(ingredients: IngredientLine[]) {
  return computeFoodCostSummary(ingredients).total;
}

export function computeFoodCostSummary(ingredients: IngredientLine[]): FoodCostSummary {
  let total = 0;
  let calculatedCount = 0;
  const relevantIngredients = ingredients.filter((ingredient) =>
    Boolean(ingredient.name?.trim() || ingredient.displayName?.trim() || ingredient.qty?.trim())
  );
  const incompleteIngredients: IngredientLine[] = [];

  for (const ingredient of relevantIngredients) {
    const cost = computeIngredientCost(ingredient);
    if (cost != null) {
      total += cost;
      calculatedCount += 1;
    } else {
      incompleteIngredients.push(ingredient);
    }
  }

  return {
    total: calculatedCount > 0 ? total : null,
    calculatedCount,
    ingredientCount: relevantIngredients.length,
    incompleteIngredients,
    complete: relevantIngredients.length > 0 && incompleteIngredients.length === 0,
  };
}

export function formatCurrency(value: number | string) {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return "€ 0.00";
  return `€ ${num.toFixed(2)}`;
}
