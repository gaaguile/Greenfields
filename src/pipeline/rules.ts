import type { DatabaseSync } from "node:sqlite";
import { parseMinerals } from "../domain/minerals.ts";
import { normalizeStage } from "../domain/stage.ts";
import type { FieldValueRow, ProjectRow } from "../domain/types.ts";
import { getPublished, insertFieldValue, publishFieldValue } from "../store/fieldValues.ts";
import { listProjects } from "../store/projects.ts";
import type { SourceKind } from "../store/sources.ts";
import type { ProposedFigure } from "./extract.ts";

export type Decision = { action: "publish" } | { action: "hold"; reason: string } | { action: "skip"; reason: "unchanged" };

export interface RuleSettings {
  minConfidence: number;
  numericThreshold: number;
}

// sourceKind: the kind of source the document came from; anything but a company's own IR page is secondary.
export type SourcedFigure = ProposedFigure & { documentId: number; material: boolean; sourceKind?: SourceKind | null };

const ALWAYS_HOLD = new Set(["stage", "owners", "minerals"]);

const normText = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

const UNIT_ALIASES: Record<string, string> = {
  "usd": "usd", "us$": "usd", "us dollars": "usd", "$": "usd", "dollars": "usd",
  "years": "years", "year": "years", "yrs": "years", "yr": "years", "y": "years",
  "tpd": "tpd", "t/d": "tpd", "tonnes per day": "tpd", "tons per day": "tpd",
};

// Units written differently ("US$", "USD") compare equal; unknown units only match themselves.
function canonicalUnit(unit: string | null): string | null {
  if (unit === null) return null;
  const u = normText(unit);
  return UNIT_ALIASES[u] ?? u;
}

type Value = Pick<FieldValueRow, "valueText" | "valueNum" | "unit" | "basis">;

function sameValue(fig: Value, cur: Value): boolean {
  if (fig.basis !== cur.basis) return false;
  if (normText(fig.valueText) === normText(cur.valueText)) return true;
  return (
    fig.valueNum !== null && cur.valueNum !== null && fig.valueNum === cur.valueNum &&
    canonicalUnit(fig.unit) === canonicalUnit(cur.unit)
  );
}

export function decide(
  fig: ProposedFigure,
  current: FieldValueRow | undefined,
  ctx: RuleSettings & { material: boolean; conflict: boolean; sourceKind?: SourceKind | null },
): Decision {
  if (current && sameValue(fig, current)) return { action: "skip", reason: "unchanged" };
  if (ALWAYS_HOLD.has(fig.field)) return { action: "hold", reason: "stage/owner/mineral change" };
  // News articles often repeat old or rounded figures; only the company's own releases publish on their own.
  if (ctx.sourceKind && ctx.sourceKind !== "ir_news") return { action: "hold", reason: "secondary source" };
  if (!ctx.material) return { action: "hold", reason: "immaterial document" };
  if (ctx.conflict) return { action: "hold", reason: "conflicting sources" };
  if (fig.confidence < ctx.minConfidence) return { action: "hold", reason: "low confidence" };
  if (!current) return { action: "publish" };
  // An owner's share must not silently replace a 100% figure, nor an old report a newer one.
  if (fig.basis !== current.basis) return { action: "hold", reason: "basis differs" };
  if (current.figureDate && (!fig.figureDate || fig.figureDate < current.figureDate)) {
    return { action: "hold", reason: "older than published" };
  }
  if (fig.valueNum === null || current.valueNum === null) return { action: "hold", reason: "text change" };
  const unit = canonicalUnit(fig.unit);
  if (unit === null || unit !== canonicalUnit(current.unit)) return { action: "hold", reason: "units differ" };
  if (current.valueNum === 0) return { action: "hold", reason: "change beyond ±20%" };
  const change = Math.abs(fig.valueNum - current.valueNum) / Math.abs(current.valueNum);
  if (change > ctx.numericThreshold) return { action: "hold", reason: "change beyond ±20%" };
  return { action: "publish" };
}

// Stage, owners and minerals live on the project row, so they are compared there.
function matchesProject(fig: ProposedFigure, project: ProjectRow): boolean {
  if (fig.field === "stage") return normalizeStage(fig.valueText).stage === project.stage;
  if (fig.field === "owners") return normText(fig.valueText) === normText(project.owners ?? "");
  if (fig.field === "minerals") {
    const proposed = new Set(parseMinerals(fig.valueText));
    return proposed.size === project.minerals.length && project.minerals.every((m) => proposed.has(m));
  }
  return false;
}

// A held value already waiting for review is not added again.
function alreadyPending(db: DatabaseSync, projectId: number, fig: ProposedFigure): boolean {
  const rows = db
    .prepare("SELECT value_text FROM field_values WHERE project_id = ? AND field = ? AND status = 'pending'")
    .all(projectId, fig.field) as { value_text: string }[];
  return rows.some((r) => normText(r.value_text) === normText(fig.valueText));
}

// Fields where the run's figures disagree with each other.
function conflictingFields(figs: SourcedFigure[]): Set<string> {
  const out = new Set<string>();
  for (const a of figs) {
    for (const b of figs) {
      if (a !== b && a.field === b.field && !sameValue(a, b)) out.add(a.field);
    }
  }
  return out;
}

// Takes every figure for one project from the whole run, so disagreements between documents are caught.
export function applyFigures(
  db: DatabaseSync,
  projectId: number,
  figs: SourcedFigure[],
  settings: RuleSettings,
  decidedAt: string,
): { published: number; held: number; skipped: number } {
  const conflicts = conflictingFields(figs);
  const project = listProjects(db).find((p) => p.id === projectId);
  const counts = { published: 0, held: 0, skipped: 0 };
  for (const fig of figs) {
    // Re-read each time: an earlier figure in this batch may have just been published.
    const current = getPublished(db, projectId).find((v) => v.field === fig.field);
    const decision = project && matchesProject(fig, project)
      ? ({ action: "skip", reason: "unchanged" } as const)
      : decide(fig, current, { ...settings, material: fig.material, conflict: conflicts.has(fig.field), sourceKind: fig.sourceKind });
    if (decision.action === "skip" || (decision.action === "hold" && alreadyPending(db, projectId, fig))) {
      counts.skipped++;
      continue;
    }
    const id = insertFieldValue(db, {
      projectId,
      field: fig.field,
      valueText: fig.valueText,
      valueNum: fig.valueNum,
      unit: fig.unit,
      basis: fig.basis,
      attributableShare: fig.attributableShare,
      figureDate: fig.figureDate,
      documentId: fig.documentId,
      quote: fig.quote,
      confidence: fig.confidence,
      status: "pending",
      holdReason: decision.action === "hold" ? decision.reason : null,
    });
    if (decision.action === "publish") {
      publishFieldValue(db, id, "auto", decidedAt);
      counts.published++;
    } else {
      counts.held++;
    }
  }
  return counts;
}
