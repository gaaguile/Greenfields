import { readFileSync } from "node:fs";
import path from "node:path";

export interface AppConfig {
  dataDir: string;
  dbPath: string;
  siteOutDir: string;
  pagesProjectName: string;
  recentChangeDays: number;
  timezone: string;
}

export const REPO_ROOT = path.resolve(import.meta.dirname, "..");

const DEFAULT_DATA_DIR = "C:\\GreenfieldsData";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const file = JSON.parse(readFileSync(path.join(REPO_ROOT, "config", "default.json"), "utf8"));
  const dataDir = env.GREENFIELDS_DATA_DIR || DEFAULT_DATA_DIR;
  return {
    dataDir,
    dbPath: path.join(dataDir, "greenfields.db"),
    siteOutDir: path.join(REPO_ROOT, "dist", "site"),
    pagesProjectName: file.pagesProjectName,
    recentChangeDays: file.recentChangeDays,
    timezone: file.timezone,
  };
}
