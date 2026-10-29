import { STAGE_LABELS, STAGE_ORDER, type StageCategory } from "../../src/domain/stage.ts";
import type { PublicData, PublicProject } from "../../src/publish/publicTypes.ts";
import { toCsv } from "./csv.ts";
import { renderDetail, renderFacet, renderHeader, renderRows, stageOptions } from "./render.ts";
import { applyQuery, distinctValues, latestReportSlugs, type SortKey, type TableQuery } from "./tableState.ts";

const RECENT_DAYS = 7;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const query: TableQuery = {
  search: "", minerals: [], regions: [], stages: [], hideEarlyExploration: false, sortKey: "name", sortDir: "asc",
};
let data: PublicData = { generatedAt: new Date().toISOString(), projects: [] };
let visible: PublicProject[] = [];

function render(): void {
  visible = applyQuery(data.projects, query);
  renderHeader($<HTMLTableElement>("projects").tHead!.rows[0], query, onSort);
  const latest = latestReportSlugs(data.projects);
  renderRows($<HTMLTableElement>("projects").tBodies[0], visible, new Date().toISOString(), RECENT_DAYS, latest, openDetail);
  $("count").textContent = `Showing ${visible.length} of ${data.projects.length} projects`;
}

function onSort(key: SortKey): void {
  query.sortDir = query.sortKey === key && query.sortDir === "asc" ? "desc" : "asc";
  query.sortKey = key;
  render();
}

function openDetail(p: PublicProject): void {
  const dialog = $<HTMLDialogElement>("detail");
  renderDetail(dialog.querySelector(".detail-body")!, p);
  dialog.showModal();
}

function download(): void {
  const blob = new Blob([toCsv(visible)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `chile-greenfield-projects-${data.generatedAt.slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function wireControls(): void {
  const { minerals, regions } = distinctValues(data.projects);
  const opts = (values: string[]) => values.map((value) => ({ value, label: value }));
  renderFacet($("facet-minerals"), opts(minerals), query.minerals, (v) => { query.minerals = v; render(); });
  renderFacet($("facet-regions"), opts(regions), query.regions, (v) => { query.regions = v; render(); });
  renderFacet($("facet-stages"), stageOptions(STAGE_LABELS, STAGE_ORDER), query.stages, (v) => {
    query.stages = v as StageCategory[];
    render();
  });
  $<HTMLInputElement>("search").addEventListener("input", (e) => {
    query.search = (e.target as HTMLInputElement).value;
    render();
  });
  $<HTMLInputElement>("hide-exploration").addEventListener("change", (e) => {
    query.hideEarlyExploration = (e.target as HTMLInputElement).checked;
    render();
  });
  $("download").addEventListener("click", download);
  $("filters-toggle").addEventListener("click", (e) => {
    const open = $("filters").classList.toggle("open");
    (e.currentTarget as HTMLElement).setAttribute("aria-expanded", String(open));
  });
  // Close an open facet dropdown when clicking elsewhere.
  document.addEventListener("click", (e) => {
    for (const d of document.querySelectorAll<HTMLDetailsElement>("details.facet[open]")) {
      if (!d.contains(e.target as Node)) d.open = false;
    }
  });
}

async function main(): Promise<void> {
  try {
    const res = await fetch("projects.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = (await res.json()) as PublicData;
  } catch {
    $("updated").textContent = "The project data could not be loaded. Please try again later.";
  }
  wireControls();
  render();
}

void main();
