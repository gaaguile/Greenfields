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

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field as FieldKey] ?? field;
}
