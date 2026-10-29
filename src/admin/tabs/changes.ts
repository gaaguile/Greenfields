import type { Hono } from "hono";
import { html } from "hono/html";
import { listChanges, revertChange } from "../../store/review.ts";
import type { AdminEnv } from "../access.ts";
import type { AdminDeps } from "../app.ts";
import { backTo, noticeFrom } from "../forms.ts";
import { link, nyTime, page } from "../layout.ts";

const PAGE_SIZE = 50;

export function changesRoutes(app: Hono<AdminEnv>, deps: AdminDeps): void {
  const { db } = deps;

  app.get("/changes", (c) => {
    const n = Math.max(1, Number(c.req.query("page")) || 1);
    const items = listChanges(db, { limit: PAGE_SIZE + 1, offset: (n - 1) * PAGE_SIZE });
    const more = items.length > PAGE_SIZE;
    const body = html`
<table><tr><th>When</th><th>Project</th><th>Field</th><th>Old</th><th>New</th><th>By</th><th>Source</th><th></th></tr>
${items.slice(0, PAGE_SIZE).map((i) => html`<tr>
  <td>${nyTime(i.decidedAt)}</td><td>${i.projectName}</td><td>${i.label}</td>
  <td>${i.oldValue ?? "—"}</td><td>${i.newValue}</td><td>${i.decidedBy}</td><td>${link(i.documentUrl, "source")}</td>
  <td>${i.revertible ? html`<form class="inline" method="post" action="/changes/${i.id}/revert"><button>Revert</button></form>` : ""}</td>
</tr>`)}
</table>
<p>${n > 1 ? html`<a href="/changes?page=${n - 1}">Newer</a> ` : ""}${more ? html`<a href="/changes?page=${n + 1}">Older</a>` : ""}</p>`;
    return c.html(page("Change log", "changes", body, noticeFrom(c)));
  });

  app.post("/changes/:id/revert", (c) => {
    revertChange(db, Number(c.req.param("id")), deps.now().toISOString());
    return backTo(c, "/changes", "reverted");
  });
}
