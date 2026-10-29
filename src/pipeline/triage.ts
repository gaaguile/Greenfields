import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { ModelProvider } from "../ai/provider.ts";
import type { ProjectRow } from "../domain/types.ts";
import type { Logger } from "../log.ts";
import { listDocumentsByStatus, recordTransientFailure, setDocumentStatus } from "../store/documents.ts";
import { listProjects } from "../store/projects.ts";
import { isTransient } from "./errors.ts";
import { askJson } from "./modelJson.ts";
import { TRIAGE_SCHEMA_HINT, documentMessage, triageSystem } from "./prompts.ts";

const TRIAGE_MAX_CHARS = 8000;

export const triageSchema = z.object({
  projectSlug: z.string().nullable(),
  category: z.enum(["study", "resource", "drilling", "permit", "ownership", "financing", "routine"]),
  material: z.boolean(),
  possibleNewProject: z.boolean(),
  reason: z.string(),
});

export type TriageResult = z.infer<typeof triageSchema>;

export async function triageDocument(
  provider: ModelProvider,
  doc: { title: string | null; text: string },
  candidates: ProjectRow[],
  maxChars: number,
): Promise<TriageResult> {
  const result = await askJson(provider, triageSchema, {
    system: triageSystem(candidates),
    user: documentMessage(doc, Math.min(maxChars, TRIAGE_MAX_CHARS)),
    schemaHint: TRIAGE_SCHEMA_HINT,
  });
  // A slug outside the candidate list is a guess, not a match.
  if (result.projectSlug && !candidates.some((c) => c.slug === result.projectSlug)) {
    return { ...result, projectSlug: null };
  }
  return result;
}

export async function triageReadDocuments(
  db: DatabaseSync,
  provider: ModelProvider,
  log: Logger,
  opts: { maxChars: number },
): Promise<{ triaged: number; routine: number; failed: number }> {
  const active = listProjects(db, { tracking: "active" });
  let triaged = 0;
  let routine = 0;
  let failed = 0;
  // One at a time: the local GPU runs a single model.
  const sourceKind = db.prepare("SELECT kind FROM sources WHERE id = ?");
  for (const doc of listDocumentsByStatus(db, ["read"])) {
    // Press-release feeds cover the whole world; a release that never mentions Chile isn't worth a model call.
    const kind = doc.sourceId === null ? undefined : (sourceKind.get(doc.sourceId) as { kind: string } | undefined)?.kind;
    if (kind === "newswire" && !/\bchile/i.test(`${doc.title ?? ""} ${doc.text ?? ""}`)) {
      setDocumentStatus(db, doc.id, "done", { triage: JSON.stringify({ skipped: "no mention of Chile" }) });
      routine++;
      continue;
    }
    const own = active.filter((p) => p.id === doc.projectId);
    const candidates = own.length ? own : active;
    try {
      const result = await triageDocument(provider, { title: doc.title, text: doc.text ?? "" }, candidates, opts.maxChars);
      const project = candidates.find((c) => c.slug === result.projectSlug) ?? null;
      if (result.projectSlug === null && doc.projectId !== null) {
        log.info("triage found no tracked project", { url: doc.url, reason: result.reason });
      }
      const goOn = result.material && result.category !== "routine" && project !== null;
      // A possible new project that matched nothing tracked goes to discovery.
      const candidate = !project && result.possibleNewProject;
      setDocumentStatus(db, doc.id, goOn ? "triaged" : candidate ? "candidate" : "done", {
        triage: JSON.stringify(result),
        projectId: project?.id ?? null,
      });
      if (goOn) triaged++;
      else routine++;
    } catch (err) {
      const e = err as Error;
      if (isTransient(e) && recordTransientFailure(db, doc.id, e.message) === "retry") {
        log.warn("triage failed; will retry next run", { url: doc.url, error: e.message });
        continue;
      }
      setDocumentStatus(db, doc.id, "failed", { error: `${e.name}: ${e.message}` });
      log.warn("triage failed", { url: doc.url, error: e.message });
      failed++;
    }
  }
  return { triaged, routine, failed };
}
