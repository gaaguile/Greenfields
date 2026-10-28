import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFetcher } from "../../src/watch/fetcher.ts";

const UA = "GreenfieldsBot/0.2 (+https://greenfields.gabrieltekken.com)";

type Handler = (url: string) => { status: number; body?: string; contentType?: string } | Promise<never>;

// Runs under vitest's fake timers; fetch itself takes no time.
function harness(handler: Handler, opts: Partial<{ concurrency: number; perHostDelayMs: number }> = {}) {
  const sleeps: number[] = [];
  const requests: { url: string; at: number; ua: string | null }[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, at: Date.now(), ua: new Headers(init?.headers).get("user-agent") });
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await Promise.resolve();
      const r = await handler(url);
      return new Response(r.body ?? "", { status: r.status, headers: { "content-type": r.contentType ?? "text/html" } });
    } finally {
      inFlight--;
    }
  }) as typeof fetch;
  const fetcher = createFetcher({
    userAgent: UA,
    concurrency: opts.concurrency ?? 2,
    perHostDelayMs: opts.perHostDelayMs ?? 2000,
    attempts: 3,
    fetchImpl,
    sleep: (ms) => {
      sleeps.push(ms);
      return new Promise((r) => setTimeout(r, ms));
    },
    now: () => Date.now(),
  });
  // Starts the calls, then runs every pending timer until they settle.
  const settle = async <T>(p: Promise<T>): Promise<T> => {
    await vi.runAllTimersAsync();
    return p;
  };
  return {
    get: (url: string) => settle(fetcher.get(url)),
    all: (urls: string[]) => settle(Promise.all(urls.map((u) => fetcher.get(u)))),
    requests,
    sleeps,
    maxInFlight: () => maxInFlight,
  };
}

const robots404 = (url: string) => (url.endsWith("/robots.txt") ? { status: 404 } : null);

describe("createFetcher", () => {
  beforeEach(() => { vi.useFakeTimers({ now: 0 }); });
  afterEach(() => { vi.useRealTimers(); });

  it("fetches robots.txt once per host and treats a 404 as allow-all", async () => {
    const h = harness((url) => robots404(url) ?? { status: 200, body: "ok" });
    expect((await h.get("https://a.com/1")).ok).toBe(true);
    expect((await h.get("https://a.com/2")).ok).toBe(true);
    expect(h.requests.filter((r) => r.url.endsWith("robots.txt"))).toHaveLength(1);
  });

  it("does not fetch a URL that robots.txt disallows", async () => {
    const h = harness((url) =>
      url.endsWith("/robots.txt") ? { status: 200, body: "User-agent: *\nDisallow: /private/" } : { status: 200 },
    );
    const r = await h.get("https://a.com/private/x");
    expect(r).toMatchObject({ ok: false, blockedByRobots: true });
    expect(h.requests.map((q) => q.url)).toEqual(["https://a.com/robots.txt"]);
  });

  it("spaces requests to the same host by perHostDelayMs", async () => {
    const h = harness((url) => robots404(url) ?? { status: 200 });
    await h.all(["https://a.com/1", "https://a.com/2", "https://a.com/3"]);
    const times = h.requests.filter((r) => !r.url.endsWith("robots.txt")).map((r) => r.at).sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(2000);
  });

  it("keeps at most `concurrency` requests in flight", async () => {
    const h = harness((url) => robots404(url) ?? { status: 200 }, { concurrency: 2, perHostDelayMs: 0 });
    await h.all(["a", "b", "c", "d", "e"].map((x) => `https://${x}.com/1`));
    expect(h.maxInFlight()).toBeLessThanOrEqual(2);
  });

  it("retries a 503 with backoff and then succeeds", async () => {
    let calls = 0;
    const h = harness((url) => robots404(url) ?? (++calls === 1 ? { status: 503 } : { status: 200, body: "fine" }));
    const r = await h.get("https://a.com/x");
    expect(r.ok).toBe(true);
    expect(calls).toBe(2);
    expect(h.sleeps).toContain(1000);
  });

  it("gives up after 3 attempts without throwing, backing off 1 s then 4 s", async () => {
    let calls = 0;
    const h = harness((url) => robots404(url) ?? (calls++, { status: 500 }));
    const r = await h.get("https://a.com/x");
    expect(r).toMatchObject({ ok: false });
    expect(calls).toBe(3);
    expect(h.sleeps).toEqual(expect.arrayContaining([1000, 4000]));
  });

  it("does not retry a 404", async () => {
    let calls = 0;
    const h = harness((url) => robots404(url) ?? (calls++, { status: 404 }));
    const r = await h.get("https://a.com/x");
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toContain("404");
    expect(calls).toBe(1);
  });

  it("returns an error result when the network fails", async () => {
    const h = harness((url) => robots404(url) ?? Promise.reject(new Error("ECONNRESET")));
    const r = await h.get("https://a.com/x");
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toContain("ECONNRESET");
  });

  it("sends the configured User-Agent and returns the body bytes", async () => {
    const h = harness((url) => robots404(url) ?? { status: 200, body: "héllo", contentType: "text/html; charset=utf-8" });
    const r = await h.get("https://a.com/x");
    expect(h.requests.every((q) => q.ua === UA)).toBe(true);
    expect(r.ok && new TextDecoder().decode(r.body)).toBe("héllo");
    expect(r.ok && r.contentType).toContain("text/html");
  });
});
