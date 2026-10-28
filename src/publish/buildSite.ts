import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";
import { REPO_ROOT } from "../config.ts";
import { buildPublicData } from "./buildPublicData.ts";

const SITE_DIR = path.join(REPO_ROOT, "site");

export async function buildSite(
  db: DatabaseSync,
  outDir: string,
  nowIso: string,
  recentChangeDays = 7,
): Promise<{ projectsJsonHash: string }> {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  await build({
    entryPoints: [path.join(SITE_DIR, "src", "main.ts")],
    bundle: true,
    format: "esm",
    target: "es2022",
    minify: true,
    outfile: path.join(outDir, "app.js"),
    logLevel: "silent",
  });
  copyFileSync(path.join(SITE_DIR, "index.html"), path.join(outDir, "index.html"));
  copyFileSync(path.join(SITE_DIR, "styles.css"), path.join(outDir, "styles.css"));

  const data = buildPublicData(db, nowIso, recentChangeDays);
  writeFileSync(path.join(outDir, "projects.json"), JSON.stringify(data));

  // Hash the content without the timestamp, so an unchanged dataset is recognised as unchanged.
  const projectsJsonHash = createHash("sha256").update(JSON.stringify(data.projects)).digest("hex");
  return { projectsJsonHash };
}
