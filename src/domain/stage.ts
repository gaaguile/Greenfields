export type StageCategory =
  | "exploration"
  | "advanced_exploration"
  | "scoping_pea"
  | "pfs"
  | "fs"
  | "permitting"
  | "construction";

export const STAGE_ORDER: StageCategory[] = [
  "exploration",
  "advanced_exploration",
  "scoping_pea",
  "pfs",
  "fs",
  "permitting",
  "construction",
];

export const STAGE_LABELS: Record<StageCategory, string> = {
  exploration: "Exploration",
  advanced_exploration: "Advanced exploration",
  scoping_pea: "Scoping/PEA",
  pfs: "PFS",
  fs: "FS",
  permitting: "Permitting (EIA/SEIA)",
  construction: "Construction decision / construction",
};

// Ordered rules: the first match wins.
export function normalizeStage(text: string): { stage: StageCategory; stalled: boolean } {
  const stalled = /stalled/i.test(text);
  const withoutNegatedConstruction = text.replace(/pre-construction|construction decision/gi, "");
  let stage: StageCategory;
  if (/\bconstruction\b/i.test(withoutNegatedConstruction)) stage = "construction";
  else if (/permitting|\bRCA\b|environmentally approved/i.test(text) && !/early permitting/i.test(text)) stage = "permitting";
  else if (/(?<!pre-?)\bfeasibility\b/i.test(text)) stage = "fs";
  else if (/pre-?feasibility|\bPFS\b/i.test(text)) stage = "pfs";
  else if (/\bPEA\b|scoping|preliminary economic/i.test(text)) stage = "scoping_pea";
  else if (/resource definition|advanced exploration/i.test(text)) stage = "advanced_exploration";
  else stage = "exploration";
  return { stage, stalled };
}
