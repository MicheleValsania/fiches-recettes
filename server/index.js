import express from "express";
import cors from "cors";
import pg from "pg";
import crypto from "node:crypto";
import { createAuth, createLoginAttemptTracker, safeEqual } from "./auth.js";

const app = express();
const PORT = process.env.PORT || 3001;
const authDisabled = process.env.AUTH_DISABLED === "true";
const appPassword = (process.env.APP_PASSWORD || "").trim();
const authTokenSecret = (process.env.AUTH_TOKEN_SECRET || "").trim();
const serviceToken = (process.env.FICHES_SERVICE_TOKEN || "").trim();
const defaultTenantId = (process.env.DEFAULT_TENANT_ID || "00000000-0000-4000-8000-000000000001").trim();
const defaultTenantSlug = (process.env.DEFAULT_TENANT_SLUG || "chefside-france").trim();
const defaultTenantName = (process.env.DEFAULT_TENANT_NAME || "ChefSide France").trim();
const allowDbReset = process.env.ALLOW_DB_RESET === "true";
const dbResetToken = (process.env.DB_RESET_TOKEN || "").trim();
const requestedTokenTtl = Number(process.env.AUTH_TOKEN_TTL_SECONDS || 8 * 60 * 60);
const tokenTtlSeconds = Number.isFinite(requestedTokenTtl) && requestedTokenTtl > 0
  ? requestedTokenTtl
  : 8 * 60 * 60;

if (!authDisabled && !appPassword) {
  throw new Error("APP_PASSWORD is required unless AUTH_DISABLED=true.");
}
if (!authDisabled && !serviceToken) {
  throw new Error("FICHES_SERVICE_TOKEN is required unless AUTH_DISABLED=true.");
}
if (!defaultTenantId || !defaultTenantSlug || !defaultTenantName) {
  throw new Error("DEFAULT_TENANT_ID, DEFAULT_TENANT_SLUG and DEFAULT_TENANT_NAME cannot be empty.");
}
if (allowDbReset && !dbResetToken) {
  throw new Error("DB_RESET_TOKEN is required when ALLOW_DB_RESET=true.");
}

const auth = createAuth({
  password: authDisabled ? "" : appPassword,
  tokenSecret: authTokenSecret,
  serviceToken: authDisabled ? "" : serviceToken,
  tenantId: defaultTenantId,
  tokenTtlSeconds,
});
const loginAttempts = createLoginAttemptTracker();

app.set("trust proxy", 1);

const allowedOrigins = (
  process.env.CORS_ALLOWED_ORIGINS ||
  "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174"
)
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Service-Token", "X-Reset-Token"],
  })
);
app.use(express.json({ limit: "2mb" }));
app.use((_req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "DENY");
  res.set("Referrer-Policy", "no-referrer");
  next();
});

app.get("/api/auth/status", (req, res) => {
  const authContext = auth.requestAuth(req);
  res.set("Cache-Control", "no-store");
  res.json({
    ok: true,
    authRequired: auth.authRequired,
    authenticated: Boolean(authContext),
    tenant: authContext
      ? { id: authContext.tenantId, slug: defaultTenantSlug, name: defaultTenantName }
      : null,
  });
});

app.post("/api/auth/login", (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!auth.authRequired) {
    res.json({ ok: true, authRequired: false, token: null, expiresAt: null });
    return;
  }

  const clientKey = req.ip || req.socket.remoteAddress || "unknown";
  const block = loginAttempts.isBlocked(clientKey);
  if (block.blocked) {
    res.set("Retry-After", String(block.retryAfterSeconds));
    res.status(429).json({ ok: false, error: "too_many_attempts" });
    return;
  }

  if (!auth.passwordMatches(req.body?.password)) {
    loginAttempts.recordFailure(clientKey);
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }

  loginAttempts.reset(clientKey);
  const session = auth.issueSessionToken();
  res.json({
    ok: true,
    authRequired: true,
    tenant: { id: defaultTenantId, slug: defaultTenantSlug, name: defaultTenantName },
    ...session,
  });
});

app.use("/api", (req, res, next) => {
  if (req.path === "/health") {
    next();
    return;
  }
  const authContext = auth.requestAuth(req);
  if (authContext) {
    req.auth = authContext;
    next();
    return;
  }
  res.set("Cache-Control", "no-store");
  res.status(401).json({ ok: false, error: "unauthorized" });
});

function tenantId(req) {
  if (!req.auth?.tenantId) throw new Error("Authenticated request is missing tenant context.");
  return req.auth.tenantId;
}

const { Pool } = pg;
const pool = new Pool({
  host: process.env.PGHOST || "localhost",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
  database: process.env.PGDATABASE || "fiches",
});

async function bootstrapSchema() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS app_users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        display_name TEXT,
        password_hash TEXT,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS tenant_memberships (
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, user_id)
      );
    `);

    await client.query(
      `INSERT INTO tenants (id, slug, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name, updated_at = now()`,
      [defaultTenantId, defaultTenantSlug, defaultTenantName]
    );

    await client.query(`
      CREATE TABLE IF NOT EXISTS fiches (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        title TEXT,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS suppliers (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS supplier_products (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        source_code TEXT,
        source_price NUMERIC,
        source_unit TEXT,
        unit_price NUMERIC,
        unit TEXT,
        updated_at TIMESTAMPTZ NOT NULL,
        UNIQUE (supplier_id, name)
      );

      CREATE TABLE IF NOT EXISTS categories (
        tenant_id TEXT NOT NULL,
        id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        point_vente TEXT NOT NULL DEFAULT 'commun',
        sort_order INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (tenant_id, id)
      );
    `);

    await client.query(`
      ALTER TABLE fiches ADD COLUMN IF NOT EXISTS tenant_id TEXT;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS tenant_id TEXT;
      ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS tenant_id TEXT;
      ALTER TABLE categories ADD COLUMN IF NOT EXISTS tenant_id TEXT;
      ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS source_code TEXT;
      ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS source_price NUMERIC;
      ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS source_unit TEXT;
    `);

    await client.query("UPDATE fiches SET tenant_id = $1 WHERE tenant_id IS NULL", [defaultTenantId]);
    await client.query("UPDATE suppliers SET tenant_id = $1 WHERE tenant_id IS NULL", [defaultTenantId]);
    await client.query(
      `UPDATE supplier_products AS product
       SET tenant_id = supplier.tenant_id
       FROM suppliers AS supplier
       WHERE product.supplier_id = supplier.id AND product.tenant_id IS NULL`
    );
    await client.query("UPDATE supplier_products SET tenant_id = $1 WHERE tenant_id IS NULL", [defaultTenantId]);
    await client.query("UPDATE categories SET tenant_id = $1 WHERE tenant_id IS NULL", [defaultTenantId]);

    await client.query(`
      ALTER TABLE fiches ALTER COLUMN tenant_id SET NOT NULL;
      ALTER TABLE suppliers ALTER COLUMN tenant_id SET NOT NULL;
      ALTER TABLE supplier_products ALTER COLUMN tenant_id SET NOT NULL;
      ALTER TABLE categories ALTER COLUMN tenant_id SET NOT NULL;

      ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS suppliers_name_key;

      CREATE UNIQUE INDEX IF NOT EXISTS suppliers_tenant_name_key ON suppliers (tenant_id, name);
      CREATE UNIQUE INDEX IF NOT EXISTS suppliers_tenant_id_key ON suppliers (tenant_id, id);
      CREATE UNIQUE INDEX IF NOT EXISTS supplier_products_tenant_supplier_name_key
        ON supplier_products (tenant_id, supplier_id, name);
      CREATE INDEX IF NOT EXISTS fiches_tenant_updated_idx ON fiches (tenant_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS supplier_products_tenant_idx ON supplier_products (tenant_id, supplier_id);
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = 'categories'::regclass
            AND contype = 'p'
            AND pg_get_constraintdef(oid) = 'PRIMARY KEY (tenant_id, id)'
        ) THEN
          ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_pkey;
          ALTER TABLE categories ADD CONSTRAINT categories_pkey PRIMARY KEY (tenant_id, id);
        END IF;
      END $$;
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiches_tenant_fk') THEN
          ALTER TABLE fiches ADD CONSTRAINT fiches_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_tenant_fk') THEN
          ALTER TABLE suppliers ADD CONSTRAINT suppliers_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_products_tenant_fk') THEN
          ALTER TABLE supplier_products ADD CONSTRAINT supplier_products_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'categories_tenant_fk') THEN
          ALTER TABLE categories ADD CONSTRAINT categories_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_products_tenant_supplier_fk') THEN
          ALTER TABLE supplier_products
          ADD CONSTRAINT supplier_products_tenant_supplier_fk
          FOREIGN KEY (tenant_id, supplier_id) REFERENCES suppliers(tenant_id, id) ON DELETE CASCADE;
        END IF;
      END $$;
    `);

    await seedCategories(client, defaultTenantId);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function seedCategories(client, targetTenantId) {
  await client.query(
    `INSERT INTO categories (tenant_id, id, display_name, point_vente, sort_order) VALUES
      ($1, 'base', 'Base', 'commun', 1),
      ($1, 'base_dessert', 'Base dessert', 'commun', 2),
      ($1, 'sauce', 'Sauce', 'commun', 3),
      ($1, 'entree', 'Entree', 'ristorante', 10),
      ($1, 'plat_pates', 'Pates & Risotto', 'ristorante', 11),
      ($1, 'plat_poisson', 'Poisson', 'ristorante', 12),
      ($1, 'plat_viande', 'Viande', 'ristorante', 13),
      ($1, 'plat_vegetarien', 'Vegetarien', 'ristorante', 14),
      ($1, 'pizza', 'Pizza', 'ristorante', 15),
      ($1, 'dessert', 'Dessert', 'ristorante', 16),
      ($1, 'accompagnement', 'Accompagnement', 'ristorante', 17),
      ($1, 'snack_sandwich_froid', 'Sandwich froid', 'snack_bar', 20),
      ($1, 'snack_sandwich_chaud', 'Sandwich chaud', 'snack_bar', 21),
      ($1, 'snack_wrap_tacos', 'Wrap & Tacos', 'snack_bar', 22),
      ($1, 'snack_burger', 'Burger', 'snack_bar', 23),
      ($1, 'snack_assiette', 'Assiette', 'snack_bar', 24),
      ($1, 'snack_salade_bowl', 'Salade & Bowl', 'snack_bar', 25),
      ($1, 'snack_dessert', 'Dessert snack', 'snack_bar', 26),
      ($1, 'snack_petit_dejeuner', 'Petit dejeuner', 'snack_bar', 27),
      ($1, 'snack_patate', 'Patate', 'snack_bar', 28)
     ON CONFLICT (tenant_id, id) DO NOTHING`,
    [targetTenantId]
  );
}

await bootstrapSchema();

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: "db_unreachable" });
  }
});

app.get("/api/fiches", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, title, data->>'category' AS category,
            created_at AS "createdAt", updated_at AS "updatedAt"
     FROM fiches
     WHERE tenant_id = $1
     ORDER BY updated_at DESC`,
    [tenantId(req)]
  );
  res.json(rows);
});

app.get("/api/fiches/:id", async (req, res) => {
  const { rows } = await pool.query(
    "SELECT data FROM fiches WHERE id = $1 AND tenant_id = $2",
    [req.params.id, tenantId(req)]
  );
  if (!rows[0]) return res.status(404).json({ error: "Not found" });
  res.json(rows[0].data);
});

app.get("/api/categories", async (req, res) => {
  const { rows } = await pool.query(
    `
    SELECT id,
           display_name AS "displayName",
           point_vente AS "pointVente",
           sort_order AS "sortOrder"
    FROM categories
    WHERE tenant_id = $1
    ORDER BY sort_order ASC, display_name ASC
  `,
    [tenantId(req)]
  );
  res.json(rows);
});

app.post("/api/fiches", async (req, res) => {
  const fiche = req.body;
  if (!fiche?.id) return res.status(400).json({ error: "Missing id" });

  const now = new Date().toISOString();
  const createdAt = fiche.createdAt || now;
  const updatedAt = fiche.updatedAt || now;
  const title = fiche.title || "";

  const { rows } = await pool.query(
    `
    INSERT INTO fiches (id, tenant_id, title, data, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title,
      data = EXCLUDED.data,
      updated_at = EXCLUDED.updated_at
    WHERE fiches.tenant_id = EXCLUDED.tenant_id
    RETURNING id;
  `,
    [fiche.id, tenantId(req), title, fiche, createdAt, updatedAt]
  );

  if (!rows[0]) return res.status(409).json({ error: "ID belongs to another tenant" });

  res.json({ ok: true });
});

app.delete("/api/fiches/:id", async (req, res) => {
  await pool.query("DELETE FROM fiches WHERE id = $1 AND tenant_id = $2", [req.params.id, tenantId(req)]);
  res.json({ ok: true });
});

if (allowDbReset) {
  app.post("/api/reset", async (req, res) => {
    const providedResetToken = req.get("x-reset-token") || "";
    if (!providedResetToken || !safeEqual(providedResetToken, dbResetToken)) {
      res.status(403).json({ ok: false, error: "reset_forbidden" });
      return;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const targetTenantId = tenantId(req);
      await client.query("DELETE FROM fiches WHERE tenant_id = $1", [targetTenantId]);
      await client.query("DELETE FROM suppliers WHERE tenant_id = $1", [targetTenantId]);
      await client.query("DELETE FROM categories WHERE tenant_id = $1", [targetTenantId]);
      await seedCategories(client, targetTenantId);
      await client.query("COMMIT");
      res.json({ ok: true });
    } catch {
      await client.query("ROLLBACK");
      res.status(500).json({ ok: false });
    } finally {
      client.release();
    }
  });
}

app.get("/api/suppliers", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, created_at AS "createdAt", updated_at AS "updatedAt"
     FROM suppliers WHERE tenant_id = $1 ORDER BY name ASC`,
    [tenantId(req)]
  );
  res.json(rows);
});

app.put("/api/suppliers/:id", async (req, res) => {
  const supplierId = req.params.id;
  const targetTenantId = tenantId(req);
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Missing name" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: existing } = await client.query(
      "SELECT name FROM suppliers WHERE id = $1 AND tenant_id = $2",
      [supplierId, targetTenantId]
    );
    if (!existing[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Not found" });
    }

    const oldName = existing[0].name;
    const now = new Date().toISOString();
    const { rows } = await client.query(
      `
      UPDATE suppliers
      SET name = $1,
          updated_at = $2
      WHERE id = $3 AND tenant_id = $4
      RETURNING id, name, created_at AS "createdAt", updated_at AS "updatedAt";
    `,
      [name, now, supplierId, targetTenantId]
    );

    await client.query(
      `
      UPDATE fiches
      SET data = jsonb_set(
        data,
        '{ingredients}',
        (
          SELECT COALESCE(
            jsonb_agg(
            CASE
              WHEN ing->>'supplierId' = $1 THEN
                ing || jsonb_build_object('supplier', $2::text)
              WHEN (ing->>'supplierId') IS NULL AND lower(coalesce(ing->>'supplier','')) = lower($3::text) THEN
                ing || jsonb_build_object('supplier', $2::text, 'supplierId', $1::text)
              ELSE ing
            END
            ),
            '[]'::jsonb
          )
          FROM jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(data->'ingredients') = 'array' THEN data->'ingredients'
              ELSE '[]'::jsonb
            END
          ) ing
        )
      ),
      updated_at = now()
      WHERE tenant_id = $4
        AND (data::text LIKE '%' || $1 || '%' OR data::text ILIKE '%' || $3::text || '%');
    `,
      [supplierId, name, oldName, targetTenantId]
    );

    await client.query("COMMIT");
    res.json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("rename supplier failed", err);
    if (err?.code === "23505") {
      return res.status(409).json({ error: "Duplicate name" });
    }
    res.status(500).json({ error: "update_failed" });
  } finally {
    client.release();
  }
});

app.post("/api/suppliers", async (req, res) => {
  const targetTenantId = tenantId(req);
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Missing name" });

  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const { rows } = await pool.query(
    `
    INSERT INTO suppliers (id, tenant_id, name, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $4)
    ON CONFLICT (tenant_id, name) DO UPDATE SET updated_at = EXCLUDED.updated_at
    RETURNING id, name, created_at AS "createdAt", updated_at AS "updatedAt";
  `,
    [id, targetTenantId, name, now]
  );
  res.json(rows[0]);
});

app.delete("/api/suppliers/:id", async (req, res) => {
  const supplierId = req.params.id;
  const targetTenantId = tenantId(req);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "SELECT id, name FROM suppliers WHERE id = $1 AND tenant_id = $2",
      [supplierId, targetTenantId]
    );
    if (!rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Not found" });
    }

    await client.query(
      `
      UPDATE fiches
      SET data = jsonb_set(
        data,
        '{ingredients}',
        (
          SELECT COALESCE(
            jsonb_agg(
              CASE
                WHEN ing->>'supplierId' = $1 THEN
                  ing - 'supplierId' - 'supplierProductId'
                ELSE ing
              END
            ),
            '[]'::jsonb
          )
          FROM jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(data->'ingredients') = 'array' THEN data->'ingredients'
              ELSE '[]'::jsonb
            END
          ) ing
        )
      ),
      updated_at = now()
      WHERE tenant_id = $2 AND data::text LIKE '%' || $1 || '%';
    `,
      [supplierId, targetTenantId]
    );

    await client.query("DELETE FROM suppliers WHERE id = $1 AND tenant_id = $2", [supplierId, targetTenantId]);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "delete_failed" });
  } finally {
    client.release();
  }
});

app.get("/api/suppliers/:id/products", async (req, res) => {
  const targetTenantId = tenantId(req);
  const { rows } = await pool.query(
    `
    SELECT id,
           supplier_id AS "supplierId",
           name,
           source_code AS "supplierCode",
           source_price AS "sourcePrice",
           source_unit AS "sourceUnit",
           unit_price AS "unitPrice",
           unit,
           updated_at AS "updatedAt"
    FROM supplier_products
    WHERE supplier_id = $1 AND tenant_id = $2
    ORDER BY name ASC
  `,
    [req.params.id, targetTenantId]
  );
  res.json(rows);
});

app.post("/api/suppliers/:id/products", async (req, res) => {
  const supplierId = req.params.id;
  const targetTenantId = tenantId(req);
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Missing name" });

  const supplierCode = req.body?.supplierCode ? String(req.body.supplierCode).trim() : null;
  const sourcePrice = req.body?.sourcePrice ?? null;
  const sourceUnit = req.body?.sourceUnit ? String(req.body.sourceUnit).trim() : null;
  const unitPrice = req.body?.unitPrice ?? null;
  const unit = req.body?.unit ?? null;
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const { rows: suppliers } = await pool.query(
    "SELECT id FROM suppliers WHERE id = $1 AND tenant_id = $2",
    [supplierId, targetTenantId]
  );
  if (!suppliers[0]) return res.status(404).json({ error: "Supplier not found" });

  const { rows } = await pool.query(
    `
    INSERT INTO supplier_products (
      id, tenant_id, supplier_id, name, source_code, source_price, source_unit, unit_price, unit, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (tenant_id, supplier_id, name) DO UPDATE SET
      source_code = EXCLUDED.source_code,
      source_price = EXCLUDED.source_price,
      source_unit = EXCLUDED.source_unit,
      unit_price = EXCLUDED.unit_price,
      unit = EXCLUDED.unit,
      updated_at = EXCLUDED.updated_at
    RETURNING id,
              supplier_id AS "supplierId",
              name,
              source_code AS "supplierCode",
              source_price AS "sourcePrice",
              source_unit AS "sourceUnit",
              unit_price AS "unitPrice",
              unit,
              updated_at AS "updatedAt";
  `,
    [id, targetTenantId, supplierId, name, supplierCode, sourcePrice, sourceUnit, unitPrice, unit, now]
  );
  res.json(rows[0]);
});

app.put("/api/suppliers/:id/products/:productId", async (req, res) => {
  const supplierId = req.params.id;
  const productId = req.params.productId;
  const targetTenantId = tenantId(req);
  const supplierCode = req.body?.supplierCode ? String(req.body.supplierCode).trim() : null;
  const sourcePrice = req.body?.sourcePrice ?? null;
  const sourceUnit = req.body?.sourceUnit ? String(req.body.sourceUnit).trim() : null;
  const unitPrice = req.body?.unitPrice ?? null;
  const unit = req.body?.unit ?? null;
  const now = new Date().toISOString();

  const { rows } = await pool.query(
    `
    UPDATE supplier_products
    SET source_code = $1,
        source_price = $2,
        source_unit = $3,
        unit_price = $4,
        unit = $5,
        updated_at = $6
    WHERE id = $7 AND supplier_id = $8 AND tenant_id = $9
    RETURNING id,
              supplier_id AS "supplierId",
              name,
              source_code AS "supplierCode",
              source_price AS "sourcePrice",
              source_unit AS "sourceUnit",
              unit_price AS "unitPrice",
              unit,
              updated_at AS "updatedAt";
  `,
    [supplierCode, sourcePrice, sourceUnit, unitPrice, unit, now, productId, supplierId, targetTenantId]
  );
  if (!rows[0]) return res.status(404).json({ error: "Not found" });
  res.json(rows[0]);
});

app.put("/api/suppliers/:id/products/:productId/name", async (req, res) => {
  const supplierId = req.params.id;
  const productId = req.params.productId;
  const targetTenantId = tenantId(req);
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Missing name" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: existing } = await client.query(
      "SELECT name FROM supplier_products WHERE id = $1 AND supplier_id = $2 AND tenant_id = $3",
      [productId, supplierId, targetTenantId]
    );
    if (!existing[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Not found" });
    }

    const oldName = existing[0].name;
    const now = new Date().toISOString();
    const { rows } = await client.query(
      `
      UPDATE supplier_products
      SET name = $1,
          updated_at = $2
      WHERE id = $3 AND supplier_id = $4 AND tenant_id = $5
      RETURNING id,
                supplier_id AS "supplierId",
                name,
                source_code AS "supplierCode",
                source_price AS "sourcePrice",
                source_unit AS "sourceUnit",
                unit_price AS "unitPrice",
                unit,
                updated_at AS "updatedAt";
    `,
      [name, now, productId, supplierId, targetTenantId]
    );

    await client.query(
      `
      UPDATE fiches
      SET data = jsonb_set(
        data,
        '{ingredients}',
        (
          SELECT COALESCE(
            jsonb_agg(
            CASE
              WHEN ing->>'supplierProductId' = $1 THEN
                ing || jsonb_build_object('name', $2::text, 'supplierId', $3::text)
              WHEN ing->>'supplierId' = $3::text AND lower(coalesce(ing->>'name','')) = lower($4::text) THEN
                ing || jsonb_build_object('name', $2::text)
              ELSE ing
            END
            ),
            '[]'::jsonb
          )
          FROM jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(data->'ingredients') = 'array' THEN data->'ingredients'
              ELSE '[]'::jsonb
            END
          ) ing
        )
      ),
      updated_at = now()
      WHERE tenant_id = $5
        AND (data::text LIKE '%' || $1 || '%' OR data::text ILIKE '%' || $4::text || '%');
    `,
      [productId, name, supplierId, oldName, targetTenantId]
    );

    await client.query("COMMIT");
    res.json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("rename product failed", err);
    if (err?.code === "23505") {
      return res.status(409).json({ error: "Duplicate name" });
    }
    res.status(500).json({ error: "update_failed" });
  } finally {
    client.release();
  }
});

app.delete("/api/suppliers/:id/products/:productId", async (req, res) => {
  const supplierId = req.params.id;
  const productId = req.params.productId;
  await pool.query(
    "DELETE FROM supplier_products WHERE id = $1 AND supplier_id = $2 AND tenant_id = $3",
    [productId, supplierId, tenantId(req)]
  );
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`DB server running on http://localhost:${PORT}`);
});


