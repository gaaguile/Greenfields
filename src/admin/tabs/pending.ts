import type { Hono } from "hono";
import { html } from "hono/html";
import { approvePending, editAndApprove, listPending, rejectPending, type PendingItem } from "../../store/review.ts";
import type { AdminEnv } from "../access.ts";
import type { AdminDeps } from "../app.ts";
import { backTo, noticeFrom } from "../forms.ts";
import { link, nyTime, page } from "../layout.ts";

function item(p: PendingItem) {
  return html`<div class="card">
  <label><input type="checkbox" name="ids" value="${p.id}" form="bulk"> <strong>${p.projectName}</strong> · ${p.label}</label>
  <p>${p.current ?? "—"} → <strong>${p.proposed}</strong></p>
  ${p.newerPublished ? html`<p class="warn">A newer value was published since this was held (${nyTime(p.currentDecidedAt)}).</p>` : ""}
  <p class="muted">Held because: ${p.holdReason ?? "—"}${p.confidence !== null ? html` · confidence ${p.confidence.toFixed(2)}` : ""}${p.figureDate ? html` · as of ${p.figureDate}` : ""}</p>
  ${p.quote ? html`<blockquote>${p.quote}</blockquote>` : ""}
  <p class="muted">Source: ${link(p.documentUrl, p.documentTitle)}</p>
  <form class="inline" method="post" action="/pending/${p.id}/approve"><button class="primary">Approve</button></form>
  <form class="inline" method="post" action="/pending/${p.id}/reject"><button>Reject</button></form>
  <details><summary>Edit and approve</summary>
    <form method="post" action="/pending/${p.id}/edit">
      <p><label>Value <input type="text" name="valueText" value="${p.proposed}" size="40" required></label></p>
      <p><label>Number (optional, plain units such as dollars or years) <input type="text" name="valueNum"></label></p>
      <button class="primary">Save and approve</button>
    </form>
  </details>
</div>`;
}

const ids = (v: unknown): number[] => [v].flat().filter((x): x is string => typeof x === "string").map(Number).filter(Number.isInteger);

export function pendingRoutes(app: Hono<AdminEnv>, deps: AdminDeps): void {
  const { db } = deps;
  const at = () => deps.now().toISOString();

  app.get("/pending", (c) => {
    const items = listPending(db);
    const body = items.length
      ? html`<form id="bulk" method="post" action="/pending/bulk">
  <button name="action" value="approve" class="primary">Approve selected</button>
  <button name="action" value="reject">Reject selected</button>
</form>
<p class="muted">${items.length} change${items.length === 1 ? "" : "s"} waiting. Approved changes go live with Publish now or at the next run.</p>
${items.map(item)}`
      : html`<p class="muted">No changes waiting.</p>`;
    return c.html(page("Pending changes", "pending", body, noticeFrom(c)));
  });

  app.post("/pending/bulk", async (c) => {
    const form = await c.req.parseBody({ all: true });
    const chosen = ids(form.ids);
    if (!chosen.length) return backTo(c, "/pending", "nothing-selected");
    const approve = form.action === "approve";
    for (const id of chosen) (approve ? approvePending : rejectPending)(db, id, at());
    return backTo(c, "/pending", approve ? "approved" : "rejected");
  });

  app.post("/pending/:id/approve", (c) => {
    approvePending(db, Number(c.req.param("id")), at());
    return backTo(c, "/pending", "approved");
  });

  app.post("/pending/:id/reject", (c) => {
    rejectPending(db, Number(c.req.param("id")), at());
    return backTo(c, "/pending", "rejected");
  });

  app.post("/pending/:id/edit", async (c) => {
    const form = await c.req.parseBody();
    const valueText = String(form.valueText ?? "").trim();
    if (!valueText) return c.text("A value is required", 400);
    const rawNum = String(form.valueNum ?? "").trim().replace(/,/g, "");
    const valueNum = rawNum === "" ? null : Number(rawNum);
    if (valueNum !== null && !Number.isFinite(valueNum)) return c.text("The number is not a number", 400);
    editAndApprove(db, Number(c.req.param("id")), { valueText, valueNum }, at());
    return backTo(c, "/pending", "edited");
  });
}
