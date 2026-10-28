import type { DatabaseSync } from "node:sqlite";
import type { FieldKey } from "../domain/fields.ts";
import { normalizeStage } from "../domain/stage.ts";
import type { Basis } from "../domain/types.ts";
import { upsertDocument } from "../store/documents.ts";
import { getPublished, insertFieldValue, publishFieldValue } from "../store/fieldValues.ts";
import { slugify, upsertProject } from "../store/projects.ts";

interface DatasetProject {
  name: string;
  owner: string;
  development_stage: string;
  location: { region: string; province?: string; detail?: string };
  minerals: string[];
  process_type?: string;
  additional_data?: Record<string, string | number>;
  latest_update_source?: string;
}

interface Figure {
  field: FieldKey;
  valueText: string;
  valueNum: number | null;
  unit: string | null;
  basis: Basis;
  attributableShare: number | null;
}

const fmt = (n: number) => n.toLocaleString("en-US");

function firstNumber(value: string | number): number | null {
  if (typeof value === "number") return value;
  const m = value.replace(/,/g, "").match(/\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

// "530-700 (estimates vary)" + "million" → "US$530-700 million (estimates vary)"
function usd(value: string | number, scale: "million" | "billion"): string {
  if (typeof value === "number") return `US$${fmt(value)} ${scale}`;
  const m = value.match(/^([\d.,\s\-–]+)(.*)$/);
  if (!m) return `US$${value}`;
  const rest = m[2].trim();
  if (/^(million|billion)\b/i.test(rest)) return `US$${m[1].trim()} ${rest}`;
  return `US$${m[1].trim()} ${scale}${rest ? ` ${rest}` : ""}`;
}

function usdNum(value: string | number, scale: "million" | "billion"): number | null {
  const n = firstNumber(value);
  if (n === null) return null;
  const textScale = typeof value === "string" ? value.match(/\b(million|billion)\b/i)?.[1].toLowerCase() : undefined;
  return n * ((textScale ?? scale) === "billion" ? 1e9 : 1e6);
}

function fig(field: FieldKey, valueText: string, valueNum: number | null, unit: string | null): Figure {
  return { field, valueText, valueNum, unit, basis: "100%", attributableShare: null };
}

function attributable75(field: FieldKey, value: string | number): Figure {
  return { ...fig(field, `${value} (75% basis)`, null, null), basis: "attributable", attributableShare: 0.75 };
}

const KNOWN: Record<string, (v: string | number) => Figure> = {
  initial_capex_usd: (v) => fig("capex_usd", usd(v, "billion"), usdNum(v, "billion"), "USD"),
  capex_usd_million: (v) => fig("capex_usd", usd(v, "million"), usdNum(v, "million"), "USD"),
  stage_1_capex_usd_billion: (v) => fig("capex_usd", `${usd(v, "billion")} (stage 1)`, usdNum(v, "billion"), "USD"),
  mine_life_years: (v) => fig("mine_life_years", typeof v === "number" ? `${v} years` : String(v), firstNumber(v), "years"),
  daily_processing_capacity_tpd: (v) => fig("throughput_tpd", `${typeof v === "number" ? fmt(v) : v} tpd`, firstNumber(v), "tpd"),
  reserves_p_and_p: (v) => fig("reserve_headline", String(v), null, null),
  reserves_p_and_p_75pct_basis: (v) => attributable75("reserve_headline", v),
  measured_indicated_75pct_basis: (v) => attributable75("resource_headline", v),
  avg_annual_cu_production_first_8yrs_t: (v) =>
    fig("annual_production", `${typeof v === "number" ? fmt(v) : v} t Cu/yr (first 8 years avg)`, firstNumber(v), "t/yr"),
  annual_li2co3_production_tonnes: (v) =>
    fig("annual_production", `${typeof v === "number" ? fmt(v) : v} t Li2CO3/yr`, firstNumber(v), "t/yr"),
  c1_cash_cost_usd_per_lb: (v) => fig("c1_cost", `US$${v}/lb`, firstNumber(v), "USD/lb"),
};

const EXTRA_LABELS: Record<string, (v: string | number) => string> = {
  life_of_project_capex_usd_billion: (v) => `Life-of-project capex: ${usd(v, "billion")}`,
  npv_after_tax_usd_billion: (v) => `NPV (after-tax): ${usd(v, "billion")}`,
  irr_pct: (v) => `IRR: ${v}%`,
  ore_processed_total_tonnes: (v) => `Ore processed (total): ${typeof v === "number" ? fmt(v) : v} t`,
  total_gold_production_oz: (v) => `Total gold production: ${typeof v === "number" ? fmt(v) : v} oz`,
  annual_ore_processing_tonnes: (v) => `Annual ore processing: ${typeof v === "number" ? fmt(v) : v} t`,
};

const titleCase = (key: string) =>
  key.split("_").map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");

function figuresFor(p: DatasetProject): Figure[] {
  const figures: Figure[] = [];
  const extras: string[] = [];
  if (p.process_type) extras.push(`Process: ${p.process_type}`);
  let notes: string | null = null;
  for (const [key, value] of Object.entries(p.additional_data ?? {})) {
    if (key === "notes") notes = String(value);
    else if (KNOWN[key]) figures.push(KNOWN[key](value));
    else extras.push(EXTRA_LABELS[key] ? EXTRA_LABELS[key](value) : `${titleCase(key)}: ${value}`);
  }
  if (notes) extras.push(`Notes: ${notes}`);
  if (extras.length) figures.push(fig("additional_info", extras.join("; "), null, null));
  return figures;
}

export function importDataset(
  db: DatabaseSync,
  dataset: unknown,
  importedAt: string,
): { created: number; updated: number; figures: number } {
  const projects = (dataset as { projects?: DatasetProject[] }).projects;
  if (!Array.isArray(projects)) throw new Error("dataset has no projects array");
  const result = { created: 0, updated: 0, figures: 0 };
  db.exec("BEGIN");
  try {
    for (const p of projects) {
      const { stage, stalled } = normalizeStage(p.development_stage);
      const { id, created } = upsertProject(db, {
        slug: slugify(p.name),
        name: p.name,
        owners: p.owner,
        minerals: p.minerals,
        region: p.location.region,
        province: p.location.province ?? null,
        locationDetail: p.location.detail ?? null,
        stage,
        stageText: p.development_stage,
        stalled,
      });
      if (created) result.created++;
      else result.updated++;

      const documentId = p.latest_update_source
        ? upsertDocument(db, { url: p.latest_update_source, status: "done" })
        : null;
      const already = new Set(getPublished(db, id).map((v) => v.field));
      for (const f of figuresFor(p)) {
        if (already.has(f.field)) continue;
        const fvId = insertFieldValue(db, {
          projectId: id,
          ...f,
          documentId,
          quote: null,
          confidence: 1,
          status: "pending",
        });
        publishFieldValue(db, fvId, "owner", importedAt);
        already.add(f.field);
        result.figures++;
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return result;
}
