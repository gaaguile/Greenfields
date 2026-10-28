import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { applySchema } from "./schema.ts";

export function openDb(dbPath: string): DatabaseSync {
  if (dbPath !== ":memory:") mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  if (dbPath !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  applySchema(db);
  return db;
}
