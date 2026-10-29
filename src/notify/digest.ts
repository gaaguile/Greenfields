import type { DatabaseSync } from "node:sqlite";
import { fieldLabel } from "../domain/fields.ts";
import type { Mailer } from "./mailer.ts";

const DIGEST_KEY = "last_digest_date";
const REVIEW_URL = "https://greenfields-admin.gabrieltekken.com/pending";
const DAY_MS = 86_400_000;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

interface PendingRow {
  project: string; field: string; proposed: string; reason: string | null; url: string | null; current: string | null;
}

// Everything the owner should look at; null when there is nothing.
export function buildDigest(db: DatabaseSync, nowIso: string, tz: string): { subject: string; text: string } | null {
  const pending = db.prepare(
    `SELECT p.name AS project, v.field, v.value_text AS proposed, v.hold_reason AS reason, d.url,
       (SELECT c.value_text FROM field_values c WHERE c.project_id = v.project_id AND c.field = v.field
          AND c.status = 'published') AS current
     FROM field_values v JOIN projects p ON p.id = v.project_id LEFT JOIN documents d ON d.id = v.document_id
     WHERE v.status = 'pending' ORDER BY p.name, v.field`,
  ).all() as unknown as PendingRow[];
  const suggestions = (db.prepare("SELECT COUNT(*) AS n FROM suggestions WHERE status = 'pending'").get() as { n: number }).n;
  const sources = db.prepare(
    "SELECT url, health, last_error FROM sources WHERE health != 'ok' ORDER BY url",
  ).all() as { url: string; health: string; last_error: string | null }[];
  const since = new Date(Date.parse(nowIso) - DAY_MS).toISOString();
  const failedDocs = db.prepare(
    "SELECT url, error FROM documents WHERE status = 'failed' AND updated_at >= ? ORDER BY url",
  ).all(since) as { url: string; error: string | null }[];
  const lastRun = db.prepare("SELECT errors FROM runs WHERE ended_at IS NOT NULL ORDER BY id DESC LIMIT 1").get() as
    | { errors: string | null }
    | undefined;
  const runErrors: string[] = lastRun?.errors ? JSON.parse(lastRun.errors) : [];

  const problems = sources.length + failedDocs.length + runErrors.length;
  if (!pending.length && !suggestions && !problems) return null;

  const lines: string[] = [];
  if (pending.length) {
    lines.push(`Changes to review (${pending.length})`, "");
    for (const p of pending) {
      lines.push(`- ${p.project} · ${fieldLabel(p.field)}: ${p.current ?? "—"} → ${p.proposed}`);
      lines.push(`  Held because: ${p.reason ?? "—"}`);
      if (p.url) lines.push(`  Source: ${p.url}`);
    }
    lines.push("", `Review: ${REVIEW_URL}`, "");
  }
  if (suggestions) lines.push(`Suggested new projects: ${suggestions}`, "");
  if (sources.length) {
    lines.push("Sources needing attention", "");
    for (const s of sources) lines.push(`- ${s.url} (${s.health}${s.last_error ? `: ${s.last_error}` : ""})`);
    lines.push("");
  }
  if (failedDocs.length) {
    lines.push("Documents that failed in the last 24 hours", "");
    for (const d of failedDocs) lines.push(`- ${d.url}: ${d.error ?? "unknown error"}`);
    lines.push("");
  }
  if (runErrors.length) {
    lines.push("Last run errors", "");
    for (const e of runErrors) lines.push(`- ${e}`);
    lines.push("");
  }
  const when = new Date(nowIso).toLocaleString("en-US", { timeZone: tz, dateStyle: "medium", timeStyle: "short" });
  lines.push(`Generated ${when} (New York time).`);

  const subject = pending.length
    ? `Greenfields: ${plural(pending.length, "change")} to review`
    : suggestions
      ? `Greenfields: ${plural(suggestions, "suggested project")} to review`
      : `Greenfields: ${plural(problems, "problem")} to check`;
  return { subject, text: lines.join("\n") };
}

// At most one digest per calendar day in `tz`; the day is recorded only after a successful send.
export async function maybeSendDigest(
  db: DatabaseSync,
  mailer: Mailer,
  nowIso: string,
  tz: string,
  to: string,
): Promise<"sent" | "nothing" | "already-sent"> {
  const today = new Date(nowIso).toLocaleDateString("en-CA", { timeZone: tz });
  const last = (db.prepare("SELECT value FROM meta WHERE key = ?").get(DIGEST_KEY) as { value: string } | undefined)?.value;
  if (last === today) return "already-sent";
  const digest = buildDigest(db, nowIso, tz);
  if (!digest) return "nothing";
  await mailer({ to, ...digest });
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    DIGEST_KEY, today,
  );
  return "sent";
}
