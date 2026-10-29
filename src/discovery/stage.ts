import type { DatabaseSync } from "node:sqlite";
import { QuotaExceededError, type ModelProvider } from "../ai/provider.ts";
import type { Logger } from "../log.ts";
import { extractCandidate } from "../pipeline/candidate.ts";
import { isTransient } from "../pipeline/errors.ts";
import { listDocumentsByStatus, recordTransientFailure, setDocumentStatus } from "../store/documents.ts";
import { addDocumentToSuggestion, createSuggestion } from "../store/suggestions.ts";
import { matchCandidate } from "./match.ts";

// Turns `candidate` documents into suggestions for the owner. Never creates a project or publishes anything.
export async function runDiscovery(
  db: DatabaseSync,
  provider: ModelProvider,
  log: Logger,
  opts: { maxChars: number; now: () => Date },
): Promise<{ suggested: number; attached: number; routed: number; dropped: number; failed: number }> {
  const counts = { suggested: 0, attached: 0, routed: 0, dropped: 0, failed: 0 };
  for (const doc of listDocumentsByStatus(db, ["candidate"])) {
    try {
      const c = await extractCandidate(provider, { title: doc.title, text: doc.text ?? "" }, opts.maxChars, log);
      if (!c) {
        setDocumentStatus(db, doc.id, "done");
        counts.dropped++;
        continue;
      }
      const m = matchCandidate(db, c);
      if (m.kind === "tracked") {
        const tracking = (db.prepare("SELECT tracking FROM projects WHERE id = ?").get(m.projectId) as { tracking: string }).tracking;
        if (tracking === "paused") {
          setDocumentStatus(db, doc.id, "done", { projectId: m.projectId });
          log.info("candidate matched a paused project; not followed", { url: doc.url, name: c.name });
          continue;
        }
        // News about a project we already follow: its figures are extracted for that project next run, and held,
        // because triage did not recognise the project and the match is by name.
        const triage = doc.triage ? JSON.parse(doc.triage) : {};
        setDocumentStatus(db, doc.id, "triaged", {
          projectId: m.projectId, triage: JSON.stringify({ ...triage, routedByDiscovery: true }),
        });
        counts.routed++;
        log.info("candidate matched a tracked project", { url: doc.url, name: c.name, projectId: m.projectId });
      } else if (m.kind === "pending" || m.kind === "rejected") {
        addDocumentToSuggestion(db, m.suggestionId, doc.id);
        setDocumentStatus(db, doc.id, "done");
        counts.attached++;
      } else {
        createSuggestion(db, c, doc.id, m.possibleDuplicateOf, opts.now().toISOString());
        setDocumentStatus(db, doc.id, "done");
        counts.suggested++;
        log.info("new project suggested", { name: c.name, company: c.company });
      }
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        log.warn("discovery quota used up; remaining candidates wait for the next run", { error: err.message });
        break;
      }
      const e = err as Error;
      if (isTransient(e) && recordTransientFailure(db, doc.id, e.message) === "retry") continue;
      setDocumentStatus(db, doc.id, "failed", { error: `${e.name}: ${e.message}` });
      log.warn("discovery failed", { url: doc.url, error: e.message });
      counts.failed++;
    }
  }
  return counts;
}
