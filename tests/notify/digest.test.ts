import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { importDataset } from "../../src/import/importDataset.ts";
import { buildDigest, maybeSendDigest } from "../../src/notify/digest.ts";
import { gmailMailer, type Mailer } from "../../src/notify/mailer.ts";
import { openDb } from "../../src/store/db.ts";
import { upsertDocument } from "../../src/store/documents.ts";
import { insertFieldValue } from "../../src/store/fieldValues.ts";
import { listProjects } from "../../src/store/projects.ts";
import { addSource, recordCheck } from "../../src/store/sources.ts";

const fixture = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../fixtures/dataset-small.json"), "utf8"));
const NY = "America/New_York";
const NOW = "2026-10-28T14:30:00.000Z";

function setup() {
  const db = openDb(":memory:");
  importDataset(db, fixture, "2026-09-01T12:00:00.000Z");
  return db;
}

function holdCapex(db: ReturnType<typeof openDb>) {
  const viz = listProjects(db).find((p) => p.slug === "vizcachitas")!;
  const doc = upsertDocument(db, { url: "https://losandescopper.com/news/2026/pfs-update/", status: "done" });
  insertFieldValue(db, {
    projectId: viz.id, field: "capex_usd", valueText: "US$3.5 billion", valueNum: 3.5e9, unit: "USD",
    documentId: doc, quote: "q", confidence: 0.9, status: "pending", holdReason: "change beyond ±20%",
  });
}

function recordingMailer() {
  const sent: { to: string; subject: string; text: string }[] = [];
  const mailer: Mailer = async (m) => { sent.push(m); };
  return { sent, mailer };
}

describe("buildDigest", () => {
  it("returns null when there is nothing to report", () => {
    expect(buildDigest(setup(), NOW, NY)).toBeNull();
  });

  it("lists a held change with both values, the reason and the source", () => {
    const db = setup();
    holdCapex(db);
    const d = buildDigest(db, NOW, NY)!;
    expect(d.subject).toBe("Greenfields: 1 change to review");
    expect(d.text).toContain("Vizcachitas");
    expect(d.text).toContain("US$2.4-2.8 billion");
    expect(d.text).toContain("US$3.5 billion");
    expect(d.text).toContain("change beyond ±20%");
    expect(d.text).toContain("https://losandescopper.com/news/2026/pfs-update/");
  });

  it("reports unhealthy sources even with no changes to review", () => {
    const db = setup();
    const id = addSource(db, { url: "https://x.com/news", kind: "ir_news", company: "X" });
    for (const day of ["01", "02", "03"]) recordCheck(db, id, { ok: false, error: "HTTP 503", at: `2026-10-${day}T00:00:00Z` });
    const d = buildDigest(db, NOW, NY)!;
    expect(d.subject).toBe("Greenfields: 1 problem to check");
    expect(d.text).toContain("https://x.com/news");
    expect(d.text).toContain("HTTP 503");
  });
});

describe("maybeSendDigest", () => {
  it("sends nothing when there is nothing to report", async () => {
    const { sent, mailer } = recordingMailer();
    expect(await maybeSendDigest(setup(), mailer, NOW, NY, "me@example.com")).toBe("nothing");
    expect(sent).toHaveLength(0);
  });

  it("sends at most one digest per New York day", async () => {
    const db = setup();
    holdCapex(db);
    const { sent, mailer } = recordingMailer();
    expect(await maybeSendDigest(db, mailer, NOW, NY, "me@example.com")).toBe("sent");
    expect(sent[0].to).toBe("me@example.com");
    expect(await maybeSendDigest(db, mailer, "2026-10-29T03:00:00.000Z", NY, "me@example.com")).toBe("already-sent");
    expect(await maybeSendDigest(db, mailer, "2026-10-29T14:30:00.000Z", NY, "me@example.com")).toBe("sent");
  });

  it("does not record the day when sending fails, so the next run retries", async () => {
    const db = setup();
    holdCapex(db);
    const failing: Mailer = async () => { throw new Error("SMTP down"); };
    await expect(maybeSendDigest(db, failing, NOW, NY, "me@example.com")).rejects.toThrow("SMTP down");
    const { mailer } = recordingMailer();
    expect(await maybeSendDigest(db, mailer, NOW, NY, "me@example.com")).toBe("sent");
  });
});

describe("gmailMailer", () => {
  it("refuses to start without an app password", () => {
    expect(() => gmailMailer({ GMAIL_USER: "me@gmail.com" })).toThrow("GMAIL_APP_PASSWORD is not set");
  });
});
