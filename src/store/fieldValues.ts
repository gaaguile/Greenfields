import type { DatabaseSync } from "node:sqlite";
import type { Basis, DecidedBy, FieldStatus, FieldValueRow, NewFieldValue } from "../domain/types.ts";

export function insertFieldValue(db: DatabaseSync, v: NewFieldValue): number {
  const result = db
    .prepare(
      `INSERT INTO field_values (project_id, field, value_text, value_num, unit, basis, attributable_share,
         figure_date, document_id, quote, confidence, status, decided_by, hold_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      v.projectId, v.field, v.valueText, v.valueNum ?? null, v.unit ?? null, v.basis ?? "100%",
      v.attributableShare ?? null, v.figureDate ?? null, v.documentId ?? null, v.quote ?? null,
      v.confidence ?? null, v.status, v.decidedBy ?? null, v.holdReason ?? null,
    );
  return Number(result.lastInsertRowid);
}

// Uses a savepoint so it also works inside a caller's transaction (e.g. the import).
export function publishFieldValue(
  db: DatabaseSync,
  id: number,
  decidedBy: DecidedBy,
  decidedAt: string = new Date().toISOString(),
): void {
  const row = db.prepare("SELECT project_id, field FROM field_values WHERE id = ?").get(id) as
    | { project_id: number; field: string }
    | undefined;
  if (!row) throw new Error(`field value ${id} not found`);
  db.exec("SAVEPOINT publish_field_value");
  try {
    db.prepare(
      "UPDATE field_values SET status = 'superseded' WHERE project_id = ? AND field = ? AND status = 'published' AND id != ?",
    ).run(row.project_id, row.field, id);
    db.prepare("UPDATE field_values SET status = 'published', decided_by = ?, decided_at = ? WHERE id = ?").run(
      decidedBy, decidedAt, id,
    );
    db.exec("RELEASE publish_field_value");
  } catch (err) {
    db.exec("ROLLBACK TO publish_field_value");
    db.exec("RELEASE publish_field_value");
    throw err;
  }
}

interface FieldValueDbRow {
  id: number; project_id: number; field: string; value_text: string; value_num: number | null; unit: string | null;
  basis: string; attributable_share: number | null; figure_date: string | null; document_id: number | null;
  quote: string | null; confidence: number | null; status: string; decided_by: string | null; created_at: string;
  decided_at: string | null; hold_reason: string | null;
}

function toRow(r: FieldValueDbRow): FieldValueRow {
  return {
    id: r.id,
    projectId: r.project_id,
    field: r.field,
    valueText: r.value_text,
    valueNum: r.value_num,
    unit: r.unit,
    basis: r.basis as Basis,
    attributableShare: r.attributable_share,
    figureDate: r.figure_date,
    documentId: r.document_id,
    quote: r.quote,
    confidence: r.confidence,
    status: r.status as FieldStatus,
    decidedBy: r.decided_by as DecidedBy | null,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
    holdReason: r.hold_reason,
  };
}

export function getPublished(db: DatabaseSync, projectId: number): FieldValueRow[] {
  const rows = db
    .prepare("SELECT * FROM field_values WHERE project_id = ? AND status = 'published' ORDER BY field")
    .all(projectId) as unknown as FieldValueDbRow[];
  return rows.map(toRow);
}

// Published and superseded values, newest decision first (ties broken by id so order is stable).
export function getHistory(db: DatabaseSync, projectId: number, sinceIso?: string): FieldValueRow[] {
  const rows = db
    .prepare(
      `SELECT * FROM field_values WHERE project_id = ? AND status IN ('published', 'superseded')
         AND (? IS NULL OR decided_at >= ?) ORDER BY decided_at DESC, id DESC`,
    )
    .all(projectId, sinceIso ?? null, sinceIso ?? null) as unknown as FieldValueDbRow[];
  return rows.map(toRow);
}
