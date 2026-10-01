import { readFileSync } from "node:fs";
import pg from "pg";

const sqlPath = process.argv[2];
if (!sqlPath) {
  console.error("Usage: run-sql <path-to-file.sql>");
  process.exit(1);
}

const sql = readFileSync(sqlPath, "utf-8");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

await client.connect();
try {
  const result = await client.query(sql);
  const rows = Array.isArray(result) ? result.at(-1)!.rows : result.rows;
  if (rows.length) {
    console.table(rows);
  } else {
    console.log(`OK — ${(Array.isArray(result) ? result.at(-1)! : result).command}, ${(Array.isArray(result) ? result.at(-1)! : result).rowCount} row(s)`);
  }
} finally {
  await client.end();
}
