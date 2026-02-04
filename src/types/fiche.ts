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

export type FicheTechnique = {
  id: string;
  title: string;
  category?: string;
  portions: number;
  allergens: string[];
  equipment: string[];
  ingredients: IngredientLine[];
  steps: string[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
};
