import { existsSync } from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { createRemoteJWKSet, type JWTVerifyGetKey } from "jose";
import { accessCertsUrl, accessSettings } from "../admin/access.ts";
import { makeAdminActions } from "../admin/actions.ts";
import { createAdminApp } from "../admin/app.ts";
import { REPO_ROOT, loadConfig } from "../config.ts";
import { createLogger } from "../log.ts";
import { maybeSendDigest } from "../notify/digest.ts";
import { gmailMailer } from "../notify/mailer.ts";
import { makePipelineDeps } from "../pipeline/deps.ts";
import { runPipeline } from "../pipeline/run.ts";
import { wranglerDeployer } from "../publish/publisher.ts";
import { startDaemon } from "../schedule/daemon.ts";
import { openDb } from "../store/db.ts";

// The long-running process: Windows Task Scheduler starts it at boot and restarts it if it stops.
const envFile = path.join(REPO_ROOT, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const cfg = loadConfig();
const log = createLogger(cfg.logDir);

// Under Task Scheduler nobody sees the console, so anything unexpected goes to the log before exiting;
// the task then restarts the app.
const fatal = (kind: string) => (err: unknown) => {
  log.error(kind, { error: err instanceof Error ? err.stack ?? err.message : String(err) });
  process.exit(1);
};
process.on("uncaughtException", fatal("uncaught exception"));
process.on("unhandledRejection", fatal("unhandled rejection"));

const db = openDb(cfg.dbPath);

const daemon = startDaemon({
  db,
  cfg,
  // Dependencies are built per run, so the GPU guard's deadline is the slot after this run.
  run: async (trigger, slot) => {
    const summary = await runPipeline(db, cfg, makePipelineDeps(cfg, log), { trigger });
    for (const e of summary.errors) log.error("run error", { error: e });
    // The daily digest goes out after the 10:00 run (or its catch-up).
    if (slot === cfg.pipeline.digestAfterSlot) {
      try {
        const to = process.env.DIGEST_TO || process.env.GMAIL_USER || "";
        const result = await maybeSendDigest(db, gmailMailer(), new Date().toISOString(), cfg.timezone, to);
        log.info("digest", { result });
      } catch (err) {
        log.error("digest failed", { error: (err as Error).message });
      }
    }
  },
  now: () => new Date(),
  setTimer: (ms, fn) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  },
  log,
  maxRunMs: 4 * 3600_000,
  onHang: () => process.exit(1),
});
log.info("ready", { db: cfg.dbPath });

// The review page, reached through Cloudflare Tunnel; it only listens on this machine.
const access = accessSettings(process.env);
if (access === null) log.warn("review page: Access is not configured (CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD, ADMIN_EMAIL); it will refuse all requests");
if (access && "dev" in access) log.warn("review page: GREENFIELDS_ADMIN_DEV=1, so the Access check is OFF; use only for local testing");
const jwks: JWTVerifyGetKey = access && "teamDomain" in access
  ? createRemoteJWKSet(accessCertsUrl(access.teamDomain))
  : async () => { throw new Error("Access is not configured"); };
const admin = createAdminApp({
  db, cfg, access, jwks, now: () => new Date(),
  actions: makeAdminActions({ daemon, db, cfg, deploy: wranglerDeployer }),
});
const server = serve({ fetch: admin.fetch, hostname: cfg.admin.host, port: cfg.admin.port }, (info) =>
  log.info("admin page listening", { host: cfg.admin.host, port: info.port }));

const shutdown = () => {
  log.info("stopping");
  server.close();
  daemon.stop();
  db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
