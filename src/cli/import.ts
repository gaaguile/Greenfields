import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, loadConfig } from "../config.ts";
import { importDataset } from "../import/importDataset.ts";
import { openDb } from "../store/db.ts";

const file = process.argv[2] ?? path.join(REPO_ROOT, "data", "chile_greenfield_projects.json");
const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const result = importDataset(db, JSON.parse(readFileSync(file, "utf8")), new Date().toISOString());
console.log(`Imported ${file} into ${cfg.dbPath}`);
console.log(`created ${result.created}, updated ${result.updated}, figures ${result.figures}`);
db.close();
