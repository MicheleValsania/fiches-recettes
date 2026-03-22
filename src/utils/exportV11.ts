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
  portions: number | null;
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

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuidV4(value: string) {
  return UUID_V4_REGEX.test(value.trim());
}

function hash32(input: string, seed: number) {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function deterministicUuidV4FromText(input: string) {
  const base = `${input}::fiches-recettes::v11`;
  const hex = `${hash32(base, 2166136261)}${hash32(base, 2166136261 ^ 0x9e3779b9)}${hash32(base, 2166136261 ^ 0x85ebca6b)}${hash32(base, 2166136261 ^ 0xc2b2ae35)}`.slice(0, 32);
  const chars = hex.split("");
  chars[12] = "4";
  const variant = Number.parseInt(chars[16] || "0", 16);
  chars[16] = ((variant & 0x3) | 0x8).toString(16);
  const normalized = chars.join("");
  return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20, 32)}`;
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

  const ficheIdBase = fiche.id?.trim() || "";
  const fallbackSeed = `${fiche.title || "fiche"}-${fiche.createdAt || fiche.updatedAt || ""}`;
  let ficheId = ficheIdBase;
  if (!ficheIdBase) {
    ficheId = deterministicUuidV4FromText(fallbackSeed);
    globalWarnings.push({
      code: "MISSING_FICHE_ID",
      path: "fiche_id",
      message: `Missing fiche id for title '${fiche.title || "(untitled)"}', fallback generated`,
    });
  } else if (!isUuidV4(ficheIdBase)) {
    ficheId = deterministicUuidV4FromText(`${ficheIdBase}::${fallbackSeed}`);
    globalWarnings.push({
      code: "INVALID_FICHE_ID_NORMALIZED",
      path: "fiche_id",
      message: `Non-UUID fiche id normalized for title '${fiche.title || "(untitled)"}'`,
    });
  }

  const storageProfiles = mapStorageProfiles(fiche, warnings);
  const labelHints = mapLabelHints(fiche, storageProfiles, warnings);
  const portions = parseNumberOrNull(fiche.portions, "portions", warnings);

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
    portions,
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
