import type { StageCategory } from "./stage.ts";

export type FieldStatus = "published" | "pending" | "rejected" | "superseded";
export type Basis = "100%" | "attributable";
export type DecidedBy = "auto" | "owner";

export interface NewProject {
  slug: string;
  name: string;
  owners: string;
  minerals: string[];
  region: string;
  province?: string | null;
  locationDetail?: string | null;
  stage: StageCategory;
  stageText: string;
  stalled: boolean;
}

export interface ProjectRow {
  id: number;
  slug: string;
  name: string;
  aliases: string[];
  owners: string;
  minerals: string[];
  region: string;
  province: string | null;
  locationDetail: string | null;
  stage: StageCategory;
  stageText: string;
  stalled: boolean;
  tracking: "active" | "paused";
  createdAt: string;
  updatedAt: string;
}

export interface NewFieldValue {
  projectId: number;
  field: string;
  valueText: string;
  valueNum?: number | null;
  unit?: string | null;
  basis?: Basis;
  attributableShare?: number | null;
  figureDate?: string | null;
  documentId?: number | null;
  quote?: string | null;
  confidence?: number | null;
  status: FieldStatus;
  decidedBy?: DecidedBy | null;
  holdReason?: string | null;
}

export interface FieldValueRow {
  id: number;
  projectId: number;
  field: string;
  valueText: string;
  valueNum: number | null;
  unit: string | null;
  basis: Basis;
  attributableShare: number | null;
  figureDate: string | null;
  documentId: number | null;
  quote: string | null;
  confidence: number | null;
  status: FieldStatus;
  decidedBy: DecidedBy | null;
  createdAt: string;
  decidedAt: string | null;
  holdReason: string | null;
}

export type DocumentStatus = "found" | "read" | "triaged" | "extracted" | "done" | "failed" | "skipped";
