import { describe, expect, it } from "vitest";
import { upsertDocument } from "../../src/store/documents.ts";
import { listProjects } from "../../src/store/projects.ts";
import { createSuggestion, getSuggestion } from "../../src/store/suggestions.ts";
import { candidate } from "../helpers/candidate.ts";
import { adminApp } from "./helpers.ts";

async function withSuggestion(o: Parameters<typeof candidate>[0] = {}) {
  const h = await adminApp();
  const doc = upsertDocument(h.db, { url: "javascript:x", title: "t", status: "done" });
  const id = createSuggestion(h.db, candidate(o), doc, null, "2026-10-29T12:00:00.000Z");
  return { ...h, id };
}

const approveForm = { name: "Cerro Azul", owners: "Andes Exploration Corp.", minerals: "Copper, Gold", region: "Atacama", stageText: "Early-stage exploration" };

describe("suggested projects tab", () => {
  it("shows suggestion text escaped and never links a javascript: URL", async () => {
    const { get } = await withSuggestion({ name: "<img src=x onerror=alert(1)>" });
    const body = await (await get("/suggestions")).text();
    expect(body).not.toContain("<img src=x");
    expect(body).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(body).not.toContain('href="javascript:');
  });

  it("approves and goes to the new project's page, offering the company website as a source", async () => {
    const { post, get, db, id } = await withSuggestion({ companyWebsite: "https://andesexploration.com" });
    const res = await post(`/suggestions/${id}/approve`, approveForm);
    expect(res.status).toBe(303);
    const location = res.headers.get("location")!;
    expect(location.startsWith("/projects/cerro-azul?")).toBe(true);
    expect(listProjects(db).some((p) => p.slug === "cerro-azul")).toBe(true);
    const page = await (await get(location)).text();
    expect(page).toContain('value="https://andesexploration.com"');
  });

  it("uses the other names as edited on the approve form", async () => {
    const { post, db, id } = await withSuggestion({ aliases: ["Azul Project", "Planted Name"] });
    await post(`/suggestions/${id}/approve`, { ...approveForm, aliases: "Azul Project" });
    expect(listProjects(db).find((p) => p.slug === "cerro-azul")!.aliases).toEqual(["Azul Project"]);
  });

  it("does not prefill a source that is not an http(s) address", async () => {
    const { get } = await adminApp();
    const page = await (await get("/projects/vizcachitas?suggestedSource=javascript%3Aalert(1)")).text();
    expect(page).not.toContain("javascript:alert(1)");
  });

  it("merges into a chosen project and refuses an unknown one", async () => {
    const { post, db, id } = await withSuggestion();
    expect((await post(`/suggestions/${id}/merge`, { project: "nope" })).status).toBe(400);
    expect((await post(`/suggestions/${id}/merge`, { project: "vizcachitas" })).status).toBe(303);
    expect(getSuggestion(db, id)!.status).toBe("merged");
  });

  it("rejects, and refuses a press from another site", async () => {
    const { post, db, id } = await withSuggestion();
    expect((await post(`/suggestions/${id}/reject`, {}, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post(`/suggestions/${id}/reject`)).status).toBe(303);
    expect(getSuggestion(db, id)!.status).toBe("rejected");
  });
});
