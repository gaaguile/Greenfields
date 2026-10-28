import { STAGE_ORDER, type StageCategory } from "../../src/domain/stage.ts";
import type { PublicProject } from "../../src/publish/publicTypes.ts";

export type SortKey =
  | "name"
  | "owners"
  | "minerals"
  | "region"
  | "stage"
  | "capex"
  | "mineLife"
  | "resourceReserve"
  | "additionalInfo"
  | "lastUpdated";

export interface TableQuery {
  search: string;
  minerals: string[];
  regions: string[];
  stages: StageCategory[];
  hideEarlyExploration: boolean;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
}

export function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function firstNumber(text: string): number | null {
  const m = text.replace(/,/g, "").match(/\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

// Capex in US$ millions, so "US$235 million" < "US$2.4-2.8 billion".
function capexMillions(text: string | null): number | null {
  if (!text) return null;
  const n = firstNumber(text);
  if (n === null) return null;
  return /billion/i.test(text) ? n * 1000 : n;
}

function sortValue(p: PublicProject, key: SortKey): string | number | null {
  switch (key) {
    case "capex":
      return capexMillions(p.capex);
    case "mineLife":
      return p.mineLife ? firstNumber(p.mineLife) : null;
    case "stage":
      return STAGE_ORDER.indexOf(p.stage);
    case "minerals":
      return p.mineralsText ? fold(p.mineralsText) : null;
    default: {
      const value = p[key];
      return value ? fold(value) : null;
    }
  }
}

// Spaces are ignored so "nueva union" finds "NuevaUnión".
function matchesSearch(p: PublicProject, needle: string): boolean {
  const haystack = fold([p.name, p.owners, p.additionalInfo ?? ""].join(" ")).replace(/\s+/g, "");
  return haystack.includes(needle);
}

export function applyQuery(projects: PublicProject[], q: TableQuery): PublicProject[] {
  const needle = fold(q.search).replace(/\s+/g, "");
  const filtered = projects.filter(
    (p) =>
      (!needle || matchesSearch(p, needle)) &&
      (q.minerals.length === 0 || p.minerals.some((m) => q.minerals.includes(m))) &&
      (q.regions.length === 0 || q.regions.includes(p.region)) &&
      (q.stages.length === 0 || q.stages.includes(p.stage)) &&
      !(q.hideEarlyExploration && p.stage === "exploration"),
  );
  const dir = q.sortDir === "asc" ? 1 : -1;
  return filtered.sort((a, b) => {
    const va = sortValue(a, q.sortKey);
    const vb = sortValue(b, q.sortKey);
    if (va === null || vb === null) {
      if (va === vb) return 0;
      return va === null ? 1 : -1; // missing values last in both directions
    }
    if (va < vb) return -dir;
    if (va > vb) return dir;
    return 0;
  });
}

export function isRecentlyUpdated(p: PublicProject, nowIso: string, days: number): boolean {
  return Date.parse(nowIso) - Date.parse(p.lastUpdated) <= days * 86_400_000;
}

export function distinctValues(projects: PublicProject[]): { minerals: string[]; regions: string[] } {
  const sorted = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b));
  return {
    minerals: sorted(projects.flatMap((p) => p.minerals)),
    regions: sorted(projects.map((p) => p.region)),
  };
}
