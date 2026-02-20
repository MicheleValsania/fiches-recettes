export type IngredientLine = {
  name: string;
  qty: string;      // es: "200 g", "2 pcs", "1 tbsp"
  note?: string;
  supplier?: string;
  supplierId?: string;
  supplierProductId?: string;
  unitPrice?: number;
  unitPriceUnit?: "kg" | "g" | "l" | "ml" | "cl" | "pc";
};

export type HaccpProcess =
  | "COOK_CHILL"
  | "MARINATION"
  | "VACUUM_PASTEURIZATION"
  | "SOUS_VIDE_COOK"
  | "FREEZING"
  | "THAWING"
  | "HOT_HOLDING"
  | "OTHER";

export type HaccpProfile = {
  process: HaccpProcess;
  packaging: string;
  tempMinC: string;
  tempMaxC: string;
  coreTempC: string;
  holdTimeMin: string;
  shelfLifeValue: string;
  shelfLifeUnit: "hours" | "days" | "months" | "";
  dlcType: "DLC" | "DDM" | "";
  startPoint: "production_date" | "cooling_end" | "opening_date" | "thaw_date" | "receipt_date" | "";
  notes: string;
};

export type FicheTechnique = {
  id: string;
  title: string;
  category?: string;
  portions: number;
  allergens: string[];
  equipment: string[];
  ingredients: IngredientLine[];
  steps: string[];
  haccpProfiles?: HaccpProfile[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
};
