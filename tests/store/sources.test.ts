import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { importDataset } from "../../src/import/importDataset.ts";
import { openDb } from "../../src/store/db.ts";
import { addSource, listSources, recordCheck } from "../../src/store/sources.ts";

const fixture = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../fixtures/dataset-small.json"), "utf8"));

function setup() {
  const db = openDb(":memory:");
  importDataset(db, fixture, "2026-09-01T12:00:00.000Z");
  return db;
}

const fail = (at: string) => ({ ok: false as const, error: "timeout", at });
const ok = (at: string, linksFound = 5) => ({ ok: true as const, fingerprint: "abc", linksFound, at });

describe("sources store", () => {
  it("is idempotent by URL", () => {
    const db = setup();
    const a = addSource(db, { url: "https://x.com/news", kind: "ir_news", projectSlug: "vizcachitas" });
    const b = addSource(db, { url: "https://x.com/news", kind: "ir_news", projectSlug: "vizcachitas" });
    expect(b).toBe(a);
    const [s] = listSources(db);
    expect(s.projectId).not.toBeNull();
    expect(s.render).toBe(false);
  });

  it("rejects an unknown project slug", () => {
    const db = setup();
    expect(() => addSource(db, { url: "https://x.com", kind: "ir_news", projectSlug: "nope" })).toThrow(
      "unknown project",
    );
  });

  it("marks a source unhealthy on the third failure in a row and resets on success", () => {
    const db = setup();
    const id = addSource(db, { url: "https://x.com/news", kind: "ir_news", company: "X" });
    recordCheck(db, id, fail("2026-10-01T00:00:00Z"));
    recordCheck(db, id, fail("2026-10-02T00:00:00Z"));
    expect(listSources(db)[0]).toMatchObject({ failureCount: 2, health: "ok", lastError: "timeout" });
    recordCheck(db, id, fail("2026-10-03T00:00:00Z"));
    expect(listSources(db)[0]).toMatchObject({ failureCount: 3, health: "unhealthy" });
    recordCheck(db, id, ok("2026-10-04T00:00:00Z"));
    expect(listSources(db)[0]).toMatchObject({ failureCount: 0, health: "ok", lastError: null });
  });

  it("flags a page with no links as changed", () => {
    const db = setup();
    const id = addSource(db, { url: "https://x.com/news", kind: "ir_news" });
    recordCheck(db, id, ok("2026-10-01T00:00:00Z", 0));
    expect(listSources(db)[0].health).toBe("changed");
  });

  it("keeps the first successful check time", () => {
    const db = setup();
    const id = addSource(db, { url: "https://x.com/news", kind: "ir_news" });
    recordCheck(db, id, fail("2026-09-30T00:00:00Z"));
    expect(listSources(db)[0].firstCheckedAt).toBeNull();
    recordCheck(db, id, ok("2026-10-01T00:00:00Z"));
    recordCheck(db, id, ok("2026-10-02T00:00:00Z"));
    expect(listSources(db)[0]).toMatchObject({
      firstCheckedAt: "2026-10-01T00:00:00Z",
      lastCheckedAt: "2026-10-02T00:00:00Z",
      fingerprint: "abc",
    });
  });

  it("omits sources of paused projects when activeOnly is set", () => {
    const db = setup();
    addSource(db, { url: "https://a.com/news", kind: "ir_news", projectSlug: "vizcachitas" });
    addSource(db, { url: "https://b.com/news", kind: "ir_news", company: "B" });
    db.prepare("UPDATE projects SET tracking = 'paused' WHERE slug = 'vizcachitas'").run();
    expect(listSources(db, { activeOnly: true }).map((s) => s.url)).toEqual(["https://b.com/news"]);
    expect(listSources(db)).toHaveLength(2);
  });
});
