import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { AppConfig } from "../config.ts";
import { buildSite } from "./buildSite.ts";

export type Deployer = (dir: string, projectName: string) => Promise<void>;

const HASH_KEY = "last_published_hash";
const DEPLOY_TIMEOUT_MS = 10 * 60_000;

// Runs wrangler's JS entry point with node directly: no shell, so paths with spaces stay one argument.
export function wranglerCommand(dir: string, projectName: string): { command: string; args: string[] } {
  const pkgJson = createRequire(import.meta.url).resolve("wrangler/package.json");
  const bin = path.join(path.dirname(pkgJson), "bin", "wrangler.js");
  return {
    command: process.execPath,
    args: [bin, "pages", "deploy", dir, "--project-name", projectName, "--branch", "main", "--commit-dirty=true"],
  };
}

export const wranglerDeployer: Deployer = (dir, projectName) =>
  new Promise((resolve, reject) => {
    for (const name of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]) {
      if (!process.env[name]) return reject(new Error(`${name} is not set (see .env.example)`));
    }
    const { command, args } = wranglerCommand(dir, projectName);
    // Killed after 10 minutes, so a stuck upload cannot hold up later runs; no stdin, so it never waits for input.
    const child = spawn(command, args, { env: process.env, stdio: ["ignore", "pipe", "pipe"], timeout: DEPLOY_TIMEOUT_MS });
    let stderr = "";
    child.stdout.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) resolve();
      else if (signal) reject(new Error(`wrangler timed out after ${DEPLOY_TIMEOUT_MS / 60_000} minutes`));
      else reject(new Error(`wrangler exited with code ${code}: ${stderr.trim().split("\n").slice(-10).join("\n")}`));
    });
  });

export async function publish(
  db: DatabaseSync,
  cfg: AppConfig,
  deploy: Deployer,
  opts: { force?: boolean; nowIso: string },
): Promise<{ deployed: boolean; hash: string }> {
  const { projectsJsonHash: hash } = await buildSite(db, cfg.siteOutDir, opts.nowIso, cfg.recentChangeDays);
  const last = (db.prepare("SELECT value FROM meta WHERE key = ?").get(HASH_KEY) as { value: string } | undefined)?.value;
  if (last === hash && !opts.force) return { deployed: false, hash };
  await deploy(cfg.siteOutDir, cfg.pagesProjectName);
  // Recorded only after a successful deploy, so a failed one is retried next time.
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    HASH_KEY, hash,
  );
  return { deployed: true, hash };
}
