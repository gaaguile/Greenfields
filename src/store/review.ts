import type { DatabaseSync } from "node:sqlite";
import { fieldLabel } from "../domain/fields.ts";
import { parseMinerals } from "../domain/minerals.ts";
import { normalizeStage } from "../domain/stage.ts";
import { insertFieldValue, publishFieldValue } from "./fieldValues.ts";

// Owner decisions from the review page. History stays append-only: values are never rewritten in place.

const PROJECT_FIELDS = new Set(["stage", "owners", "minerals"]);
const PROJECT_LABELS: Record<string, string> = { stage: "Stage", owners: "Owners", minerals: "Minerals" };

export const reviewLabel = (field: string) => PROJECT_LABELS[field] ?? fieldLabel(field);

function inTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// Stage, owners and minerals are shown from the project row, so a decision on them updates it too.
export function applyProjectField(db: DatabaseSync, projectId: number, field: string, valueText: string, at: string): void {
  if (field === "stage") {
    const { stage, stalled } = normalizeStage(valueText);
    db.prepare("UPDATE projects SET stage = ?, stalled = ?, stage_text = ?, updated_at = ? WHERE id = ?").run(
      stage, stalled ? 1 : 0, valueText, at, projectId,
    );
  } else if (field === "owners") {
    db.prepare("UPDATE projects SET owners = ?, updated_at = ? WHERE id = ?").run(valueText, at, projectId);
  } else if (field === "minerals") {
    db.prepare("UPDATE projects SET minerals = ?, updated_at = ? WHERE id = ?").run(
      JSON.stringify(parseMinerals(valueText)), at, projectId,
    );
  }
}

interface FieldValueDb {
  id: number; project_id: number; field: string; value_text: string; value_num: number | null; unit: string | null;
  basis: string; attributable_share: number | null; figure_date: string | null; document_id: number | null;
  quote: string | null; confidence: number | null; status: string; created_at: string;
}

function pendingRow(db: DatabaseSync, id: number): FieldValueDb {
  const row = db.prepare("SELECT * FROM field_values WHERE id = ?").get(id) as FieldValueDb | undefined;
  if (!row || row.status !== "pending") throw new Error(`field value ${id} is not pending`);
  return row;
}

// Publishes as the owner, and updates the project row for stage, owners and minerals.
export function publishByOwner(db: DatabaseSync, id: number, at: string): void {
  const row = db.prepare("SELECT project_id, field, value_text FROM field_values WHERE id = ?").get(id) as
    { project_id: number; field: string; value_text: string };
  publishFieldValue(db, id, "owner", at);
  if (PROJECT_FIELDS.has(row.field)) applyProjectField(db, row.project_id, row.field, row.value_text, at);
}

export interface PendingItem {
  id: number;
  projectId: number;
  projectName: string;
  projectSlug: string;
  field: string;
  label: string;
  proposed: string;
  current: string | null;
  currentDecidedAt: string | null;
  holdReason: string | null;
  quote: string | null;
  confidence: number | null;
  figureDate: string | null;
  documentUrl: string | null;
  documentTitle: string | null;
  createdAt: string;
  newerPublished: boolean;
}

export function listPending(db: DatabaseSync): PendingItem[] {
  const rows = db.prepare(
    `SELECT v.*, p.name AS project_name, p.slug AS project_slug, p.stage_text, p.owners AS project_owners,
       p.minerals AS project_minerals, d.url AS doc_url, d.title AS doc_title,
       c.value_text AS current_text, c.decided_at AS current_decided_at, v.hold_reason
     FROM field_values v
     JOIN projects p ON p.id = v.project_id
     LEFT JOIN documents d ON d.id = v.document_id
     LEFT JOIN field_values c ON c.project_id = v.project_id AND c.field = v.field AND c.status = 'published'
     WHERE v.status = 'pending'
     ORDER BY p.name, v.created_at, v.id`,
  ).all() as (FieldValueDb & Record<string, string | null>)[];
  return rows.map((r) => {
    let current = r.current_text;
    if (current === null && r.field === "stage") current = r.stage_text;
    if (current === null && r.field === "owners") current = r.project_owners;
    if (current === null && r.field === "minerals") current = (JSON.parse(r.project_minerals ?? "[]") as string[]).join(", ");
    return {
      id: r.id,
      projectId: r.project_id,
      projectName: r.project_name!,
      projectSlug: r.project_slug!,
      field: r.field,
      label: reviewLabel(r.field),
      proposed: r.value_text,
      current,
      currentDecidedAt: r.current_decided_at,
      holdReason: r.hold_reason,
      quote: r.quote,
      confidence: r.confidence,
      figureDate: r.figure_date,
      documentUrl: r.doc_url,
      documentTitle: r.doc_title,
      createdAt: r.created_at,
      newerPublished: !!r.current_decided_at && r.current_decided_at > r.created_at,
    };
  });
}

export function approvePending(db: DatabaseSync, id: number, at: string): void {
  inTransaction(db, () => {
    pendingRow(db, id);
    publishByOwner(db, id, at);
  });
}

// Publishes a corrected copy (same source and quote) and keeps the original unchanged, marked rejected.
export function editAndApprove(
  db: DatabaseSync,
  id: number,
  edit: { valueText: string; valueNum: number | null },
  at: string,
): number {
  return inTransaction(db, () => {
    const r = pendingRow(db, id);
    const newId = insertFieldValue(db, {
      projectId: r.project_id, field: r.field, valueText: edit.valueText, valueNum: edit.valueNum, unit: r.unit,
      basis: r.basis as "100%" | "attributable", attributableShare: r.attributable_share, figureDate: r.figure_date,
      documentId: r.document_id, quote: r.quote, confidence: r.confidence, status: "pending",
    });
    db.prepare("UPDATE field_values SET status = 'rejected', decided_by = 'owner', decided_at = ? WHERE id = ?").run(at, id);
    publishByOwner(db, newId, at);
    return newId;
  });
}

export function rejectPending(db: DatabaseSync, id: number, at: string): void {
  inTransaction(db, () => {
    pendingRow(db, id);
    db.prepare("UPDATE field_values SET status = 'rejected', decided_by = 'owner', decided_at = ? WHERE id = ?").run(at, id);
  });
}
