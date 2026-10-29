import { existsSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { REPO_ROOT, loadConfig } from "../config.ts";
import { createLogger } from "../log.ts";
import { makePipelineDeps } from "../pipeline/deps.ts";
import { runPipeline } from "../pipeline/run.ts";
import { openDb } from "../store/db.ts";
import { formatTable } from "./formatTable.ts";

const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean" },
    "no-publish": { type: "boolean" },
    "triage-provider": { type: "string" },
  },
});

const envFile = path.join(REPO_ROOT, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const cfg = loadConfig();
const log = createLogger(cfg.logDir);
const dryRun = !!values["dry-run"];

let dbPath = cfg.dbPath;
if (dryRun) {
  // A dry run works on a copy, so the real database is never changed.
  // The live file is opened read-only, so not even a schema upgrade touches it.
  if (!existsSync(cfg.dbPath)) throw new Error(`no database at ${cfg.dbPath} (run npm run import first)`);
  dbPath = path.join(mkdtempSync(path.join(os.tmpdir(), "greenfields-dry-")), "greenfields.db");
  const live = new DatabaseSync(cfg.dbPath, { readOnly: true });
  live.prepare("VACUUM INTO ?").run(dbPath);
  live.close();
  console.log(`dry run on a copy of the database: ${dbPath}`);
}

const db = openDb(dbPath);
try {
  const deps = makePipelineDeps(cfg, log, {
    triageProvider: values["triage-provider"],
    deploy: !dryRun && !values["no-publish"],
  });
  const summary = await runPipeline(db, cfg, deps, { trigger: "manual", dryRun });
  console.log(formatTable([{ run: summary.runId, ...summary.counts, deployed: summary.deployed }]));
  for (const e of summary.errors) console.error(`error: ${e}`);
  if (summary.errors.length) process.exitCode = 1;
} catch (err) {
  console.error(`Run failed: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  db.close();
}
