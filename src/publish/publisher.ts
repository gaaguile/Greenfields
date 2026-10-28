import { spawn } from "node:child_process";
import type { DatabaseSync } from "node:sqlite";
import type { AppConfig } from "../config.ts";
import { buildSite } from "./buildSite.ts";

export type Deployer = (dir: string, projectName: string) => Promise<void>;

const HASH_KEY = "last_published_hash";

export const wranglerDeployer: Deployer = (dir, projectName) =>
  new Promise((resolve, reject) => {
    for (const name of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]) {
      if (!process.env[name]) return reject(new Error(`${name} is not set (see .env.example)`));
    }
    const args = ["wrangler", "pages", "deploy", dir, "--project-name", projectName, "--branch", "main", "--commit-dirty=true"];
    // npx is a .cmd shim on Windows, which needs a shell to run.
    const child = spawn("npx", args, { shell: process.platform === "win32", env: process.env });
    let stderr = "";
    child.stdout.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
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
