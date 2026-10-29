import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { createProvider } from "../ai/provider.ts";
import { REPO_ROOT, loadConfig } from "../config.ts";
import type { Logger } from "../log.ts";
import { scoreFigures, type ScoredFigure } from "../eval/score.ts";
import { extractFigures } from "../pipeline/extract.ts";
import { triageDocument } from "../pipeline/triage.ts";
import { pdfToText } from "../read/pdf.ts";
import { openDb } from "../store/db.ts";
import { getPublished } from "../store/fieldValues.ts";
import { listProjects } from "../store/projects.ts";
import { formatTable } from "./formatTable.ts";

// Scores triage and extraction providers against the hand-checked cases in eval/cases (see eval/README.md).

interface Expected {
  triage: { material: boolean; category: string };
  figures: ScoredFigure[];
}

const { values } = parseArgs({ options: { triage: { type: "string" }, extract: { type: "string" } } });

const envFile = path.join(REPO_ROOT, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const cfg = loadConfig();
const p = cfg.pipeline;

const casesDir = path.join(REPO_ROOT, "eval", "cases");
const cases = readdirSync(casesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
if (!cases.length) {
  console.log("No eval cases yet. See eval/README.md for how to add them.");
  process.exit(0);
}

const provider = (name: string) => createProvider(name, p.providers[name], process.env);
const triage = provider(values.triage ?? p.triageProvider);
const extract = provider(values.extract ?? p.extractProvider);
const quiet: Logger = { info: () => {}, warn: () => {}, error: () => {} };

const db = openDb(cfg.dbPath);
const projects = listProjects(db, { tracking: "active" });
const rows: Record<string, unknown>[] = [];
let triageRight = 0;
let allExpected = 0;
let allActual = 0;
let allMatched = 0;

for (const id of cases) {
  const dir = path.join(casesDir, id);
  const { slug } = JSON.parse(readFileSync(path.join(dir, "project.json"), "utf8")) as { slug: string };
  const expected = JSON.parse(readFileSync(path.join(dir, "expected.json"), "utf8")) as Expected;
  const text = existsSync(path.join(dir, "doc.txt"))
    ? readFileSync(path.join(dir, "doc.txt"), "utf8")
    : await pdfToText(new Uint8Array(readFileSync(path.join(dir, "doc.pdf"))));
  const project = projects.find((x) => x.slug === slug);
  if (!project) {
    rows.push({ case: id, error: `unknown project ${slug}` });
    continue;
  }
  try {
    const t = await triageDocument(triage, { title: null, text }, projects, p.maxDocChars);
    const triageOk = t.material === expected.triage.material && t.category === expected.triage.category;
    if (triageOk) triageRight++;
    const figs = await extractFigures(extract, { title: null, text }, project, getPublished(db, project.id), p.maxDocChars, quiet);
    const s = scoreFigures(expected.figures, figs);
    allExpected += expected.figures.length;
    allActual += figs.length;
    allMatched += s.matched;
    rows.push({ case: id, triage: triageOk ? "ok" : `${t.category}/${t.material}`, precision: s.precision.toFixed(2), recall: s.recall.toFixed(2) });
  } catch (err) {
    rows.push({ case: id, error: (err as Error).message });
  }
}
db.close();

console.log(`triage: ${triage.name}, extract: ${extract.name}`);
console.log(formatTable(rows));
console.log(
  `overall: triage ${triageRight}/${cases.length}, ` +
  `precision ${allActual ? (allMatched / allActual).toFixed(2) : "—"}, recall ${allExpected ? (allMatched / allExpected).toFixed(2) : "—"}`,
);
