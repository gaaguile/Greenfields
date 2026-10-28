import { isAllowed } from "./robots.ts";

export type FetchResult =
  | { ok: true; url: string; status: number; contentType: string; body: Uint8Array }
  | { ok: false; url: string; error: string; blockedByRobots?: boolean };

export interface Fetcher {
  get(url: string): Promise<FetchResult>;
}

export interface FetcherOptions {
  userAgent: string;
  concurrency: number;
  perHostDelayMs: number;
  attempts: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const TIMEOUT_MS = 30_000;
const BACKOFF_BASE_MS = 1000;

const retryable = (status: number) => status === 408 || status === 429 || status >= 500;

export function createFetcher(opts: FetcherOptions): Fetcher {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const nextAt = new Map<string, number>();
  const robots = new Map<string, Promise<string>>();

  // Simple semaphore for requests in flight.
  let active = 0;
  const waiting: (() => void)[] = [];
  const acquire = async () => {
    if (active < opts.concurrency) { active++; return; }
    await new Promise<void>((r) => waiting.push(r));
  };
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };

  // Reserves the host's next slot, then waits for it.
  const politeWait = async (host: string) => {
    const t = Math.max(now(), nextAt.get(host) ?? 0);
    nextAt.set(host, t + opts.perHostDelayMs);
    const wait = t - now();
    if (wait > 0) await sleep(wait);
  };

  const request = async (url: string): Promise<Response> => {
    await politeWait(new URL(url).host);
    await acquire();
    try {
      return await fetchImpl(url, {
        headers: { "user-agent": opts.userAgent },
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } finally {
      release();
    }
  };

  const robotsFor = (origin: string): Promise<string> => {
    let p = robots.get(origin);
    if (!p) {
      // A missing or unreadable robots.txt means everything is allowed.
      p = request(`${origin}/robots.txt`)
        .then((r) => (r.ok ? r.text() : ""))
        .catch(() => "");
      robots.set(origin, p);
    }
    return p;
  };

  return {
    async get(url) {
      const origin = new URL(url).origin;
      if (!isAllowed(await robotsFor(origin), opts.userAgent, url)) {
        return { ok: false, url, error: "blocked by robots.txt", blockedByRobots: true };
      }
      let lastError = "";
      for (let attempt = 1; attempt <= opts.attempts; attempt++) {
        if (attempt > 1) await sleep(BACKOFF_BASE_MS * 4 ** (attempt - 2));
        try {
          const res = await request(url);
          if (res.ok) {
            return {
              ok: true,
              url: res.url || url,
              status: res.status,
              contentType: res.headers.get("content-type") ?? "",
              body: new Uint8Array(await res.arrayBuffer()),
            };
          }
          lastError = `HTTP ${res.status}`;
          if (!retryable(res.status)) break;
        } catch (err) {
          lastError = (err as Error).message;
        }
      }
      return { ok: false, url, error: lastError };
    },
  };
}
