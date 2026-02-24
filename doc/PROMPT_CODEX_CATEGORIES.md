# Prompt Codex — Système de catégories (branch: tournels)

## Contexte

Application React + Node.js + PostgreSQL de gestion de fiches techniques.
Le champ `category` dans `FicheTechnique` est actuellement une string libre.

On veut introduire un système de catégories structurées, avec :
- une liste de catégories valides définie côté serveur
- un dropdown avec suggestion dans le formulaire fiche (FicheForm.tsx)
- les catégories déjà insérées en base au démarrage du serveur

**Branch de travail : `tournels`** (ne pas modifier le branch `main`)

---

## Tâche 1 — Créer la table `categories` dans PostgreSQL

Dans `server/index.js`, au moment de l'initialisation des tables (là où se trouvent les `CREATE TABLE IF NOT EXISTS`), ajouter :

```sql
CREATE TABLE IF NOT EXISTS categories (
  id           TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  point_vente  TEXT NOT NULL DEFAULT 'commun',
  sort_order   INTEGER NOT NULL DEFAULT 0
);
```

Puis insérer les catégories par défaut avec `INSERT ... ON CONFLICT DO NOTHING` pour que ce soit idempotent :

```sql
INSERT INTO categories (id, display_name, point_vente, sort_order) VALUES
  -- Catégories communes (cuisine centrale / production)
  ('base',              'Base',                   'commun',     1),
  ('base_dessert',      'Base dessert',           'commun',     2),

  -- Ristorante
  ('entree',            'Entrée',                 'ristorante', 10),
  ('plat_pates',        'Pâtes & Risotto',        'ristorante', 11),
  ('plat_poisson',      'Poisson',                'ristorante', 12),
  ('plat_viande',       'Viande',                 'ristorante', 13),
  ('plat_vegetarien',   'Végétarien',             'ristorante', 14),
  ('pizza',             'Pizza',                  'ristorante', 15),
  ('dessert',           'Dessert',                'ristorante', 16),
  ('accompagnement',    'Accompagnement',         'ristorante', 17),

  -- Snack Bar
  ('snack_sandwich_froid',  'Sandwich froid',     'snack_bar',  20),
  ('snack_sandwich_chaud',  'Sandwich chaud',     'snack_bar',  21),
  ('snack_wrap_tacos',      'Wrap & Tacos',       'snack_bar',  22),
  ('snack_burger',          'Burger',             'snack_bar',  23),
  ('snack_assiette',        'Assiette',           'snack_bar',  24),
  ('snack_salade_bowl',     'Salade & Bowl',      'snack_bar',  25),
  ('snack_dessert',         'Dessert snack',      'snack_bar',  26),
  ('snack_petit_dejeuner',  'Petit déjeuner',     'snack_bar',  27)

ON CONFLICT (id) DO NOTHING;
```

---

## Tâche 2 — Nouvel endpoint API

Dans `server/index.js`, ajouter :

```
GET /api/categories
```

Retourne toutes les catégories triées par `sort_order` :

```json
[
  { "id": "base", "displayName": "Base", "pointVente": "commun", "sortOrder": 1 },
  ...
]
```

---

## Tâche 3 — Modifier FicheForm.tsx

Le champ `category` est actuellement un `<input>` texte libre (ligne ~70 dans FicheForm.tsx).

Le remplacer par un `<select>` qui :
1. Charge les catégories via `GET /api/categories` au montage du composant
2. Affiche les options groupées par `pointVente` avec `<optgroup>`
3. Conserve une option vide en tête ("— Choisir une catégorie —")
4. Reste fonctionnel même si l'API échoue (fallback sur input texte)

Ordre des groupes dans le select :
1. Commun (base, base_dessert)
2. Ristorante
3. Snack Bar

---

## Tâche 4 — Mettre à jour src/utils/db.ts

Ajouter une fonction :

```typescript
export async function listCategories(): Promise<{ id: string; displayName: string; pointVente: string; sortOrder: number }[]> {
  const res = await fetch(`${API_BASE}/categories`);
  if (!res.ok) return [];
  return res.json();
}
```

---

## Ce qu'il ne faut PAS faire

- Ne pas modifier le type `FicheTechnique` dans `src/types/fiche.ts` — `category` reste `string`
- Ne pas créer de table `points_vente` séparée — c'est le champ `point_vente` TEXT dans `categories` qui suffit pour l'instant
- Ne pas toucher le branch `main`
- Ne pas modifier la logique de filtrage dans la bibliothèque (elle fonctionne déjà sur le champ category)

---

## Résultat attendu

- Le champ catégorie dans le formulaire fiche devient un dropdown structuré
- Les catégories sont stockées en DB et récupérées via API
- Les 51 fiches existantes ne sont pas touchées (leur category string reste valide)
- Le système est extensible : on pourra ajouter des catégories via SQL ou futur endpoint admin
