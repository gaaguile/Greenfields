import { readFileSync } from "node:fs";
import path from "node:path";

export interface ProviderConfig {
  kind: "ollama" | "openai";
  baseUrl: string;
  model: string;
  apiKeyEnv?: string;
}

export interface PipelineConfig {
  slots: string[];
  autoPublishConfidence: number;
  numericChangeThreshold: number;
  maxDocChars: number;
  userAgent: string;
  fetch: { concurrency: number; perHostDelayMs: number; attempts: number };
  gamingGuard: { gpuBusyPercent: number; postponeMinutes: number };
  providers: Record<string, ProviderConfig>;
  triageProvider: string;
  triageFallbackProvider: string;
  extractProvider: string;
  digestAfterSlot: string;
}

export interface AppConfig {
  admin: { host: string; port: number };
  dataDir: string;
  dbPath: string;
  logDir: string;
  siteOutDir: string;
  pagesProjectName: string;
  recentChangeDays: number;
  timezone: string;
  pipeline: PipelineConfig;
}

export const REPO_ROOT = path.resolve(import.meta.dirname, "..");

const DEFAULT_DATA_DIR = "D:\\GreenfieldsData";

// Replaces {ENV_NAME} placeholders in provider URLs with values from the environment.
function fillEnv(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/\{([A-Z0-9_]+)\}/g, (_, name: string) => env[name] ?? "");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const file = JSON.parse(readFileSync(path.join(REPO_ROOT, "config", "default.json"), "utf8"));
  const dataDir = env.GREENFIELDS_DATA_DIR || DEFAULT_DATA_DIR;
  const pipeline = file.pipeline as PipelineConfig;
  const providers = Object.fromEntries(
    Object.entries(pipeline.providers).map(([name, p]) => [name, { ...p, baseUrl: fillEnv(p.baseUrl, env) }]),
  ) as Record<string, ProviderConfig>;
  // In Docker, Ollama runs in its own container.
  if (env.OLLAMA_BASE_URL && providers.ollama) providers.ollama = { ...providers.ollama, baseUrl: env.OLLAMA_BASE_URL };
  return {
    admin: {
      host: env.ADMIN_HOST || file.admin.host,
      port: env.ADMIN_PORT ? Number(env.ADMIN_PORT) : file.admin.port,
    },
    dataDir,
    dbPath: path.join(dataDir, "greenfields.db"),
    logDir: path.join(dataDir, "logs"),
    siteOutDir: path.join(REPO_ROOT, "dist", "site"),
    pagesProjectName: file.pagesProjectName,
    recentChangeDays: file.recentChangeDays,
    timezone: file.timezone,
    pipeline: { ...pipeline, providers },
  };
}
