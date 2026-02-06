import express from "express";
import cors from "cors";
import pg from "pg";
import crypto from "node:crypto";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json({ limit: "2mb" }));

const { Pool } = pg;
const pool = new Pool({
  host: process.env.PGHOST || "localhost",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
  database: process.env.PGDATABASE || "fiches",
});

await pool.query(`
  CREATE TABLE IF NOT EXISTS fiches (
    id TEXT PRIMARY KEY,
    title TEXT,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  );
`);

await pool.query(`
  CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  );
`);

await pool.query(`
  CREATE TABLE IF NOT EXISTS supplier_products (
    id TEXT PRIMARY KEY,
    supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    unit_price NUMERIC,
    unit TEXT,
    updated_at TIMESTAMPTZ NOT NULL,
    UNIQUE (supplier_id, name)
  );
`);

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: "db_unreachable" });
  }
});

app.get("/api/fiches", async (_req, res) => {
  const { rows } = await pool.query(
    "SELECT id, title, created_at AS \"createdAt\", updated_at AS \"updatedAt\" FROM fiches ORDER BY updated_at DESC"
  );
  res.json(rows);
});

app.get("/api/fiches/:id", async (req, res) => {
  const { rows } = await pool.query(
    "SELECT data FROM fiches WHERE id = $1",
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Not found" });
  res.json(rows[0].data);
});

app.post("/api/fiches", async (req, res) => {
  const fiche = req.body;
  if (!fiche?.id) return res.status(400).json({ error: "Missing id" });

  const now = new Date().toISOString();
  const createdAt = fiche.createdAt || now;
  const updatedAt = fiche.updatedAt || now;
  const title = fiche.title || "";

  await pool.query(
    `
    INSERT INTO fiches (id, title, data, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title,
      data = EXCLUDED.data,
      updated_at = EXCLUDED.updated_at;
  `,
    [fiche.id, title, fiche, createdAt, updatedAt]
  );

  res.json({ ok: true });
});

app.delete("/api/fiches/:id", async (req, res) => {
  await pool.query("DELETE FROM fiches WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

app.post("/api/reset", async (_req, res) => {
  try {
    await pool.query("TRUNCATE TABLE fiches, supplier_products, suppliers RESTART IDENTITY CASCADE");
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false });
  }
});

app.get("/api/suppliers", async (_req, res) => {
  const { rows } = await pool.query(
    "SELECT id, name, created_at AS \"createdAt\", updated_at AS \"updatedAt\" FROM suppliers ORDER BY name ASC"
  );
  res.json(rows);
});

app.put("/api/suppliers/:id", async (req, res) => {
  const supplierId = req.params.id;
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Missing name" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: existing } = await client.query("SELECT name FROM suppliers WHERE id = $1", [supplierId]);
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
      WHERE id = $3
      RETURNING id, name, created_at AS "createdAt", updated_at AS "updatedAt";
    `,
      [name, now, supplierId]
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
                ing || jsonb_build_object('supplier', $2::text, 'supplierId', $1)
              ELSE ing
            END
            ),
            '[]'::jsonb
          )
          FROM jsonb_array_elements(data->'ingredients') ing
        )
      ),
      updated_at = now()
      WHERE data::text LIKE '%' || $1 || '%' OR data::text ILIKE '%' || $3::text || '%';
    `,
      [supplierId, name, oldName]
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
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Missing name" });

  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const { rows } = await pool.query(
    `
    INSERT INTO suppliers (id, name, created_at, updated_at)
    VALUES ($1, $2, $3, $3)
    ON CONFLICT (name) DO UPDATE SET updated_at = EXCLUDED.updated_at
    RETURNING id, name, created_at AS "createdAt", updated_at AS "updatedAt";
  `,
    [id, name, now]
  );
  res.json(rows[0]);
});

app.delete("/api/suppliers/:id", async (req, res) => {
  const supplierId = req.params.id;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT id, name FROM suppliers WHERE id = $1", [supplierId]);
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
          FROM jsonb_array_elements(data->'ingredients') ing
        )
      ),
      updated_at = now()
      WHERE data::text LIKE '%' || $1 || '%';
    `,
      [supplierId]
    );

    await client.query("DELETE FROM suppliers WHERE id = $1", [supplierId]);
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
  const { rows } = await pool.query(
    `
    SELECT id,
           supplier_id AS "supplierId",
           name,
           unit_price AS "unitPrice",
           unit,
           updated_at AS "updatedAt"
    FROM supplier_products
    WHERE supplier_id = $1
    ORDER BY name ASC
  `,
    [req.params.id]
  );
  res.json(rows);
});

app.post("/api/suppliers/:id/products", async (req, res) => {
  const supplierId = req.params.id;
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Missing name" });

  const unitPrice = req.body?.unitPrice ?? null;
  const unit = req.body?.unit ?? null;
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const { rows } = await pool.query(
    `
    INSERT INTO supplier_products (id, supplier_id, name, unit_price, unit, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (supplier_id, name) DO UPDATE SET
      unit_price = EXCLUDED.unit_price,
      unit = EXCLUDED.unit,
      updated_at = EXCLUDED.updated_at
    RETURNING id,
              supplier_id AS "supplierId",
              name,
              unit_price AS "unitPrice",
              unit,
              updated_at AS "updatedAt";
  `,
    [id, supplierId, name, unitPrice, unit, now]
  );
  res.json(rows[0]);
});

app.put("/api/suppliers/:id/products/:productId", async (req, res) => {
  const supplierId = req.params.id;
  const productId = req.params.productId;
  const unitPrice = req.body?.unitPrice ?? null;
  const unit = req.body?.unit ?? null;
  const now = new Date().toISOString();

  const { rows } = await pool.query(
    `
    UPDATE supplier_products
    SET unit_price = $1,
        unit = $2,
        updated_at = $3
    WHERE id = $4 AND supplier_id = $5
    RETURNING id,
              supplier_id AS "supplierId",
              name,
              unit_price AS "unitPrice",
              unit,
              updated_at AS "updatedAt";
  `,
    [unitPrice, unit, now, productId, supplierId]
  );
  if (!rows[0]) return res.status(404).json({ error: "Not found" });
  res.json(rows[0]);
});

app.put("/api/suppliers/:id/products/:productId/name", async (req, res) => {
  const supplierId = req.params.id;
  const productId = req.params.productId;
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Missing name" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: existing } = await client.query(
      "SELECT name FROM supplier_products WHERE id = $1 AND supplier_id = $2",
      [productId, supplierId]
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
      WHERE id = $3 AND supplier_id = $4
      RETURNING id,
                supplier_id AS "supplierId",
                name,
                unit_price AS "unitPrice",
                unit,
                updated_at AS "updatedAt";
    `,
      [name, now, productId, supplierId]
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
                ing || jsonb_build_object('name', $2::text, 'supplierId', $3)
              WHEN ing->>'supplierId' = $3 AND lower(coalesce(ing->>'name','')) = lower($4::text) THEN
                ing || jsonb_build_object('name', $2::text)
              ELSE ing
            END
            ),
            '[]'::jsonb
          )
          FROM jsonb_array_elements(data->'ingredients') ing
        )
      ),
      updated_at = now()
      WHERE data::text LIKE '%' || $1 || '%' OR data::text ILIKE '%' || $4::text || '%';
    `,
      [productId, name, supplierId, oldName]
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
    "DELETE FROM supplier_products WHERE id = $1 AND supplier_id = $2",
    [productId, supplierId]
  );
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`DB server running on http://localhost:${PORT}`);
});
