import { describe, expect, it } from "vitest";
import { getPublished } from "../../src/store/fieldValues.ts";
import { listProjects } from "../../src/store/projects.ts";
import { listSources } from "../../src/store/sources.ts";
import { adminApp } from "./helpers.ts";

const details = { name: "<b>x</b>", aliases: "Viz, Los Andes", region: "Valparaíso", province: "", locationDetail: "", tracking: "active" };

describe("projects and sources tab", () => {
  it("lists projects and shows an edited name as text", async () => {
    const { get, post } = await adminApp();
    expect(await (await get("/projects")).text()).toContain("Vizcachitas");
    const res = await post("/projects/vizcachitas", details);
    expect(res.status).toBe(303);
    const body = await (await get("/projects/vizcachitas")).text();
    expect(body).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(body).not.toContain("<b>x</b>");
  });

  it("publishes a figure edited on the page as the owner", async () => {
    const { post, db } = await adminApp();
    await post("/projects/vizcachitas/figure", { field: "mine_life_years", valueText: "30 years", valueNum: "30" });
    const viz = listProjects(db).find((p) => p.slug === "vizcachitas")!;
    expect(getPublished(db, viz.id).find((v) => v.field === "mine_life_years")).toMatchObject({ valueText: "30 years", decidedBy: "owner" });
  });

  it("adds a source and refuses one that is not an http(s) URL", async () => {
    const { post, get, db } = await adminApp();
    const bad = await post("/sources", { url: "javascript:alert(1)", kind: "ir_news", project: "vizcachitas" });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toBe("URL must start with http:// or https://");
    await post("/sources", { url: "https://losandescopper.com/news/", kind: "ir_news", project: "vizcachitas" });
    expect(listSources(db).map((s) => s.url)).toEqual(["https://losandescopper.com/news/"]);
    expect(await (await get("/sources")).text()).toContain("https://losandescopper.com/news/");
  });

  it("returns 404 for an unknown project", async () => {
    const { get } = await adminApp();
    expect((await get("/projects/nope")).status).toBe(404);
  });
});
