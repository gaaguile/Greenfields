import { html } from "hono/html";
import type { Hono } from "hono";
import type { AdminEnv } from "../access.ts";
import { lastPublish } from "../actions.ts";
import type { AdminDeps } from "../app.ts";
import { backTo, noticeFrom } from "../forms.ts";
import { link, nyTime, page } from "../layout.ts";
import { nextSlot } from "../../schedule/slots.ts";
import { listSources } from "../../store/sources.ts";

interface RunRow {
  id: number; started_at: string; ended_at: string | null; trigger: string; counts: string | null; errors: string | null;
  postponed: number; published: number;
}

const DAY_MS = 86_400_000;

function duration(r: RunRow): string {
  if (!r.ended_at) return "unfinished";
  const s = Math.round((Date.parse(r.ended_at) - Date.parse(r.started_at)) / 1000);
  return s < 60 ? `${s} s` : `${Math.round(s / 60)} min`;
}

const countsText = (json: string | null) =>
  json ? Object.entries(JSON.parse(json) as Record<string, number>).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(", ") || "nothing new" : "—";

export function healthRoutes(app: Hono<AdminEnv>, deps: AdminDeps): void {
  const { db, cfg } = deps;

  app.get("/health", (c) => {
    const now = deps.now();
    const runs = db.prepare("SELECT * FROM runs ORDER BY id DESC LIMIT 10").all() as unknown as RunRow[];
    const next = nextSlot(now, cfg.pipeline.slots, cfg.timezone);
    const sources = listSources(db).filter((s) => s.health !== "ok");
    const failed = db.prepare(
      "SELECT url, error, updated_at FROM documents WHERE status = 'failed' AND updated_at >= ? ORDER BY updated_at DESC",
    ).all(new Date(now.getTime() - 7 * DAY_MS).toISOString()) as { url: string; error: string | null; updated_at: string }[];
    const published = lastPublish(db);
    const quota = (db.prepare("SELECT value FROM meta WHERE key = 'quota_exhausted_at'").get() as { value: string } | undefined)?.value;

    const body = html`
<div class="card">
  <p>Next run: <strong>${nyTime(next.at.toISOString())}</strong> (New York time)</p>
  <p>${quota ? html`Workers AI quota last ran out ${nyTime(quota)}.` : "No Workers AI quota problems."}</p>
  ${published ? html`<p>${published.outcome === "failed"
    ? html`<span class="warn">Last Publish now failed ${nyTime(published.at)}: ${published.error}</span>`
    : html`Last Publish now: ${{ deployed: "site updated", unchanged: "nothing to publish", busy: "a run was in progress", failed: "" }[published.outcome]} (${nyTime(published.at)}).`}</p>` : ""}
  <form class="inline" method="post" action="/health/run"><button class="primary">Run now</button></form>
  <form class="inline" method="post" action="/health/publish"><button>Publish now</button></form>
</div>
<h2>Recent runs</h2>
${runs.length ? html`<table><tr><th>Started</th><th>Trigger</th><th>Took</th><th>Counts</th><th>Errors</th><th>Deployed</th></tr>
${runs.map((r) => html`<tr>
  <td>${nyTime(r.started_at)}${r.postponed ? html` <span class="muted">(GPU busy: postponed)</span>` : ""}</td>
  <td>${r.trigger}</td><td>${duration(r)}</td><td>${countsText(r.counts)}</td>
  <td>${(r.errors ? (JSON.parse(r.errors) as string[]) : []).map((e) => html`<div class="warn">${e}</div>`)}</td>
  <td>${r.published ? "yes" : "no"}</td></tr>`)}
</table>` : html`<p class="muted">No runs yet.</p>`}
<h2>Sources needing attention</h2>
${sources.length ? html`<table><tr><th>Page</th><th>State</th><th>Failures in a row</th><th>Last error</th></tr>
${sources.map((s) => html`<tr><td>${link(s.url)}</td><td>${s.health}</td><td>${s.failureCount}</td><td>${s.lastError ?? "—"}</td></tr>`)}
</table>` : html`<p class="muted">All sources are fine.</p>`}
<h2>Documents that failed in the last 7 days</h2>
${failed.length ? html`<table><tr><th>Document</th><th>Error</th><th>When</th></tr>
${failed.map((d) => html`<tr><td>${link(d.url)}</td><td>${d.error ?? "—"}</td><td>${nyTime(d.updated_at)}</td></tr>`)}
</table>` : html`<p class="muted">None.</p>`}`;
    return c.html(page("Runs & health", "health", body, noticeFrom(c)));
  });

  app.post("/health/run", (c) => backTo(c, "/health", deps.actions.runNow().started ? "run-started" : "run-busy"));

  app.post("/health/publish", (c) => backTo(c, "/health", "busy" in deps.actions.publishNow() ? "publish-busy" : "publish-started"));
}
