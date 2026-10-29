import { describe, expect, it } from "vitest";
import { upsertDocument } from "../../src/store/documents.ts";
import { getPublished, insertFieldValue, publishFieldValue } from "../../src/store/fieldValues.ts";
import { listProjects } from "../../src/store/projects.ts";
import { adminApp } from "./helpers.ts";

async function withChange() {
  const h = await adminApp();
  const viz = listProjects(h.db).find((p) => p.slug === "vizcachitas")!;
  const doc = upsertDocument(h.db, { url: "javascript:x", status: "done" });
  const id = insertFieldValue(h.db, { projectId: viz.id, field: "capex_usd", valueText: "US$2.7 billion", valueNum: 2.7e9, unit: "USD", documentId: doc, status: "pending" });
  publishFieldValue(h.db, id, "auto", "2026-10-20T07:00:00.000Z");
  const capex = () => getPublished(h.db, viz.id).find((v) => v.field === "capex_usd")!.valueText;
  return { ...h, id, capex };
}

describe("change log tab", () => {
  it("lists changes, links only http(s) sources and offers revert only on the current value", async () => {
    const { get } = await withChange();
    const body = await (await get("/changes")).text();
    expect(body).toContain("US$2.4-2.8 billion");
    expect(body).toContain("US$2.7 billion");
    expect(body).not.toContain('href="javascript:');
    expect(body.match(/>Revert</g)).toHaveLength(1);
  });

  it("reverts through a form post", async () => {
    const { post, get, id, capex } = await withChange();
    const res = await post(`/changes/${id}/revert`);
    expect(res.status).toBe(303);
    expect(capex()).toBe("US$2.4-2.8 billion");
    const body = await (await get("/changes")).text();
    expect(body.indexOf("owner")).toBeGreaterThan(-1);
  });
});

describe("unexpected errors", () => {
  it("show a readable page and go to the log", async () => {
    const { post, logged, db } = await withChange();
    // The imported value has no earlier one, so reverting it cannot work.
    const imported = (db.prepare("SELECT id FROM field_values WHERE field = 'mine_life_years' AND status = 'published'").get() as { id: number }).id;
    const res = await post(`/changes/${imported}/revert`);
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).toContain("Something went wrong");
    expect(body).toContain("has no earlier value");
    expect(logged.join()).toContain("has no earlier value");
  });
});
