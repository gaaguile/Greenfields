import { loadConfig } from "../config.ts";
import { openDb } from "../store/db.ts";
import { formatTable } from "./formatTable.ts";

const [table, limitArg] = process.argv.slice(2);
const db = openDb(loadConfig().dbPath);
const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[])
  .map((r) => r.name);

if (!table || !tables.includes(table)) {
  console.log(`Usage: npm run db:show -- <table> [limit]\nTables: ${tables.join(", ")}`);
  process.exit(table ? 1 : 0);
}
const limit = Number(limitArg) > 0 ? Number(limitArg) : 50;
// The table name is checked against sqlite_master above, so interpolating it is safe.
const rows = db.prepare(`SELECT * FROM "${table}" LIMIT ?`).all(limit) as Record<string, unknown>[];
console.log(formatTable(rows));
db.close();
