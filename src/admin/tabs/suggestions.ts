import type { Hono } from "hono";
import { html } from "hono/html";
import { listProjects } from "../../store/projects.ts";
import { approveSuggestion, listSuggestions, mergeSuggestion, rejectSuggestion, type SuggestionRow } from "../../store/suggestions.ts";
import type { AdminEnv } from "../access.ts";
import type { AdminDeps } from "../app.ts";
import { backTo, noticeFrom } from "../forms.ts";
import { link, nyTime, page } from "../layout.ts";

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function suggestionsRoutes(app: Hono<AdminEnv>, deps: AdminDeps): void {
  const { db } = deps;
  const at = () => deps.now().toISOString();

  app.get("/suggestions", (c) => {
    const items = listSuggestions(db, "pending");
    const projects = listProjects(db);
    const name = new Map(projects.map((p) => [p.id, p.name]));
    const urls = db.prepare("SELECT id, url, title FROM documents").all() as { id: number; url: string; title: string | null }[];
    const doc = new Map(urls.map((d) => [d.id, d]));
    const card = (s: SuggestionRow) => {
      const d = s.data;
      return html`<div class="card">
  <h2>${d.name}</h2>
  <p>${d.company} · ${d.minerals.join(", ") || "—"} · ${d.region ?? "region unknown"} · ${d.stageText}</p>
  ${s.duplicateOf !== null ? html`<p class="warn">Looks like: ${name.get(s.duplicateOf) ?? "a tracked project"}</p>` : ""}
  ${d.aliases.length ? html`<p class="muted">Also called: ${d.aliases.join(", ")}</p>` : ""}
  <blockquote>${d.quote}</blockquote>
  <p class="muted">Suggested ${nyTime(s.createdAt)} from ${s.documentIds.length} document${s.documentIds.length === 1 ? "" : "s"}:</p>
  <ul>${s.documentIds.map((id) => html`<li>${link(doc.get(id)?.url ?? null, doc.get(id)?.title)}</li>`)}</ul>
  <details><summary><strong>Approve</strong> (check the details first)</summary>
    <form method="post" action="/suggestions/${s.id}/approve">
      <p><label>Name <input type="text" name="name" value="${d.name}" size="40" required></label></p>
      <p><label>Owners <input type="text" name="owners" value="${d.company}" size="40"></label></p>
      <p><label>Minerals (comma-separated) <input type="text" name="minerals" value="${d.minerals.join(", ")}"></label></p>
      <p><label>Region <input type="text" name="region" value="${d.region ?? ""}"></label></p>
      <p><label>Stage <input type="text" name="stageText" value="${d.stageText}" size="40"></label></p>
      <button class="primary">Create the project</button>
    </form>
  </details>
  <form class="inline" method="post" action="/suggestions/${s.id}/merge">
    <select name="project">${projects.map((p) => html`<option value="${p.slug}" ${p.id === s.duplicateOf ? "selected" : ""}>${p.name}</option>`)}</select>
    <button>Merge into this project</button>
  </form>
  <form class="inline" method="post" action="/suggestions/${s.id}/reject"><button>Reject</button></form>
</div>`;
    };
    const body = items.length
      ? html`<p class="muted">${items.length} suggested project${items.length === 1 ? "" : "s"}. Nothing is published until you approve it; rejected names are not suggested again.</p>${items.map(card)}`
      : html`<p class="muted">No suggested projects.</p>`;
    return c.html(page("Suggested projects", "suggestions", body, noticeFrom(c)));
  });

  app.post("/suggestions/:id/approve", async (c) => {
    const form = await c.req.parseBody();
    const name = str(form.name);
    if (!name) return c.text("A name is required", 400);
    const id = Number(c.req.param("id"));
    const website = listSuggestions(db, "pending").find((s) => s.id === id)?.data.companyWebsite ?? null;
    let slug: string;
    try {
      slug = approveSuggestion(db, id, {
        name,
        owners: str(form.owners),
        minerals: str(form.minerals).split(",").map((m) => m.trim()).filter(Boolean),
        region: str(form.region),
        stageText: str(form.stageText),
      }, at()).slug;
    } catch (err) {
      if ((err as Error).message.includes("already exists")) return c.text("A project with this name already exists; use Merge instead", 409);
      throw err;
    }
    // The company website is offered as a watched page; the owner still has to add it.
    const path = website ? `/projects/${slug}?suggestedSource=${encodeURIComponent(website)}` : `/projects/${slug}`;
    return backTo(c, path, "suggestion-approved");
  });

  app.post("/suggestions/:id/merge", async (c) => {
    const form = await c.req.parseBody();
    const project = listProjects(db).find((p) => p.slug === str(form.project));
    if (!project) return c.text("Unknown project", 400);
    mergeSuggestion(db, Number(c.req.param("id")), project.id, at());
    return backTo(c, "/suggestions", "suggestion-merged");
  });

  app.post("/suggestions/:id/reject", (c) => {
    rejectSuggestion(db, Number(c.req.param("id")), at());
    return backTo(c, "/suggestions", "suggestion-rejected");
  });
}
