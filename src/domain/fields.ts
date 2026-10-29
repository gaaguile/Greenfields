export type FieldKey =
  | "capex_usd"
  | "mine_life_years"
  | "resource_headline"
  | "reserve_headline"
  | "annual_production"
  | "grade"
  | "c1_cost"
  | "throughput_tpd"
  | "additional_info";

export const FIELD_LABELS: Record<FieldKey, string> = {
  capex_usd: "Capex (US$)",
  mine_life_years: "Mine life",
  resource_headline: "Resource",
  reserve_headline: "Reserve",
  annual_production: "Annual production",
  grade: "Grade",
  c1_cost: "C1 cash cost",
  throughput_tpd: "Throughput (tpd)",
  additional_info: "Additional info",
};

// Stage, owners and minerals live on the project row; owner-approved changes to them are also field values.
export const PROJECT_FIELD_LABELS: Record<string, string> = { stage: "Stage", owners: "Owners", minerals: "Minerals" };

export const isProjectField = (field: string) => field in PROJECT_FIELD_LABELS;

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field as FieldKey] ?? PROJECT_FIELD_LABELS[field] ?? field;
}
