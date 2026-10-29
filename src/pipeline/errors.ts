import type { ModelProvider } from "../ai/provider.ts";
import type { Logger } from "../log.ts";

// Outages, timeouts, rate limits and server errors pass; the work is retried in a later run.
const TRANSIENT =
  /fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|socket hang up|timeout|timed out|aborted|HTTP (408|429|5\d\d)\b/i;

export function isTransient(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "QuotaExceededError" || err.name === "InvalidModelOutputError") return false;
  const cause = (err as { cause?: unknown }).cause;
  return TRANSIENT.test(err.message) || TRANSIENT.test(err.name) || (cause instanceof Error && TRANSIENT.test(cause.message));
}

// Uses `fallback` when `primary` cannot be reached (for example Ollama not running after a reboot).
export function withFallback(primary: ModelProvider, fallback: ModelProvider, log: Logger): ModelProvider {
  return {
    name: primary.name,
    async chatJson(req) {
      try {
        return await primary.chatJson(req);
      } catch (err) {
        if (!isTransient(err)) throw err;
        log.warn(`${primary.name} unavailable; using ${fallback.name}`, { error: (err as Error).message });
        return fallback.chatJson(req);
      }
    },
  };
}
