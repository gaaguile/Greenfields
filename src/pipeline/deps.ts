import { createProvider } from "../ai/provider.ts";
import type { AppConfig } from "../config.ts";
import type { Logger } from "../log.ts";
import { wranglerDeployer } from "../publish/publisher.ts";
import { renderPage } from "../read/render.ts";
import { nvidiaSmiProbe } from "../schedule/gamingGuard.ts";
import { nextSlot } from "../schedule/slots.ts";
import { createFetcher } from "../watch/fetcher.ts";
import type { PipelineDeps } from "./run.ts";

// Builds the real network, model and deploy dependencies from config and the environment.
export function makePipelineDeps(
  cfg: AppConfig,
  log: Logger,
  opts: { env?: NodeJS.ProcessEnv; triageProvider?: string; deploy?: boolean } = {},
): PipelineDeps {
  const env = opts.env ?? process.env;
  const p = cfg.pipeline;
  const provider = (name: string) => {
    const pc = p.providers[name];
    if (!pc) throw new Error(`unknown provider "${name}" (config/default.json pipeline.providers)`);
    return createProvider(name, pc, env);
  };
  const triageName = opts.triageProvider ?? p.triageProvider;
  const now = () => new Date();
  // Only a local (Ollama) triage model competes with games for the GPU.
  const gamingGuard = p.providers[triageName]?.kind === "ollama"
    ? {
      probe: nvidiaSmiProbe,
      sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
      deadline: nextSlot(now(), p.slots, cfg.timezone).at,
      fallback: provider(p.triageFallbackProvider),
    }
    : undefined;
  return {
    fetcher: createFetcher({ userAgent: p.userAgent, ...p.fetch }),
    providers: { triage: provider(triageName), extract: provider(p.extractProvider) },
    gamingGuard,
    deploy: opts.deploy === false ? null : wranglerDeployer,
    render: (url) => renderPage(url, p.userAgent),
    log,
    now,
  };
}
