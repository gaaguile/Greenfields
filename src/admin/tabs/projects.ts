import type { Context, Hono } from "hono";
import { html } from "hono/html";
import { FIELD_LABELS } from "../../domain/fields.ts";
import type { ProjectRow } from "../../domain/types.ts";
import { getPublished } from "../../store/fieldValues.ts";
import { listProjects } from "../../store/projects.ts";
import { reviewLabel, setFigureByOwner, updateProjectDetails } from "../../store/review.ts";
import { addSource, deleteSource, listSources, updateSource, type SourceKind, type SourceRow } from "../../store/sources.ts";
import type { AdminEnv } from "../access.ts";
import type { AdminDeps } from "../app.ts";
import { backTo, noticeFrom } from "../forms.ts";
import { link, nyTime, page } from "../layout.ts";

const KINDS: SourceKind[] = ["ir_news", "seia", "cochilco", "news_feed", "newswire"];
const EDITABLE_FIELDS = ["stage", "owners", "minerals", ...Object.keys(FIELD_LABELS)];

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const isHttpUrl = (u: string) => /^https?:\/\/[^\s]+$/i.test(u);

function sourceForm(action: string, projects: ProjectRow[], s?: SourceRow, fixedProject?: ProjectRow) {
  return html`<form method="post" action="${action}">
  <input type="url" name="url" value="${s?.url ?? ""}" size="50" placeholder="https://…" required>
  <select name="kind">${KINDS.map((k) => html`<option value="${k}" ${s?.kind === k ? "selected" : ""}>${k}</option>`)}</select>
  ${fixedProject
    ? html`<input type="hidden" name="project" value="${fixedProject.slug}">`
    : html`<select name="project"><option value="">(company-wide)</option>${projects.map((p) => html`<option value="${p.slug}" ${s?.projectId === p.id ? "selected" : ""}>${p.name}</option>`)}</select>`}
  <input type="text" name="company" value="${s?.company ?? ""}" placeholder="Company">
  <label><input type="checkbox" name="render" value="1" ${s?.render ? "checked" : ""}> needs a browser</label>
  <button class="primary">${s ? "Save" : "Add source"}</button>
</form>`;
}

async function readSource(c: Context, projects: ProjectRow[]) {
  const form = await c.req.parseBody();
  const url = str(form.url);
  if (!isHttpUrl(url)) return { error: "URL must start with http:// or https://" } as const;
  const kind = str(form.kind) as SourceKind;
  if (!KINDS.includes(kind)) return { error: "Unknown kind" } as const;
  const slug = str(form.project);
  const project = slug ? projects.find((p) => p.slug === slug) : undefined;
  if (slug && !project) return { error: "Unknown project" } as const;
  return { url, kind, project, company: str(form.company) || null, render: form.render === "1" } as const;
}

export function projectsRoutes(app: Hono<AdminEnv>, deps: AdminDeps): void {
  const { db } = deps;
  const at = () => deps.now().toISOString();
  const bySlug = (slug: string) => listProjects(db).find((p) => p.slug === slug);

  app.get("/projects", (c) => {
    const projects = listProjects(db);
    const sources = listSources(db);
    const body = html`<p><a href="/sources">All watched pages</a></p>
<table><tr><th>Project</th><th>Owners</th><th>Stage</th><th>Tracking</th><th>Pages</th><th>Updated</th></tr>
${projects.map((p) => html`<tr><td><a href="/projects/${p.slug}">${p.name}</a></td><td>${p.owners}</td><td>${p.stageText}</td>
  <td>${p.tracking}</td><td>${sources.filter((s) => s.projectId === p.id).length}</td><td>${nyTime(p.updatedAt)}</td></tr>`)}
</table>`;
    return c.html(page("Projects & sources", "projects", body, noticeFrom(c)));
  });

  app.get("/projects/:slug", (c) => {
    const p = bySlug(c.req.param("slug"));
    if (!p) return c.text("No such project", 404);
    const published = new Map(getPublished(db, p.id).map((v) => [v.field, v.valueText]));
    const projectValue: Record<string, string> = { stage: p.stageText, owners: p.owners, minerals: p.minerals.join(", ") };
    const sources = listSources(db).filter((s) => s.projectId === p.id);
    const body = html`<p><a href="/projects">← All projects</a></p>
<div class="card"><h2>${p.name}</h2>
<form method="post" action="/projects/${p.slug}">
  <p><label>Name <input type="text" name="name" value="${p.name}" size="40" required></label></p>
  <p><label>Also known as (comma-separated) <input type="text" name="aliases" value="${p.aliases.join(", ")}" size="50"></label></p>
  <p><label>Region <input type="text" name="region" value="${p.region}"></label>
     <label>Province <input type="text" name="province" value="${p.province ?? ""}"></label></p>
  <p><label>Location <input type="text" name="locationDetail" value="${p.locationDetail ?? ""}" size="50"></label></p>
  <p><label>Tracking <select name="tracking">
    <option value="active" ${p.tracking === "active" ? "selected" : ""}>active</option>
    <option value="paused" ${p.tracking === "paused" ? "selected" : ""}>paused (hidden from the public table)</option>
  </select></label></p>
  <button class="primary">Save details</button>
</form></div>
<h2>Figures</h2>
<p class="muted">Saving a figure publishes it as your own value (no source document) at the next publish.</p>
<table><tr><th>Field</th><th>Current</th><th>New value</th></tr>
${EDITABLE_FIELDS.map((field) => html`<tr><td>${reviewLabel(field)}</td><td>${projectValue[field] ?? published.get(field) ?? "—"}</td><td>
  <form method="post" action="/projects/${p.slug}/figure">
    <input type="hidden" name="field" value="${field}">
    ${field === "additional_info"
      ? html`<textarea name="valueText" rows="3" cols="50" required></textarea>`
      : html`<input type="text" name="valueText" size="30" required>`}
    <input type="text" name="valueNum" size="12" placeholder="number (optional)">
    <button>Save</button>
  </form></td></tr>`)}
</table>
<h2>Watched pages</h2>
${sources.map((s) => html`<div class="card">${link(s.url)} <span class="muted">${s.kind} · ${s.health}</span>
  ${sourceForm(`/sources/${s.id}`, [], s, p)}
  <form class="inline" method="post" action="/sources/${s.id}/delete"><button>Remove</button></form></div>`)}
<div class="card"><h3>Add a page</h3>${sourceForm("/sources", [], undefined, p)}</div>`;
    return c.html(page(p.name, "projects", body, noticeFrom(c)));
  });

  app.post("/projects/:slug", async (c) => {
    const p = bySlug(c.req.param("slug"));
    if (!p) return c.text("No such project", 404);
    const form = await c.req.parseBody();
    const name = str(form.name);
    if (!name) return c.text("A name is required", 400);
    updateProjectDetails(db, p.id, {
      name,
      aliases: str(form.aliases).split(",").map((a) => a.trim()).filter(Boolean),
      region: str(form.region),
      province: str(form.province) || null,
      locationDetail: str(form.locationDetail) || null,
      tracking: form.tracking === "paused" ? "paused" : "active",
    }, at());
    return backTo(c, `/projects/${p.slug}`, "saved");
  });

  app.post("/projects/:slug/figure", async (c) => {
    const p = bySlug(c.req.param("slug"));
    if (!p) return c.text("No such project", 404);
    const form = await c.req.parseBody();
    const field = str(form.field);
    const valueText = str(form.valueText);
    if (!EDITABLE_FIELDS.includes(field) || !valueText) return c.text("A field and a value are required", 400);
    const rawNum = str(form.valueNum).replace(/,/g, "");
    const valueNum = rawNum === "" ? null : Number(rawNum);
    if (valueNum !== null && !Number.isFinite(valueNum)) return c.text("The number is not a number", 400);
    setFigureByOwner(db, p.id, field, valueText, valueNum, at());
    return backTo(c, `/projects/${p.slug}`, "saved");
  });

  app.get("/sources", (c) => {
    const projects = listProjects(db);
    const name = new Map(projects.map((p) => [p.id, p.name]));
    const sources = [...listSources(db)].sort((a, b) => Number(a.projectId !== null) - Number(b.projectId !== null));
    const body = html`<p><a href="/projects">← Projects</a></p>
<table><tr><th>Page</th><th>Project</th><th>Company</th><th>Kind</th><th>State</th><th>Last checked</th></tr>
${sources.map((s) => html`<tr><td>${link(s.url)}${s.render ? html` <span class="muted">(browser)</span>` : ""}</td>
  <td>${s.projectId === null ? html`<span class="muted">company-wide</span>` : name.get(s.projectId)}</td>
  <td>${s.company ?? "—"}</td><td>${s.kind}</td><td>${s.health}</td><td>${nyTime(s.lastCheckedAt)}</td></tr>`)}
</table>
<div class="card"><h3>Add a page</h3>${sourceForm("/sources", projects)}</div>`;
    return c.html(page("Watched pages", "projects", body, noticeFrom(c)));
  });

  app.post("/sources", async (c) => {
    const s = await readSource(c, listProjects(db));
    if ("error" in s) return c.text(s.error!, 400);
    addSource(db, { url: s.url, kind: s.kind, projectSlug: s.project?.slug, company: s.company ?? undefined, render: s.render });
    return backTo(c, s.project ? `/projects/${s.project.slug}` : "/sources", "source-saved");
  });

  app.post("/sources/:id", async (c) => {
    const s = await readSource(c, listProjects(db));
    if ("error" in s) return c.text(s.error!, 400);
    updateSource(db, Number(c.req.param("id")), { url: s.url, kind: s.kind, projectId: s.project?.id ?? null, company: s.company, render: s.render });
    return backTo(c, s.project ? `/projects/${s.project.slug}` : "/sources", "source-saved");
  });

  app.post("/sources/:id/delete", (c) => {
    deleteSource(db, Number(c.req.param("id")));
    return backTo(c, "/sources", "source-deleted");
  });
}
