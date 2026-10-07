import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import pg from "pg";

const testDatabaseUrl = process.env.TEST_DATABASE_URL || "";
const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);

async function request(baseUrl, path, { method = "GET", token = "", body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  return { response, payload };
}

test(
  "CRUD routes isolate fiches, suppliers, products and categories by tenant",
  { skip: !testDatabaseUrl, timeout: 30_000 },
  async (t) => {
    const adminUrl = new URL(testDatabaseUrl);
    assert.ok(
      localHosts.has(adminUrl.hostname),
      "Integration tests only accept a local TEST_DATABASE_URL."
    );

    const databaseName = `fiches_test_${crypto.randomBytes(6).toString("hex")}`;
    const { Pool } = pg;
    const admin = new Pool({ connectionString: adminUrl.toString() });
    await admin.query(`CREATE DATABASE "${databaseName}"`);

    let appPool;
    let server;
    t.after(async () => {
      if (server) await new Promise((resolve) => server.close(resolve));
      if (appPool) await appPool.end();
      await admin.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
        [databaseName]
      );
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.end();
    });

    process.env.SERVER_IMPORT_ONLY = "true";
    process.env.AUTH_DISABLED = "false";
    process.env.LEGACY_LOGIN_ENABLED = "true";
    process.env.APP_PASSWORD = "local-integration-password";
    process.env.AUTH_TOKEN_SECRET = "local-integration-signing-secret";
    process.env.FICHES_SERVICE_TOKEN = "local-integration-service-token";
    process.env.REGISTRATION_ENABLED = "true";
    process.env.REGISTRATION_INVITE_CODE = "local-integration-invite";
    process.env.DEFAULT_TENANT_ID = "00000000-0000-4000-8000-000000000001";
    process.env.DEFAULT_TENANT_SLUG = "tenant-a";
    process.env.DEFAULT_TENANT_NAME = "Tenant A";
    process.env.PGHOST = adminUrl.hostname;
    process.env.PGPORT = adminUrl.port || "5432";
    process.env.PGUSER = decodeURIComponent(adminUrl.username);
    process.env.PGPASSWORD = decodeURIComponent(adminUrl.password);
    process.env.PGDATABASE = databaseName;

    const serverModule = await import(`./index.js?integration=${Date.now()}`);
    appPool = serverModule.pool;
    server = await serverModule.startServer(0);
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const tenantALogin = await request(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { password: "local-integration-password" },
    });
    assert.equal(tenantALogin.response.status, 200);
    const tokenA = tenantALogin.payload.token;

    const tenantBRegistration = await request(baseUrl, "/api/auth/register", {
      method: "POST",
      body: {
        inviteCode: "local-integration-invite",
        email: "owner-b@example.test",
        password: "tenant-b-password-123",
        displayName: "Owner B",
        organizationName: "Tenant B",
      },
    });
    assert.equal(tenantBRegistration.response.status, 201);
    const tokenB = tenantBRegistration.payload.token;
    const tenantBId = tenantBRegistration.payload.tenant.id;

    const sharedFicheId = crypto.randomUUID();
    const ficheA = {
      id: sharedFicheId,
      title: "Tenant A fiche",
      portions: 4,
      ingredients: [],
      steps: [],
      allergens: [],
      equipment: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    assert.equal(
      (await request(baseUrl, "/api/fiches", { method: "POST", token: tokenA, body: ficheA })).response
        .status,
      200
    );
    assert.equal(
      (await request(baseUrl, `/api/fiches/${sharedFicheId}`, { token: tokenB })).response.status,
      404
    );
    assert.equal(
      (
        await request(baseUrl, "/api/fiches", {
          method: "POST",
          token: tokenB,
          body: { ...ficheA, title: "Tenant B overwrite attempt" },
        })
      ).response.status,
      409
    );
    await request(baseUrl, `/api/fiches/${sharedFicheId}`, { method: "DELETE", token: tokenB });
    assert.equal(
      (await request(baseUrl, `/api/fiches/${sharedFicheId}`, { token: tokenA })).payload.title,
      "Tenant A fiche"
    );

    const supplierAResult = await request(baseUrl, "/api/suppliers", {
      method: "POST",
      token: tokenA,
      body: { name: "Supplier A" },
    });
    assert.equal(supplierAResult.response.status, 200);
    const supplierA = supplierAResult.payload;
    assert.equal(
      (await request(baseUrl, "/api/suppliers", { token: tokenB })).payload.some(
        (supplier) => supplier.id === supplierA.id
      ),
      false
    );
    assert.equal(
      (
        await request(baseUrl, `/api/suppliers/${supplierA.id}`, {
          method: "PUT",
          token: tokenB,
          body: { name: "Cross-tenant rename" },
        })
      ).response.status,
      404
    );
    assert.equal(
      (
        await request(baseUrl, `/api/suppliers/${supplierA.id}/products`, {
          method: "POST",
          token: tokenB,
          body: { name: "Cross-tenant product" },
        })
      ).response.status,
      404
    );

    const productAResult = await request(baseUrl, `/api/suppliers/${supplierA.id}/products`, {
      method: "POST",
      token: tokenA,
      body: { name: "Product A", supplierCode: "A-001", unitPrice: 2.5, unit: "kg" },
    });
    assert.equal(productAResult.response.status, 200);
    const productA = productAResult.payload;
    assert.equal(
      (
        await request(baseUrl, `/api/suppliers/${supplierA.id}/products/${productA.id}`, {
          method: "PUT",
          token: tokenB,
          body: { supplierCode: "HACKED", unitPrice: 99, unit: "kg" },
        })
      ).response.status,
      404
    );
    await request(baseUrl, `/api/suppliers/${supplierA.id}/products/${productA.id}`, {
      method: "DELETE",
      token: tokenB,
    });
    const productsA = await request(baseUrl, `/api/suppliers/${supplierA.id}/products`, { token: tokenA });
    assert.equal(productsA.payload.length, 1);
    assert.equal(productsA.payload[0].supplierCode, "A-001");

    const linkedFicheId = crypto.randomUUID();
    const mentionOnlyFicheId = crypto.randomUUID();
    const oldTimestamp = "2025-01-01T00:00:00.000Z";
    const ficheBase = {
      portions: 4,
      steps: [],
      allergens: [],
      equipment: [],
      createdAt: oldTimestamp,
      updatedAt: oldTimestamp,
    };
    await request(baseUrl, "/api/fiches", {
      method: "POST",
      token: tokenA,
      body: {
        ...ficheBase,
        id: linkedFicheId,
        title: "Linked fiche",
        ingredients: [
          {
            name: "Product A",
            qty: "1 kg",
            supplier: "Supplier A",
            supplierId: supplierA.id,
            supplierProductId: productA.id,
          },
        ],
      },
    });
    await request(baseUrl, "/api/fiches", {
      method: "POST",
      token: tokenA,
      body: {
        ...ficheBase,
        id: mentionOnlyFicheId,
        title: "Mention only fiche",
        ingredients: [],
        notes: `Supplier A ${supplierA.id} Product A ${productA.id}`,
      },
    });

    assert.equal(
      (
        await request(baseUrl, `/api/suppliers/${supplierA.id}/products/${productA.id}/name`, {
          method: "PUT",
          token: tokenA,
          body: { name: "Product A renamed" },
        })
      ).response.status,
      200
    );
    assert.equal(
      (
        await request(baseUrl, `/api/suppliers/${supplierA.id}`, {
          method: "PUT",
          token: tokenA,
          body: { name: "Supplier A renamed" },
        })
      ).response.status,
      200
    );

    const linkedFiche = await request(baseUrl, `/api/fiches/${linkedFicheId}`, { token: tokenA });
    assert.equal(linkedFiche.payload.ingredients[0].name, "Product A renamed");
    assert.equal(linkedFiche.payload.ingredients[0].supplier, "Supplier A renamed");
    const { rows: ficheTimestamps } = await appPool.query(
      `SELECT id, updated_at AS "updatedAt" FROM fiches
       WHERE tenant_id = $1 AND id = ANY($2::text[])`,
      [process.env.DEFAULT_TENANT_ID, [linkedFicheId, mentionOnlyFicheId]]
    );
    const updatedById = Object.fromEntries(
      ficheTimestamps.map((row) => [row.id, new Date(row.updatedAt).toISOString()])
    );
    assert.notEqual(updatedById[linkedFicheId], oldTimestamp);
    assert.equal(updatedById[mentionOnlyFicheId], oldTimestamp);

    await appPool.query(
      `INSERT INTO categories (tenant_id, id, display_name, point_vente, sort_order)
       VALUES ($1, 'tenant_a_only', 'Tenant A only', 'commun', 100),
              ($2, 'tenant_b_only', 'Tenant B only', 'commun', 100)`,
      [process.env.DEFAULT_TENANT_ID, tenantBId]
    );
    const categoriesA = (await request(baseUrl, "/api/categories", { token: tokenA })).payload;
    const categoriesB = (await request(baseUrl, "/api/categories", { token: tokenB })).payload;
    assert.equal(categoriesA.some((category) => category.id === "tenant_a_only"), true);
    assert.equal(categoriesA.some((category) => category.id === "tenant_b_only"), false);
    assert.equal(categoriesB.some((category) => category.id === "tenant_b_only"), true);
    assert.equal(categoriesB.some((category) => category.id === "tenant_a_only"), false);
  }
);
