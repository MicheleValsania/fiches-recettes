const API_BASE = process.env.API_BASE || "http://localhost:3001/api";
const APPLY = process.argv.includes("--apply");

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(text, keywords) {
  return keywords.some((kw) => text.includes(kw));
}

function resolveExistingCategory(raw, byId, byDisplay) {
  const normalized = normalize(raw);
  if (!normalized) return null;
  if (byDisplay.has(normalized)) return byDisplay.get(normalized);
  if (byId.has(normalized)) return byId.get(normalized);

  const aliases = [
    { match: ["base dessert", "basedessert"], id: "base_dessert" },
    { match: ["sauce"], id: "sauce" },
    { match: ["base"], id: "base" },
    { match: ["entree", "starter", "antipasti"], id: "entree" },
    { match: ["pates", "pasta", "risotto"], id: "plat_pates" },
    { match: ["poisson", "fish"], id: "plat_poisson" },
    { match: ["viande", "meat"], id: "plat_viande" },
    { match: ["vegetarien", "vegetarian", "veg"], id: "plat_vegetarien" },
    { match: ["pizza"], id: "pizza" },
    { match: ["dessert", "dolce", "sweet"], id: "dessert" },
    { match: ["accompagnement", "side"], id: "accompagnement" },
    { match: ["sandwich froid"], id: "snack_sandwich_froid" },
    { match: ["sandwich chaud"], id: "snack_sandwich_chaud" },
    { match: ["wrap", "tacos"], id: "snack_wrap_tacos" },
    { match: ["burger"], id: "snack_burger" },
    { match: ["assiette", "plate"], id: "snack_assiette" },
    { match: ["salade", "bowl"], id: "snack_salade_bowl" },
    { match: ["dessert snack"], id: "snack_dessert" },
    { match: ["petit dejeuner", "breakfast"], id: "snack_petit_dejeuner" },
  ];

  for (const alias of aliases) {
    if (alias.match.some((token) => normalized.includes(token))) {
      return byId.get(alias.id) ?? null;
    }
  }
  return null;
}

function inferCategoryFromText(data, byId) {
  const title = normalize(data.title);
  const ingredientText = normalize((data.ingredients || []).map((ing) => ing.name || "").join(" "));
  const noteText = normalize(data.notes || "");
  const text = `${title} ${ingredientText} ${noteText}`.trim();
  if (!text) return null;

  const weights = new Map();
  const add = (id, score) => weights.set(id, (weights.get(id) || 0) + score);

  const sauceLikeTitle =
    title.startsWith("sauce ") ||
    title === "sauce" ||
    title.startsWith("salsa ") ||
    title === "salsa" ||
    title.startsWith("pesto ") ||
    title === "pesto";
  if (sauceLikeTitle) add("sauce", 8);
  else if (includesAny(text, ["sauce", "salsa", "vinaigrette", "pesto", "aioli", "mayonnaise"])) add("sauce", 2);
  if (includesAny(text, ["base dessert", "creme patissiere", "ganache", "meringue"])) add("base_dessert", 6);
  if (includesAny(text, ["base", "fond", "brodo", "stock"])) add("base", 3);

  if (includesAny(text, ["entree", "starter", "antipasti", "insalata entree"])) add("entree", 5);
  if (includesAny(text, ["pasta", "pates", "risotto", "gnocchi", "rigatoni", "spaghetti", "penne", "tagliatelle"])) {
    add("plat_pates", 5);
  }
  if (includesAny(text, ["poisson", "fish", "saumon", "thon", "merlu", "daurade", "bar", "cabillaud"])) {
    add("plat_poisson", 5);
  }
  if (includesAny(text, ["viande", "beef", "veau", "pollo", "chicken", "porc"])) add("plat_viande", 5);
  if (includesAny(text, ["vegetarien", "vegan", "tofu", "legumes"])) add("plat_vegetarien", 5);
  if (includesAny(text, ["pizza", "focaccia"])) add("pizza", 6);
  if (includesAny(text, ["dessert", "tiramisu", "cake", "mousse", "gelato", "brownie", "parfait"])) add("dessert", 6);
  if (includesAny(text, ["accompagnement", "contorno", "side dish"])) add("accompagnement", 5);

  if (includesAny(text, ["sandwich froid", "panino freddo"])) add("snack_sandwich_froid", 6);
  if (includesAny(text, ["sandwich chaud", "panino caldo", "toast"])) add("snack_sandwich_chaud", 6);
  if (includesAny(text, ["wrap", "tacos", "burrito"])) add("snack_wrap_tacos", 6);
  if (includesAny(text, ["burger", "hamburger"])) add("snack_burger", 7);
  if (includesAny(text, ["assiette", "piatto unico", "plate"])) add("snack_assiette", 5);
  if (includesAny(text, ["salade", "insalata", "bowl", "poke"])) add("snack_salade_bowl", 6);
  if (includesAny(text, ["dessert snack", "cookie", "donut", "muffin"])) add("snack_dessert", 5);
  if (includesAny(text, ["petit dejeuner", "breakfast", "cornetto", "croissant"])) add("snack_petit_dejeuner", 6);

  let bestId = null;
  let bestScore = 0;
  for (const [id, score] of weights.entries()) {
    if (score > bestScore && byId.has(id)) {
      bestId = id;
      bestScore = score;
    }
  }
  return bestId && bestScore >= 5 ? byId.get(bestId) : null;
}

async function fetchJson(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const categories = await fetchJson("/categories");
  const byId = new Map(categories.map((item) => [normalize(item.id), item]));
  const byDisplay = new Map(categories.map((item) => [normalize(item.displayName), item]));

  const fiches = await fetchJson("/fiches");
  const changes = [];
  let unchanged = 0;
  let noMatch = 0;

  for (const item of fiches) {
    const fiche = await fetchJson(`/fiches/${item.id}`);
    const currentCategory = (fiche.category || "").trim();

    const resolvedExisting = resolveExistingCategory(currentCategory, byId, byDisplay);
    const inferred = resolvedExisting || inferCategoryFromText(fiche, byId);

    if (!inferred) {
      noMatch += 1;
      continue;
    }

    const nextCategory = inferred.displayName;
    const equivalent = normalize(currentCategory) === normalize(nextCategory);
    const shouldUpdate = resolvedExisting ? currentCategory !== nextCategory : !equivalent ? true : currentCategory !== nextCategory;
    if (!shouldUpdate) {
      unchanged += 1;
      continue;
    }

    changes.push({
      id: fiche.id,
      title: fiche.title || "(untitled)",
      from: currentCategory || "(empty)",
      to: nextCategory,
      reason: resolvedExisting ? "mapped_existing" : "inferred_text",
      fiche,
    });
  }

  console.log(`Fiches scanned: ${fiches.length}`);
  console.log(`To update: ${changes.length}`);
  console.log(`Already aligned: ${unchanged}`);
  console.log(`No confident match: ${noMatch}`);

  if (changes.length > 0) {
    console.log("\nPreview:");
    for (const change of changes.slice(0, 20)) {
      console.log(`- ${change.title}: ${change.from} -> ${change.to} (${change.reason})`);
    }
    if (changes.length > 20) {
      console.log(`... and ${changes.length - 20} more`);
    }
  }

  if (!APPLY) {
    console.log("\nDry run only. Re-run with --apply to persist changes.");
    return;
  }

  for (const change of changes) {
    const payload = {
      ...change.fiche,
      category: change.to,
      updatedAt: new Date().toISOString(),
    };
    const res = await fetch(`${API_BASE}/fiches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`Update failed for ${change.id} (${change.title}) -> HTTP ${res.status}`);
    }
  }

  console.log(`\nApplied updates: ${changes.length}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
