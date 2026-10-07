import pg from "pg";

const pool = new pg.Pool({
  host: process.env.PGHOST || "localhost",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
  database: process.env.PGDATABASE || "fiches",
});

try {
  const { rows } = await pool.query(`
    SELECT 'categories' AS name, count(*)::integer AS count FROM categories
    UNION ALL SELECT 'fiches', count(*)::integer FROM fiches
    UNION ALL SELECT 'supplier_products', count(*)::integer FROM supplier_products
    UNION ALL SELECT 'suppliers', count(*)::integer FROM suppliers
    ORDER BY name
  `);
  console.log(JSON.stringify(rows));
} finally {
  await pool.end();
}
