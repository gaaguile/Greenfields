import { describe, expect, it } from "vitest";
import type { ModelProvider } from "../../src/ai/provider.ts";
import { QuotaExceededError } from "../../src/ai/provider.ts";
import type { Logger } from "../../src/log.ts";
import { isTransient, withFallback } from "../../src/pipeline/errors.ts";
import { InvalidModelOutputError } from "../../src/pipeline/modelJson.ts";
import { readFoundDocuments } from "../../src/read/reader.ts";
import { triageReadDocuments } from "../../src/pipeline/triage.ts";
import { openDb } from "../../src/store/db.ts";
import { addFoundDocument, listDocumentsByStatus, setDocumentStatus } from "../../src/store/documents.ts";
import { addSource } from "../../src/store/sources.ts";
import type { Fetcher } from "../../src/watch/fetcher.ts";

const log: Logger = { info: () => {}, warn: () => {}, error: () => {} };

function oneDoc(status: "found" | "read") {
  const db = openDb(":memory:");
  const sourceId = addSource(db, { url: "https://x.com/news", kind: "ir_news", company: "X" });
  const id = addFoundDocument(db, { url: "https://x.com/news/1", title: "t", sourceId, projectId: null, status: "found" })!;
  if (status === "read") setDocumentStatus(db, id, "read", { text: "Some text" });
  const attempts = () => (db.prepare("SELECT attempts FROM documents WHERE id = ?").get(id) as { attempts: number }).attempts;
  return { db, attempts };
}

const failingFetcher = (error: string): Fetcher => ({ get: async (url) => ({ ok: false, url, error }) });
const throwing = (message: string): ModelProvider => ({ name: "p", chatJson: async () => { throw new Error(message); } });

describe("isTransient", () => {
  it("recognises outages, timeouts and server errors", () => {
    for (const m of ["ollama: fetch failed", "connect ECONNREFUSED 127.0.0.1:11434", "HTTP 503", "workersAi: HTTP 502: bad gateway",
      "The operation was aborted due to timeout", "getaddrinfo ENOTFOUND x.com", "HTTP 429"]) {
      expect(isTransient(new Error(m))).toBe(true);
    }
  });
  it("does not retry missing pages or bad model output", () => {
    expect(isTransient(new Error("HTTP 404"))).toBe(false);
    expect(isTransient(new InvalidModelOutputError("bad"))).toBe(false);
    expect(isTransient(new QuotaExceededError("quota"))).toBe(false);
  });
});

describe("documents survive temporary errors", () => {
  it("keeps a document found when its server is down, and fails it after 5 tries", async () => {
    const { db, attempts } = oneDoc("found");
    for (let i = 1; i <= 4; i++) {
      await readFoundDocuments(db, failingFetcher("HTTP 503"), log);
      expect(listDocumentsByStatus(db, ["found"])).toHaveLength(1);
      expect(attempts()).toBe(i);
    }
    await readFoundDocuments(db, failingFetcher("HTTP 503"), log);
    expect(listDocumentsByStatus(db, ["failed"])).toHaveLength(1);
  });

  it("fails a missing page straight away", async () => {
    const { db } = oneDoc("found");
    await readFoundDocuments(db, failingFetcher("HTTP 404"), log);
    expect(listDocumentsByStatus(db, ["failed"])).toHaveLength(1);
  });

  it("keeps a document read when the triage model is unreachable", async () => {
    const { db, attempts } = oneDoc("read");
    const r = await triageReadDocuments(db, throwing("ollama: fetch failed"), log, { maxChars: 1000 });
    expect(r.failed).toBe(0);
    expect(listDocumentsByStatus(db, ["read"])).toHaveLength(1);
    expect(attempts()).toBe(1);
  });
});

describe("withFallback", () => {
  const ok = (name: string): ModelProvider & { calls: number } => {
    const p = { name, calls: 0, chatJson: async () => { p.calls++; return "{}"; } };
    return p;
  };
  const req = { system: "s", user: "u", schemaHint: "{}" };

  it("uses the fallback when the primary is unreachable", async () => {
    const fb = ok("workersAi");
    expect(await withFallback(throwing("ollama: fetch failed"), fb, log).chatJson(req)).toBe("{}");
    expect(fb.calls).toBe(1);
  });

  it("does not hide other errors", async () => {
    const fb = ok("workersAi");
    await expect(withFallback(throwing("ollama: HTTP 400: bad model"), fb, log).chatJson(req)).rejects.toThrow("HTTP 400");
    expect(fb.calls).toBe(0);
  });
});
