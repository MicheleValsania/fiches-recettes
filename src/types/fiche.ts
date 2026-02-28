export type IngredientLine = {
  name: string;
  displayName?: string;
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

export type StorageProfile = {
  id: string;
  mode: string;
  dlcType: "DLC" | "DDM" | "";
  shelfLifeValue: string;
  shelfLifeUnit: "hours" | "days" | "months" | "";
  tempMinC: string;
  tempMaxC: string;
  startPoint:
    | "receipt_date"
    | "production_date"
    | "cooling_end"
    | "opening_date"
    | "thaw_date"
    | "freezing_date"
    | "";
  allowedTransformations: string[];
  source: "chef_defined" | "imported" | "ai_suggested" | "";
  notes: string;
};

export type LabelHints = {
  labelType: "RAW_MATERIAL" | "PREPARATION" | "TRANSFORMATION" | "OPENED_PRODUCT" | "";
  displayName: string;
  legalName: string;
  allergenDisplayMode: "auto" | "manual" | "hide" | "";
  allergenManualText: string;
  productionLabel: string;
  dlcLabel: string;
  showInternalLot: boolean;
  showSupplierLot: boolean;
  showTempRange: boolean;
  defaultStorageProfileId: string;
  qrTarget: "lot" | "fiche" | "none" | "";
  templateHint: string;
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
  storageProfiles?: StorageProfile[];
  labelHints?: LabelHints;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};
