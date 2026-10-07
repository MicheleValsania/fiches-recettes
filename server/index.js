import express from "express";
import cors from "cors";
import pg from "pg";
import crypto from "node:crypto";
import { createAuth, createLoginAttemptTracker, safeEqual } from "./auth.js";
import { asyncRoute } from "./http.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { createSessionValidator } from "./sessionAccess.js";

const app = express();
const route = (method, path, handler) => app[method](path, asyncRoute(handler));
const PORT = process.env.PORT || 3001;
const authDisabled = process.env.AUTH_DISABLED === "true";
const legacyLoginEnabled = !authDisabled && process.env.LEGACY_LOGIN_ENABLED !== "false";
const appPassword = (process.env.APP_PASSWORD || "").trim();
const authTokenSecret = (process.env.AUTH_TOKEN_SECRET || "").trim();
const serviceToken = (process.env.FICHES_SERVICE_TOKEN || "").trim();
const defaultTenantId = (process.env.DEFAULT_TENANT_ID || "00000000-0000-4000-8000-000000000001").trim();
const defaultTenantSlug = (process.env.DEFAULT_TENANT_SLUG || "chefside-france").trim();
const defaultTenantName = (process.env.DEFAULT_TENANT_NAME || "ChefSide France").trim();
const registrationEnabled = process.env.REGISTRATION_ENABLED === "true";
const registrationInviteCode = (process.env.REGISTRATION_INVITE_CODE || "").trim();
const allowDbReset = process.env.ALLOW_DB_RESET === "true";
const dbResetToken = (process.env.DB_RESET_TOKEN || "").trim();
const requestedTokenTtl = Number(process.env.AUTH_TOKEN_TTL_SECONDS || 8 * 60 * 60);
const tokenTtlSeconds = Number.isFinite(requestedTokenTtl) && requestedTokenTtl > 0
  ? requestedTokenTtl
  : 8 * 60 * 60;

if (legacyLoginEnabled && !appPassword) {
  throw new Error("APP_PASSWORD is required when LEGACY_LOGIN_ENABLED is active.");
}
if (!authDisabled && !serviceToken) {
  throw new Error("FICHES_SERVICE_TOKEN is required unless AUTH_DISABLED=true.");
}
if (!defaultTenantId || !defaultTenantSlug || !defaultTenantName) {
  throw new Error("DEFAULT_TENANT_ID, DEFAULT_TENANT_SLUG and DEFAULT_TENANT_NAME cannot be empty.");
}
if (registrationEnabled && !registrationInviteCode) {
  throw new Error("REGISTRATION_INVITE_CODE is required when REGISTRATION_ENABLED=true.");
}
if (allowDbReset && !dbResetToken) {
  throw new Error("DB_RESET_TOKEN is required when ALLOW_DB_RESET=true.");
}

const auth = createAuth({
  enabled: !authDisabled,
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

route("get", "/api/auth/status", async (req, res) => {
  const authContext = await resolveRequestAuth(req);
  const tenant = authContext
    ? (
        await pool.query("SELECT id, slug, name FROM tenants WHERE id = $1", [authContext.tenantId])
      ).rows[0] || null
    : null;
  res.set("Cache-Control", "no-store");
  res.json({
    ok: true,
    authRequired: auth.authRequired,
    authenticated: Boolean(authContext && tenant),
    registrationEnabled,
    legacyLoginEnabled,
    tenant,
    user: authContext?.userId
      ? { id: authContext.userId, role: authContext.role }
      : null,
  });
});

route("post", "/api/auth/login", async (req, res) => {
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

  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");
  let session = null;
  let tenant = null;
  let user = null;

  if (email) {
    const { rows } = await pool.query(
      `SELECT app_user.id,
              app_user.email,
              app_user.display_name AS "displayName",
              app_user.password_hash AS "passwordHash",
              membership.tenant_id AS "tenantId",
              membership.role,
              tenant.slug AS "tenantSlug",
              tenant.name AS "tenantName"
       FROM app_users AS app_user
       JOIN tenant_memberships AS membership ON membership.user_id = app_user.id
       JOIN tenants AS tenant ON tenant.id = membership.tenant_id
       WHERE lower(app_user.email) = $1 AND app_user.is_active = true
       ORDER BY membership.created_at ASC
       LIMIT 1`,
      [email]
    );
    const account = rows[0];
    if (account && (await verifyPassword(password, account.passwordHash))) {
      session = auth.issueSessionToken({
        tenantId: account.tenantId,
        userId: account.id,
        role: account.role,
      });
      tenant = { id: account.tenantId, slug: account.tenantSlug, name: account.tenantName };
      user = { id: account.id, email: account.email, displayName: account.displayName, role: account.role };
    }
  } else if (legacyLoginEnabled && auth.passwordMatches(password)) {
    session = auth.issueSessionToken({ tenantId: defaultTenantId, role: "owner" });
    tenant = { id: defaultTenantId, slug: defaultTenantSlug, name: defaultTenantName };
  }

  if (!session) {
    loginAttempts.recordFailure(clientKey);
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }

  loginAttempts.reset(clientKey);
  res.json({
    ok: true,
    authRequired: true,
    tenant,
    user,
    ...session,
  });
});

route("post", "/api/auth/register", async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!registrationEnabled) {
    res.status(403).json({ ok: false, error: "registration_disabled" });
    return;
  }

  const clientKey = `register:${req.ip || req.socket.remoteAddress || "unknown"}`;
  const block = loginAttempts.isBlocked(clientKey);
  if (block.blocked) {
    res.set("Retry-After", String(block.retryAfterSeconds));
    res.status(429).json({ ok: false, error: "too_many_attempts" });
    return;
  }

  const inviteCode = String(req.body?.inviteCode || "").trim();
  if (!safeEqual(inviteCode, registrationInviteCode)) {
    loginAttempts.recordFailure(clientKey);
    res.status(403).json({ ok: false, error: "invalid_invite" });
    return;
  }

  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");
  const displayName = String(req.body?.displayName || "").trim();
  const organizationName = String(req.body?.organizationName || "").trim();
  if (!isValidEmail(email) || displayName.length < 2 || organizationName.length < 2 || password.length < 12) {
    res.status(400).json({ ok: false, error: "invalid_registration" });
    return;
  }

  const passwordHash = await hashPassword(password);
  const userId = crypto.randomUUID();
  const newTenantId = crypto.randomUUID();
  const tenantSlug = `${slugify(organizationName)}-${crypto.randomBytes(3).toString("hex")}`;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3)",
      [newTenantId, tenantSlug, organizationName]
    );
    await client.query(
      `INSERT INTO app_users (id, email, display_name, password_hash)
       VALUES ($1, $2, $3, $4)`,
      [userId, email, displayName, passwordHash]
    );
    await client.query(
      `INSERT INTO tenant_memberships (tenant_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [newTenantId, userId]
    );
    await seedCategories(client, newTenantId);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if (error?.code === "23505") {
      res.status(409).json({ ok: false, error: "account_exists" });
      return;
    }
    console.error("registration failed", error);
    res.status(500).json({ ok: false, error: "registration_failed" });
    return;
  } finally {
    client.release();
  }

  loginAttempts.reset(clientKey);
  const session = auth.issueSessionToken({ tenantId: newTenantId, userId, role: "owner" });
  res.status(201).json({
    ok: true,
    authRequired: true,
    tenant: { id: newTenantId, slug: tenantSlug, name: organizationName },
    user: { id: userId, email, displayName, role: "owner" },
    ...session,
  });
});

app.use("/api", asyncRoute(async (req, res, next) => {
  if (req.path === "/health") {
    next();
    return;
  }
  const authContext = await resolveRequestAuth(req);
  if (authContext) {
    if (authContext.role === "viewer" && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      res.status(403).json({ ok: false, error: "read_only" });
      return;
    }
    req.auth = authContext;
    next();
    return;
  }
  res.set("Cache-Control", "no-store");
  res.status(401).json({ ok: false, error: "unauthorized" });
}));

function tenantId(req) {
  if (!req.auth?.tenantId) throw new Error("Authenticated request is missing tenant context.");
  return req.auth.tenantId;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function slugify(value) {
  const slug = String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "organisation";
}

const { Pool } = pg;
const pool = new Pool({
  host: process.env.PGHOST || "localhost",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
  database: process.env.PGDATABASE || "fiches",
});

const validateSession = createSessionValidator(async ({ userId, tenantId: targetTenantId }) => {
  const { rows } = await pool.query(
    `SELECT app_user.is_active AS active, membership.role
     FROM app_users AS app_user
     JOIN tenant_memberships AS membership ON membership.user_id = app_user.id
     WHERE app_user.id = $1 AND membership.tenant_id = $2`,
    [userId, targetTenantId]
  );
  return rows[0] || null;
});

async function resolveRequestAuth(req) {
  return validateSession(auth.requestAuth(req));
}

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

      CREATE TABLE IF NOT EXISTS user_onboarding_progress (
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        completed_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
        tour_seen BOOLEAN NOT NULL DEFAULT false,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, user_id),
        FOREIGN KEY (tenant_id, user_id)
          REFERENCES tenant_memberships(tenant_id, user_id) ON DELETE CASCADE
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
      CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_lower_key ON app_users (lower(email));
      CREATE INDEX IF NOT EXISTS tenant_memberships_user_idx ON tenant_memberships (user_id);
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

route("get", "/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: "db_unreachable" });
  }
});

route("get", "/api/fiches", async (req, res) => {
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

route("get", "/api/fiches/:id", async (req, res) => {
  const { rows } = await pool.query(
    "SELECT data FROM fiches WHERE id = $1 AND tenant_id = $2",
    [req.params.id, tenantId(req)]
  );
  if (!rows[0]) return res.status(404).json({ error: "Not found" });
  res.json(rows[0].data);
});

route("get", "/api/categories", async (req, res) => {
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

const onboardingStepIds = new Set(["create", "compose", "suppliers", "save", "export"]);

route("get", "/api/onboarding", async (req, res) => {
  if (!req.auth?.userId) {
    res.json({ completedSteps: [], tourSeen: false, persisted: false });
    return;
  }
  const { rows } = await pool.query(
    `SELECT completed_steps AS "completedSteps", tour_seen AS "tourSeen"
     FROM user_onboarding_progress
     WHERE tenant_id = $1 AND user_id = $2`,
    [tenantId(req), req.auth.userId]
  );
  res.json({
    completedSteps: Array.isArray(rows[0]?.completedSteps) ? rows[0].completedSteps : [],
    tourSeen: Boolean(rows[0]?.tourSeen),
    persisted: true,
  });
});

route("put", "/api/onboarding", async (req, res) => {
  if (!req.auth?.userId) {
    res.json({ ok: true, persisted: false });
    return;
  }
  const completedSteps = Array.from(
    new Set(
      (Array.isArray(req.body?.completedSteps) ? req.body.completedSteps : [])
        .map((step) => String(step))
        .filter((step) => onboardingStepIds.has(step))
    )
  );
  const tourSeen = Boolean(req.body?.tourSeen);
  await pool.query(
    `INSERT INTO user_onboarding_progress (tenant_id, user_id, completed_steps, tour_seen)
     VALUES ($1, $2, $3::jsonb, $4)
     ON CONFLICT (tenant_id, user_id) DO UPDATE SET
       completed_steps = EXCLUDED.completed_steps,
       tour_seen = EXCLUDED.tour_seen,
       updated_at = now()`,
    [tenantId(req), req.auth.userId, JSON.stringify(completedSteps), tourSeen]
  );
  res.json({ ok: true, persisted: true });
});

route("post", "/api/fiches", async (req, res) => {
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

route("delete", "/api/fiches/:id", async (req, res) => {
  await pool.query("DELETE FROM fiches WHERE id = $1 AND tenant_id = $2", [req.params.id, tenantId(req)]);
  res.json({ ok: true });
});

if (allowDbReset) {
  route("post", "/api/reset", async (req, res) => {
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

route("get", "/api/suppliers", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, created_at AS "createdAt", updated_at AS "updatedAt"
     FROM suppliers WHERE tenant_id = $1 ORDER BY name ASC`,
    [tenantId(req)]
  );
  res.json(rows);
});

route("put", "/api/suppliers/:id", async (req, res) => {
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
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(data->'ingredients') = 'array' THEN data->'ingredients'
              ELSE '[]'::jsonb
            END
          ) ing
          WHERE ing->>'supplierId' = $1
             OR (
               (ing->>'supplierId') IS NULL
               AND lower(coalesce(ing->>'supplier', '')) = lower($3::text)
             )
        );
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

route("post", "/api/suppliers", async (req, res) => {
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

route("delete", "/api/suppliers/:id", async (req, res) => {
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
      WHERE tenant_id = $2
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(data->'ingredients') = 'array' THEN data->'ingredients'
              ELSE '[]'::jsonb
            END
          ) ing
          WHERE ing->>'supplierId' = $1
        );
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

route("get", "/api/suppliers/:id/products", async (req, res) => {
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

route("post", "/api/suppliers/:id/products", async (req, res) => {
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

route("put", "/api/suppliers/:id/products/:productId", async (req, res) => {
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

route("put", "/api/suppliers/:id/products/:productId/name", async (req, res) => {
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
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(data->'ingredients') = 'array' THEN data->'ingredients'
              ELSE '[]'::jsonb
            END
          ) ing
          WHERE ing->>'supplierProductId' = $1
             OR (
               ing->>'supplierId' = $3::text
               AND lower(coalesce(ing->>'name', '')) = lower($4::text)
             )
        );
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

route("delete", "/api/suppliers/:id/products/:productId", async (req, res) => {
  const supplierId = req.params.id;
  const productId = req.params.productId;
  await pool.query(
    "DELETE FROM supplier_products WHERE id = $1 AND supplier_id = $2 AND tenant_id = $3",
    [productId, supplierId, tenantId(req)]
  );
  res.json({ ok: true });
});

app.use((error, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  console.error("unhandled API error", error);
  res.status(500).json({ ok: false, error: "internal_error" });
});

app.listen(PORT, () => {
  console.log(`DB server running on http://localhost:${PORT}`);
});


