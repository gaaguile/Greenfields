import type { DatabaseSync } from "node:sqlite";
import { QuotaExceededError, type ModelProvider } from "../ai/provider.ts";
import type { AppConfig } from "../config.ts";
import type { Logger } from "../log.ts";
import { waitForQuietGpu, type GpuProbe } from "../schedule/gamingGuard.ts";
import { publish, type Deployer } from "../publish/publisher.ts";
import { readFoundDocuments } from "../read/reader.ts";
import { listDocumentsByStatus, setDocumentStatus } from "../store/documents.ts";
import { getPublished } from "../store/fieldValues.ts";
import { listProjects } from "../store/projects.ts";
import { finishRun, startRun, type RunTrigger } from "../store/runs.ts";
import { listSources } from "../store/sources.ts";
import type { Fetcher } from "../watch/fetcher.ts";
import { watchSources, type Renderer } from "../watch/watcher.ts";
import { extractFigures } from "./extract.ts";
import { applyFigures, type SourcedFigure } from "./rules.ts";
import { triageReadDocuments, type TriageResult } from "./triage.ts";

export interface PipelineDeps {
  fetcher: Fetcher;
  providers: { triage: ModelProvider; extract: ModelProvider };
  deploy: Deployer | null;
  render?: Renderer;
  // Set when triage runs on the local GPU: wait while it is busy, or switch to `fallback`.
  gamingGuard?: { probe: GpuProbe; sleep: (ms: number) => Promise<void>; deadline: Date; fallback: ModelProvider };
  log: Logger;
  now: () => Date;
}

export interface RunCounts {
  checked: number;
  newDocuments: number;
  read: number;
  triaged: number;
  extracted: number;
  published: number;
  held: number;
  failed: number;
}

export interface RunSummary {
  runId: number;
  counts: RunCounts;
  errors: string[];
  deployed: boolean;
}

// Extracts every triaged document, then applies each project's figures together so that disagreeing
// documents in one run are caught. A document stays `extracted` until its figures are applied, so a crash
// in between makes the next run extract it again; re-applying equal values is a no-op.
async function extractStage(
  db: DatabaseSync,
  cfg: AppConfig,
  deps: PipelineDeps,
  counts: RunCounts,
): Promise<void> {
  const projects = new Map(listProjects(db).map((p) => [p.id, p]));
  const byProject = new Map<number, { figs: SourcedFigure[]; docIds: number[] }>();
  for (const doc of listDocumentsByStatus(db, ["triaged", "extracted"])) {
    const project = doc.projectId === null ? undefined : projects.get(doc.projectId);
    if (!project) {
      setDocumentStatus(db, doc.id, "done");
      continue;
    }
    try {
      const figs = await extractFigures(
        deps.providers.extract,
        { title: doc.title, text: doc.text ?? "" },
        project,
        getPublished(db, project.id),
        cfg.pipeline.maxDocChars,
        deps.log,
      );
      const triage = doc.triage ? (JSON.parse(doc.triage) as TriageResult) : null;
      const entry = byProject.get(project.id) ?? { figs: [], docIds: [] };
      entry.figs.push(...figs.map((f) => ({ ...f, documentId: doc.id, material: triage?.material ?? false })));
      entry.docIds.push(doc.id);
      byProject.set(project.id, entry);
      setDocumentStatus(db, doc.id, "extracted");
      counts.extracted++;
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        deps.log.warn("extraction quota used up; remaining documents wait for the next run", { error: err.message });
        break;
      }
      const e = err as Error;
      setDocumentStatus(db, doc.id, "failed", { error: `${e.name}: ${e.message}` });
      deps.log.warn("extraction failed", { url: doc.url, error: e.message });
      counts.failed++;
    }
  }
  const decidedAt = deps.now().toISOString();
  for (const [projectId, { figs, docIds }] of byProject) {
    const r = applyFigures(db, projectId, figs, {
      minConfidence: cfg.pipeline.autoPublishConfidence,
      numericThreshold: cfg.pipeline.numericChangeThreshold,
    }, decidedAt);
    counts.published += r.published;
    counts.held += r.held;
    for (const id of docIds) setDocumentStatus(db, id, "done");
  }
}

export async function runPipeline(
  db: DatabaseSync,
  cfg: AppConfig,
  deps: PipelineDeps,
  opts: { trigger: RunTrigger; dryRun?: boolean },
): Promise<RunSummary> {
  const { log } = deps;
  const runId = startRun(db, opts.trigger, deps.now().toISOString());
  const counts: RunCounts = { checked: 0, newDocuments: 0, read: 0, triaged: 0, extracted: 0, published: 0, held: 0, failed: 0 };
  const errors: string[] = [];
  let deployed = false;
  let postponed = false;
  log.info("run started", { runId, trigger: opts.trigger, dryRun: !!opts.dryRun });

  // Each stage also picks up documents an earlier run left in its input status.
  const stage = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      errors.push(`${name}: ${(err as Error).message}`);
      log.error(`${name} stage failed`, { error: (err as Error).message });
    }
  };

  await stage("watch", async () => {
    const r = await watchSources(db, deps.fetcher, listSources(db, { activeOnly: true }), log, deps.now().toISOString(), {
      render: deps.render,
    });
    counts.checked = r.checked;
    counts.newDocuments = r.newDocuments;
  });
  await stage("read", async () => {
    const r = await readFoundDocuments(db, deps.fetcher, log);
    counts.read = r.read;
    counts.failed += r.failed;
  });
  await stage("triage", async () => {
    let triage = deps.providers.triage;
    const guard = deps.gamingGuard;
    if (guard && listDocumentsByStatus(db, ["read"]).length) {
      const g = await waitForQuietGpu(guard.probe, cfg.pipeline.gamingGuard, {
        sleep: guard.sleep, now: deps.now, deadline: guard.deadline, log,
      });
      postponed = g.postponed;
      if (g.useFallback) triage = guard.fallback;
    }
    const r = await triageReadDocuments(db, triage, log, { maxChars: cfg.pipeline.maxDocChars });
    counts.triaged = r.triaged;
    counts.failed += r.failed;
  });
  await stage("extract", () => extractStage(db, cfg, deps, counts));
  if (!opts.dryRun && deps.deploy) {
    await stage("publish", async () => {
      deployed = (await publish(db, cfg, deps.deploy!, { nowIso: deps.now().toISOString() })).deployed;
    });
  }

  finishRun(db, runId, { counts, errors, postponed, published: deployed, at: deps.now().toISOString() });
  log.info("run finished", { runId, ...counts, deployed, errors: errors.length });
  return { runId, counts, errors, deployed };
}
