import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  siteDir = SITE_DIR,
): Promise<{ projectsJsonHash: string }> {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  await build({
    entryPoints: [path.join(siteDir, "src", "main.ts")],
    bundle: true,
    format: "esm",
    target: "es2022",
    minify: true,
    outfile: path.join(outDir, "app.js"),
    logLevel: "silent",
  });
  copyFileSync(path.join(siteDir, "styles.css"), path.join(outDir, "styles.css"));
  // Cloudflare tells browsers to keep scripts and styles for hours; a version tag from their content makes a
  // new release load at once (the page itself is never cached).
  const version = (file: string) =>
    createHash("sha256").update(readFileSync(path.join(outDir, file))).digest("hex").slice(0, 12);
  const page = readFileSync(path.join(siteDir, "index.html"), "utf8")
    .replace('src="app.js"', `src="app.js?v=${version("app.js")}"`)
    .replace('href="styles.css"', `href="styles.css?v=${version("styles.css")}"`);
  writeFileSync(path.join(outDir, "index.html"), page);

  const data = buildPublicData(db, nowIso, recentChangeDays);
  writeFileSync(path.join(outDir, "projects.json"), JSON.stringify(data));

  // Hash the data without its timestamp plus the page files, so either a data change or a
  // code/style change triggers a deploy, while an unchanged site is recognised as unchanged.
  const hash = createHash("sha256").update(JSON.stringify(data.projects));
  for (const file of ["app.js", "index.html", "styles.css"]) hash.update(readFileSync(path.join(outDir, file)));
  return { projectsJsonHash: hash.digest("hex") };
}
