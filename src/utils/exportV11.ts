import type { FicheTechnique } from "../types/fiche";
import type { Lang } from "../i18n";

export type ExportWarning = {
  code: string;
  path: string;
  message: string;
};

type ExportStorageProfile = {
  id: string;
  mode: string;
  dlc_type: "DLC" | "DDM" | null;
  shelf_life: { value: number | null; unit: "hours" | "days" | "months" | null };
  temp_range_c: { min: number | null; max: number | null };
  start_point: string | null;
  allowed_transformations: string[];
  source: "chef_defined" | "imported" | "ai_suggested" | null;
  notes: string | null;
};

type ExportLabelHints = {
  label_type: "RAW_MATERIAL" | "PREPARATION" | "TRANSFORMATION" | "OPENED_PRODUCT" | null;
  display_name: string | null;
  allergen_display: { mode: "auto" | "manual" | "hide" | null; manual_text: string | null };
  date_fields: { production_label: string | null; dlc_label: string | null };
  lot_fields: { show_internal_lot: boolean; show_supplier_lot: boolean };
  storage_display: { show_temp_range: boolean; default_storage_profile_id: string | null };
  qr_target: "lot" | "fiche" | "none" | null;
  template_hint: string | null;
};

type ExportFicheV11 = {
  fiche_id: string;
  updated_at: string | null;
  title: string;
  language: "fr" | "it" | "en";
  category: string | null;
  allergens: string[];
  ingredients: Array<{
    ingredient_name_raw: string;
    quantity_raw: string | null;
    note: string | null;
    supplier_name: string | null;
    supplier_id: string | null;
    supplier_product_id: string | null;
    unit_price_value: number | null;
    unit_price_unit: string | null;
  }>;
  procedure_steps: string[];
  haccp_profiles: Array<Record<string, unknown>>;
  storage_profiles: ExportStorageProfile[];
  label_hints: ExportLabelHints | null;
  warnings: ExportWarning[];
};

export type ExportEnvelopeV11 = {
  export_version: "1.1";
  exported_at: string;
  source_app: "fiches-recettes";
  fiches: ExportFicheV11[];
  warnings: ExportWarning[];
};

function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function parseNumberOrNull(value: unknown, path: string, warnings: ExportWarning[]) {
  if (value == null || value === "") return null;
  const parsed = Number.parseFloat(String(value).replace(",", "."));
  if (Number.isNaN(parsed)) {
    warnings.push({
      code: "NUMERIC_PARSE_FAILED",
      path,
      message: `Cannot parse '${String(value)}'`,
    });
    return null;
  }
  return parsed;
}

function toIsoUtc(value: unknown, path: string, warnings: ExportWarning[]) {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    warnings.push({
      code: "INVALID_DATE",
      path,
      message: `Cannot parse date '${String(value)}'`,
    });
    return null;
  }
  return date.toISOString();
}

function mapStorageProfiles(fiche: FicheTechnique, warnings: ExportWarning[]): ExportStorageProfile[] {
  const validStartPoints = new Set([
    "receipt_date",
    "production_date",
    "cooling_end",
    "opening_date",
    "thaw_date",
    "freezing_date",
  ]);
  return (fiche.storageProfiles ?? []).map((profile, index) => {
    const startPoint = profile.startPoint || null;
    let normalizedStartPoint = startPoint;
    if (startPoint && !validStartPoints.has(startPoint)) {
      warnings.push({
        code: "INVALID_START_POINT",
        path: `storage_profiles[${index}].start_point`,
        message: `Invalid start_point '${startPoint}'`,
      });
      normalizedStartPoint = null;
    }
    return {
      id: profile.id?.trim() || `storage_${index + 1}`,
      mode: profile.mode?.trim() || "",
      dlc_type: profile.dlcType || null,
      shelf_life: {
        value: parseNumberOrNull(profile.shelfLifeValue, `storage_profiles[${index}].shelf_life.value`, warnings),
        unit: profile.shelfLifeUnit || null,
      },
      temp_range_c: {
        min: parseNumberOrNull(profile.tempMinC, `storage_profiles[${index}].temp_range_c.min`, warnings),
        max: parseNumberOrNull(profile.tempMaxC, `storage_profiles[${index}].temp_range_c.max`, warnings),
      },
      start_point: normalizedStartPoint,
      allowed_transformations: profile.allowedTransformations ?? [],
      source: profile.source || "chef_defined",
      notes: profile.notes?.trim() || null,
    };
  });
}

function mapLabelHints(fiche: FicheTechnique, storageProfiles: ExportStorageProfile[], warnings: ExportWarning[]): ExportLabelHints | null {
  const hints = fiche.labelHints;
  if (!hints) return null;

  let defaultStorageProfileId = hints.defaultStorageProfileId?.trim() || null;
  if (defaultStorageProfileId && !storageProfiles.some((profile) => profile.id === defaultStorageProfileId)) {
    warnings.push({
      code: "LABEL_DEFAULT_STORAGE_PROFILE_NOT_FOUND",
      path: "label_hints.storage_display.default_storage_profile_id",
      message: `default_storage_profile_id not found: ${defaultStorageProfileId}`,
    });
    defaultStorageProfileId = null;
  }

  return {
    label_type: hints.labelType || null,
    display_name: hints.displayName?.trim() || null,
    allergen_display: {
      mode: hints.allergenDisplayMode || null,
      manual_text: hints.allergenManualText?.trim() || null,
    },
    date_fields: {
      production_label: hints.productionLabel?.trim() || null,
      dlc_label: hints.dlcLabel?.trim() || null,
    },
    lot_fields: {
      show_internal_lot: !!hints.showInternalLot,
      show_supplier_lot: !!hints.showSupplierLot,
    },
    storage_display: {
      show_temp_range: !!hints.showTempRange,
      default_storage_profile_id: defaultStorageProfileId,
    },
    qr_target: hints.qrTarget || null,
    template_hint: hints.templateHint?.trim() || null,
  };
}

function mapFicheToExportV11(fiche: FicheTechnique, language: Lang, globalWarnings: ExportWarning[]): ExportFicheV11 {
  const warnings: ExportWarning[] = [];

  const ficheIdBase = fiche.id?.trim();
  const fallbackFicheId = slugify(`${fiche.title || "fiche"}-${fiche.createdAt || fiche.updatedAt || ""}`);
  const ficheId = ficheIdBase || fallbackFicheId || `fiche-${Date.now()}`;
  if (!ficheIdBase) {
    globalWarnings.push({
      code: "MISSING_FICHE_ID",
      path: "fiche_id",
      message: `Missing fiche id for title '${fiche.title || "(untitled)"}', fallback generated`,
    });
  }

  const storageProfiles = mapStorageProfiles(fiche, warnings);
  const labelHints = mapLabelHints(fiche, storageProfiles, warnings);

  if (storageProfiles.length === 0) {
    warnings.push({
      code: "MISSING_STORAGE_PROFILES",
      path: "storage_profiles",
      message: "No storage profiles provided",
    });
  }

  return {
    fiche_id: ficheId,
    updated_at: toIsoUtc(fiche.updatedAt, "updated_at", warnings),
    title: fiche.title || "",
    language,
    category: fiche.category?.trim() || null,
    allergens: fiche.allergens ?? [],
    ingredients: (fiche.ingredients ?? []).map((ingredient) => ({
      ingredient_name_raw: ingredient.name || "",
      quantity_raw: ingredient.qty || null,
      note: ingredient.note?.trim() || null,
      supplier_name: ingredient.supplier?.trim() || null,
      supplier_id: ingredient.supplierId || null,
      supplier_product_id: ingredient.supplierProductId || null,
      unit_price_value: ingredient.unitPrice ?? null,
      unit_price_unit: ingredient.unitPriceUnit ?? null,
    })),
    procedure_steps: fiche.steps ?? [],
    haccp_profiles: (fiche.haccpProfiles ?? []).map((profile, index) => ({
      id: `haccp_${index + 1}`,
      process: profile.process,
      applies_to: "preparation",
      params: {
        temp_min_c: parseNumberOrNull(profile.tempMinC, `haccp_profiles[${index}].params.temp_min_c`, warnings),
        temp_max_c: parseNumberOrNull(profile.tempMaxC, `haccp_profiles[${index}].params.temp_max_c`, warnings),
        temp_target_c: parseNumberOrNull(profile.coreTempC, `haccp_profiles[${index}].params.temp_target_c`, warnings),
        time_target_min: parseNumberOrNull(profile.holdTimeMin, `haccp_profiles[${index}].params.time_target_min`, warnings),
        shelf_life_value: parseNumberOrNull(profile.shelfLifeValue, `haccp_profiles[${index}].params.shelf_life_value`, warnings),
        shelf_life_unit: profile.shelfLifeUnit || null,
        dlc_type: profile.dlcType || null,
        start_point: profile.startPoint || null,
        packaging: profile.packaging || null,
      },
      controls: [],
      notes: profile.notes?.trim() || null,
    })),
    storage_profiles: storageProfiles,
    label_hints: labelHints,
    warnings,
  };
}

export function buildExportEnvelopeV11(fiches: FicheTechnique[], language: Lang): ExportEnvelopeV11 {
  const warnings: ExportWarning[] = [];
  return {
    export_version: "1.1",
    exported_at: new Date().toISOString(),
    source_app: "fiches-recettes",
    fiches: fiches.map((fiche) => mapFicheToExportV11(fiche, language, warnings)),
    warnings,
  };
}
