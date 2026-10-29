import type { ProviderConfig } from "../config.ts";

export interface ChatJsonRequest {
  system: string;
  user: string;
  schemaHint: string;
}

export interface ModelProvider {
  name: string;
  // Returns the model's raw reply, which should be JSON.
  chatJson(req: ChatJsonRequest): Promise<string>;
}

// The provider's free or paid allowance is used up; the work should wait for the next run.
export class QuotaExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaExceededError";
  }
}

const TIMEOUT_MS = 120_000;
const CF_QUOTA_CODE = 4006;

const systemPrompt = (req: ChatJsonRequest) =>
  `${req.system}\n\nReply with a single JSON object only, matching this shape:\n${req.schemaHint}`;

async function post(name: string, fetchImpl: typeof fetch, url: string, headers: Record<string, string>, body: object) {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (res.ok) return JSON.parse(text);
  if (res.status === 429) throw new QuotaExceededError(`${name}: HTTP 429: ${text.slice(0, 300)}`);
  try {
    const errors = (JSON.parse(text) as { errors?: { code?: number }[] }).errors;
    if (errors?.some((e) => e.code === CF_QUOTA_CODE)) throw new QuotaExceededError(`${name}: ${text.slice(0, 300)}`);
  } catch (err) {
    if (err instanceof QuotaExceededError) throw err;
  }
  throw new Error(`${name}: HTTP ${res.status}: ${text.slice(0, 300)}`);
}

export function createProvider(
  name: string,
  cfg: ProviderConfig,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): ModelProvider {
  if (cfg.kind === "ollama") {
    return {
      name,
      async chatJson(req) {
        const data = await post(name, fetchImpl, `${cfg.baseUrl}/api/chat`, {}, {
          model: cfg.model,
          messages: [{ role: "system", content: systemPrompt(req) }, { role: "user", content: req.user }],
          stream: false,
          format: "json",
          // Frees video memory soon after triage, so the GPU is back for games quickly.
          keep_alive: "30s",
          options: { temperature: 0 },
        });
        return (data as { message: { content: string } }).message.content;
      },
    };
  }
  const key = cfg.apiKeyEnv ? env[cfg.apiKeyEnv] : undefined;
  if (cfg.apiKeyEnv && !key) throw new Error(`${cfg.apiKeyEnv} is not set (see .env.example)`);
  return {
    name,
    async chatJson(req) {
      const data = await post(name, fetchImpl, `${cfg.baseUrl}/chat/completions`, key ? { authorization: `Bearer ${key}` } : {}, {
        model: cfg.model,
        messages: [{ role: "system", content: systemPrompt(req) }, { role: "user", content: req.user }],
        temperature: 0,
        response_format: { type: "json_object" },
      });
      return (data as { choices: { message: { content: string } }[] }).choices[0].message.content;
    },
  };
}
