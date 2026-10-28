import type { DatabaseSync } from "node:sqlite";
import { FIELD_LABELS, fieldLabel } from "../domain/fields.ts";
import { mineralSymbol } from "../domain/minerals.ts";
import { STAGE_LABELS } from "../domain/stage.ts";
import type { FieldValueRow, ProjectRow } from "../domain/types.ts";
import { getDocumentUrl } from "../store/documents.ts";
import { getHistory, getPublished } from "../store/fieldValues.ts";
import { listProjects } from "../store/projects.ts";
import type { PublicChange, PublicData, PublicFigure, PublicProject } from "./publicTypes.ts";

const MAX_RECENT_CHANGES = 10;

function toFigure(db: DatabaseSync, v: FieldValueRow): PublicFigure {
  const doc = v.documentId === null ? undefined : getDocumentUrl(db, v.documentId);
  return {
    field: v.field,
    label: fieldLabel(v.field),
    value: v.valueText,
    unit: v.unit,
    basis: v.basis,
    attributableShare: v.attributableShare,
    figureDate: v.figureDate,
    sourceUrl: doc?.url ?? null,
    sourceTitle: doc?.title ?? null,
    quote: v.quote,
    updatedAt: v.decidedAt ?? v.createdAt,
  };
}

// Each published/superseded value decided inside the window, paired with the value it replaced.
function recentChanges(db: DatabaseSync, projectId: number, sinceIso: string): PublicChange[] {
  const history = getHistory(db, projectId);
  const changes: PublicChange[] = [];
  history.forEach((v, i) => {
    if (!v.decidedAt || v.decidedAt < sinceIso) return;
    const previous = history.slice(i + 1).find((h) => h.field === v.field);
    changes.push({
      field: v.field,
      label: fieldLabel(v.field),
      oldValue: previous?.valueText ?? null,
      newValue: v.valueText,
      changedAt: v.decidedAt,
    });
  });
  return changes.slice(0, MAX_RECENT_CHANGES);
}

const FIELD_ORDER = Object.keys(FIELD_LABELS);
const fieldRank = (field: string) => {
  const i = FIELD_ORDER.indexOf(field);
  return i < 0 ? FIELD_ORDER.length - 1 : i; // unknown fields sit just before additional info
};

function toPublicProject(db: DatabaseSync, p: ProjectRow, sinceIso: string): PublicProject {
  const figures = getPublished(db, p.id)
    .map((v) => toFigure(db, v))
    .sort((a, b) => fieldRank(a.field) - fieldRank(b.field));
  const byField = new Map(figures.map((f) => [f.field, f]));
  const latest = figures.reduce<PublicFigure | null>((a, f) => (!a || f.updatedAt > a.updatedAt ? f : a), null);
  return {
    slug: p.slug,
    name: p.name,
    owners: p.owners,
    minerals: [...new Set(p.minerals.map(mineralSymbol))],
    mineralsText: p.minerals.join(", "),
    region: p.region,
    province: p.province,
    locationDetail: p.locationDetail,
    stage: p.stage,
    stageLabel: STAGE_LABELS[p.stage],
    stageText: p.stageText,
    stalled: p.stalled,
    capex: byField.get("capex_usd")?.value ?? null,
    mineLife: byField.get("mine_life_years")?.value ?? null,
    resourceReserve: (byField.get("reserve_headline") ?? byField.get("resource_headline"))?.value ?? null,
    additionalInfo: byField.get("additional_info")?.value ?? null,
    lastUpdated: latest?.updatedAt ?? p.updatedAt,
    sourceUrl: latest?.sourceUrl ?? null,
    figures,
    recentChanges: recentChanges(db, p.id, sinceIso),
  };
}

export function buildPublicData(db: DatabaseSync, nowIso: string, recentChangeDays: number): PublicData {
  const sinceIso = new Date(Date.parse(nowIso) - recentChangeDays * 86_400_000).toISOString();
  return {
    generatedAt: nowIso,
    projects: listProjects(db, { tracking: "active" }).map((p) => toPublicProject(db, p, sinceIso)),
  };
}
