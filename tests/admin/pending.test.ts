import { describe, expect, it } from "vitest";
import { upsertDocument } from "../../src/store/documents.ts";
import { getPublished, insertFieldValue } from "../../src/store/fieldValues.ts";
import { listProjects } from "../../src/store/projects.ts";
import { adminApp } from "./helpers.ts";

async function withPending() {
  const h = await adminApp();
  const viz = listProjects(h.db).find((p) => p.slug === "vizcachitas")!;
  const doc = upsertDocument(h.db, { url: "javascript:alert(1)", title: "<b>bold</b>", status: "done" });
  const hold = (valueText: string, valueNum: number, quote = "a quote with the figure in it") =>
    insertFieldValue(h.db, {
      projectId: viz.id, field: "capex_usd", valueText, valueNum, unit: "USD", documentId: doc, quote, confidence: 0.9,
      status: "pending", holdReason: "change beyond ±20%",
    });
  const capex = () => getPublished(h.db, viz.id).find((v) => v.field === "capex_usd")!.valueText;
  return { ...h, viz, hold, capex };
}

describe("pending changes tab", () => {
  it("shows text from documents as text and never links a javascript: URL", async () => {
    const { get, hold } = await withPending();
    hold("US$3.5 billion", 3.5e9, '"><img src=x onerror=alert(1)>');
    const body = await (await get("/pending")).text();
    expect(body).toContain("US$3.5 billion");
    expect(body).not.toContain("<img src=x");
    expect(body).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(body).not.toContain('href="javascript:');
    expect(body).not.toContain("<b>bold</b>");
  });

  it("approves through a form post", async () => {
    const { post, hold, capex } = await withPending();
    const id = hold("US$3.5 billion", 3.5e9);
    const res = await post(`/pending/${id}/approve`);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/pending?notice=approved");
    expect(capex()).toBe("US$3.5 billion");
  });

  it("edits and approves", async () => {
    const { post, hold, capex } = await withPending();
    const id = hold("US$3.5 billion", 3.5e9);
    await post(`/pending/${id}/edit`, { valueText: "US$3.1 billion", valueNum: "3100000000" });
    expect(capex()).toBe("US$3.1 billion");
  });

  it("approves several at once and rejects", async () => {
    const { post, hold, db } = await withPending();
    const a = hold("US$3.5 billion", 3.5e9);
    const b = hold("US$3.6 billion", 3.6e9);
    const c = hold("US$3.7 billion", 3.7e9);
    await post("/pending/bulk", { action: "approve", ids: [String(a), String(b)] });
    await post(`/pending/${c}/reject`);
    const status = (id: number) => (db.prepare("SELECT status FROM field_values WHERE id = ?").get(id) as { status: string }).status;
    expect([status(a), status(b), status(c)]).toEqual(["superseded", "published", "rejected"]);
  });

  it("does not act on a GET", async () => {
    const { get, hold } = await withPending();
    const id = hold("US$3.5 billion", 3.5e9);
    expect((await get(`/pending/${id}/approve`)).status).toBe(404);
  });
});
