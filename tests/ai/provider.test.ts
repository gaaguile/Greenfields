import { describe, expect, it } from "vitest";
import { QuotaExceededError, createProvider } from "../../src/ai/provider.ts";

interface Call { url: string; headers: Headers; body: Record<string, unknown> }

function fakeFetch(respond: (call: Call) => { status: number; json: unknown }) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) };
    calls.push(call);
    const r = respond(call);
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { impl, calls };
}

const req = { system: "sys", user: "doc text", schemaHint: '{"a": number}' };

describe("ollama provider", () => {
  it("calls /api/chat with JSON format and a short keep_alive", async () => {
    const f = fakeFetch(() => ({ status: 200, json: { message: { content: '{"a":1}' } } }));
    const p = createProvider("ollama", { kind: "ollama", baseUrl: "http://127.0.0.1:11434", model: "llama3.1:8b" }, {}, f.impl);
    expect(await p.chatJson(req)).toBe('{"a":1}');
    expect(f.calls[0].url).toBe("http://127.0.0.1:11434/api/chat");
    expect(f.calls[0].body).toMatchObject({
      model: "llama3.1:8b", stream: false, format: "json", keep_alive: "30s", options: { temperature: 0 },
    });
    const messages = f.calls[0].body.messages as { role: string; content: string }[];
    expect(messages[0]).toMatchObject({ role: "system" });
    expect(messages[0].content).toContain("sys");
    expect(messages[0].content).toContain('{"a": number}');
    expect(messages[1]).toEqual({ role: "user", content: "doc text" });
  });
});

describe("openai-compatible provider", () => {
  const cfg = { kind: "openai" as const, baseUrl: "https://api.example.com/v1", model: "m", apiKeyEnv: "ANTHROPIC_API_KEY" };

  it("calls /chat/completions with a bearer token and JSON response format", async () => {
    const f = fakeFetch(() => ({ status: 200, json: { choices: [{ message: { content: '{"b":2}' } }] } }));
    const p = createProvider("claude", cfg, { ANTHROPIC_API_KEY: "k-123" }, f.impl);
    expect(await p.chatJson(req)).toBe('{"b":2}');
    expect(p.name).toBe("claude");
    expect(f.calls[0].url).toBe("https://api.example.com/v1/chat/completions");
    expect(f.calls[0].headers.get("authorization")).toBe("Bearer k-123");
    expect(f.calls[0].body).toMatchObject({ model: "m", temperature: 0, response_format: { type: "json_object" } });
  });

  it("refuses to start without its API key", () => {
    expect(() => createProvider("claude", cfg, {}, fakeFetch(() => ({ status: 200, json: {} })).impl)).toThrow(
      "ANTHROPIC_API_KEY is not set",
    );
  });

  it("throws QuotaExceededError on HTTP 429", async () => {
    const f = fakeFetch(() => ({ status: 429, json: { error: "rate limited" } }));
    const p = createProvider("w", cfg, { ANTHROPIC_API_KEY: "k" }, f.impl);
    await expect(p.chatJson(req)).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it("throws QuotaExceededError on Cloudflare error code 4006", async () => {
    const f = fakeFetch(() => ({
      status: 400,
      json: { success: false, errors: [{ code: 4006, message: "you have used up your daily free allocation" }] },
    }));
    const p = createProvider("w", cfg, { ANTHROPIC_API_KEY: "k" }, f.impl);
    await expect(p.chatJson(req)).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it("reports other errors with the status and the start of the body", async () => {
    const f = fakeFetch(() => ({ status: 500, json: { error: "x".repeat(1000) } }));
    const p = createProvider("w", cfg, { ANTHROPIC_API_KEY: "k" }, f.impl);
    const err = await p.chatJson(req).catch((e: Error) => e);
    expect(err).not.toBeInstanceOf(QuotaExceededError);
    expect((err as Error).message).toMatch(/^w: HTTP 500: /);
    expect((err as Error).message.length).toBeLessThan(400);
  });
});
