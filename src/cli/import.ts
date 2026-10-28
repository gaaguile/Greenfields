import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, loadConfig } from "../config.ts";
import { datasetAsOf, importDataset } from "../import/importDataset.ts";
import { openDb } from "../store/db.ts";

const file = process.argv[2] ?? path.join(REPO_ROOT, "data", "chile_greenfield_projects.json");
const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const dataset = JSON.parse(readFileSync(file, "utf8"));
// Figures are dated by the dataset's own as_of, so a fresh import doesn't look like a wave of updates.
const result = importDataset(db, dataset, datasetAsOf(dataset) ?? new Date().toISOString());
console.log(`Imported ${file} into ${cfg.dbPath}`);
console.log(`created ${result.created}, updated ${result.updated}, figures ${result.figures}`);
db.close();
