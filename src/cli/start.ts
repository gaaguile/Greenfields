import { existsSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, loadConfig } from "../config.ts";
import { createLogger } from "../log.ts";
import { makePipelineDeps } from "../pipeline/deps.ts";
import { runPipeline } from "../pipeline/run.ts";
import { startDaemon } from "../schedule/daemon.ts";
import { openDb } from "../store/db.ts";

// The long-running process: Windows Task Scheduler starts it at boot and restarts it if it stops.
const envFile = path.join(REPO_ROOT, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const cfg = loadConfig();
const log = createLogger(cfg.logDir);
const db = openDb(cfg.dbPath);

const daemon = startDaemon({
  db,
  cfg,
  // Dependencies are built per run, so the GPU guard's deadline is the slot after this run.
  run: async (trigger) => {
    const summary = await runPipeline(db, cfg, makePipelineDeps(cfg, log), { trigger });
    for (const e of summary.errors) log.error("run error", { error: e });
  },
  now: () => new Date(),
  setTimer: (ms, fn) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  },
  log,
});
log.info("ready", { db: cfg.dbPath });

const shutdown = () => {
  log.info("stopping");
  daemon.stop();
  db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
