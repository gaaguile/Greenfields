import type { StageCategory } from "../../src/domain/stage.ts";
import type { PublicProject } from "../../src/publish/publicTypes.ts";
import { isRecentlyUpdated, type SortKey, type TableQuery } from "./tableState.ts";
import { safeHttpUrl } from "./urls.ts";

const DASH = "—";

// All data goes in through textContent, never innerHTML, so scraped text cannot inject markup.
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; text?: string | null; attrs?: Record<string, string> } = {},
  ...children: (Node | null)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text ?? DASH;
  for (const [k, v] of Object.entries(props.attrs ?? {})) node.setAttribute(k, v);
  for (const child of children) if (child) node.append(child);
  return node;
}

// Non-http(s) URLs (e.g. javascript:) are shown as a dash, never as a link.
function link(url: string, text: string): HTMLElement {
  const href = safeHttpUrl(url);
  if (!href) return el("span", { text: null });
  const a = el("a", { text, attrs: { href, target: "_blank", rel: "noopener noreferrer" } });
  a.addEventListener("click", (e) => e.stopPropagation());
  return a;
}

export function formatNy(iso: string, withTime: boolean): string {
  const opts: Intl.DateTimeFormatOptions = { timeZone: "America/New_York", day: "numeric", month: "short", year: "numeric" };
  if (withTime) Object.assign(opts, { hour: "2-digit", minute: "2-digit", hour12: false });
  return new Intl.DateTimeFormat("en-GB", opts).format(new Date(iso)) + (withTime ? " NY" : "");
}

export const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Project" },
  { key: "owners", label: "Owner(s)" },
  { key: "minerals", label: "Minerals" },
  { key: "region", label: "Region" },
  { key: "stage", label: "Stage" },
  { key: "capex", label: "Capex (US$)" },
  { key: "mineLife", label: "Mine life" },
  { key: "resourceReserve", label: "Resource / reserve" },
  { key: "additionalInfo", label: "Additional info" },
  { key: "latestReport", label: "Latest report" },
];

export function renderHeader(row: HTMLTableRowElement, query: TableQuery, onSort: (key: SortKey) => void): void {
  row.replaceChildren(
    ...COLUMNS.map(({ key, label }) => {
      const th = el("th", { text: label, attrs: { scope: "col", tabindex: "0" } });
      if (query.sortKey === key) th.setAttribute("aria-sort", query.sortDir === "asc" ? "ascending" : "descending");
      th.addEventListener("click", () => onSort(key));
      th.addEventListener("keydown", (e) => { if (e.key === "Enter") onSort(key); });
      return th;
    }),
    el("th", { text: "Source", attrs: { scope: "col" } }),
  );
}

function cell(text: string | null, className = ""): HTMLTableCellElement {
  return el("td", { className: (text ? className : `${className} empty`).trim() }, el("span", { text }));
}

export function renderRows(
  tbody: HTMLTableSectionElement,
  projects: PublicProject[],
  nowIso: string,
  recentDays: number,
  latest: Set<string>,
  onOpen: (p: PublicProject) => void,
): void {
  tbody.replaceChildren(
    ...projects.map((p) => {
      const name = el("td", {}, el("span", { text: p.name }));
      if (isRecentlyUpdated(p, nowIso, recentDays)) name.append(el("span", { className: "badge", text: "Updated" }));
      const stage = el("td", {}, el("span", { text: p.stageLabel }));
      if (p.stalled) stage.append(el("div", { className: "stalled", text: "Stalled" }));
      const tr = el(
        "tr",
        { attrs: { tabindex: "0" }, className: latest.has(p.slug) ? "latest" : undefined },
        name,
        cell(p.owners, "owners"),
        cell(p.minerals.join(", ")),
        cell(p.region),
        stage,
        cell(p.capex),
        cell(p.mineLife),
        cell(p.resourceReserve),
        cell(p.additionalInfo, "info"),
        cell(formatNy(p.latestReport, false)),
        el("td", {}, p.sourceUrl ? link(p.sourceUrl, "Source") : el("span", { text: null })),
      );
      tr.addEventListener("click", () => onOpen(p));
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter") onOpen(p); });
      return tr;
    }),
  );
}

export function renderFacet(
  details: HTMLDetailsElement,
  options: { value: string; label: string }[],
  selected: string[],
  onChange: (selected: string[]) => void,
): void {
  const box = details.querySelector(".options")!;
  details.dataset.active = String(selected.length > 0);
  box.replaceChildren(
    ...options.map(({ value, label }) => {
      const input = el("input", { attrs: { type: "checkbox", value } });
      input.checked = selected.includes(value);
      input.addEventListener("change", () => {
        const values = [...box.querySelectorAll<HTMLInputElement>("input:checked")].map((i) => i.value);
        details.dataset.active = String(values.length > 0);
        onChange(values);
      });
      return el("label", { className: "check" }, input, document.createTextNode(label));
    }),
  );
}

export function renderDetail(container: HTMLElement, p: PublicProject): void {
  const location = [p.region, p.province, p.locationDetail].filter(Boolean).join(" · ");
  const figures = p.figures.map((f) => {
    const sub = [
      f.basis === "attributable" && f.attributableShare !== null
        ? `Attributable share: ${Math.round(f.attributableShare * 100)}%`
        : "100% basis",
      f.figureDate ? `as of ${f.figureDate}` : null,
      `updated ${formatNy(f.updatedAt, false)}`,
    ].filter(Boolean).join(" · ");
    return el(
      "div",
      { className: "figure" },
      el("div", { className: "label", text: f.label }),
      el("div", { text: f.value }),
      el("div", { className: "sub", text: sub }, f.sourceUrl ? document.createTextNode(" · ") : null,
        f.sourceUrl ? link(f.sourceUrl, f.sourceTitle || "Source") : null),
      f.quote ? el("blockquote", { text: f.quote }) : null,
    );
  });
  const changes = p.recentChanges.map((c) =>
    el("li", { text: `${formatNy(c.changedAt, false)} — ${c.label}: ${c.oldValue ?? "(new)"} → ${c.newValue}` }),
  );
  container.replaceChildren(
    el("h2", { text: p.name, attrs: { id: "detail-title" } }),
    el("p", { className: "meta", text: `${p.owners} · ${p.mineralsText}` }),
    el("p", { text: `Stage: ${p.stageText}` }),
    el("p", { text: `Location: ${location || DASH}` }),
    el("h3", { text: "Figures" }),
    ...(figures.length ? figures : [el("p", { className: "meta", text: "No figures published yet." })]),
    ...(changes.length ? [el("h3", { text: "Recent changes" }), el("ul", {}, ...changes)] : []),
  );
}

export function stageOptions(labels: Record<StageCategory, string>, order: StageCategory[]) {
  return order.map((value) => ({ value, label: labels[value] }));
}
