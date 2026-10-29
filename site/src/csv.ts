import type { PublicProject } from "../../src/publish/publicTypes.ts";

const HEADERS = [
  "Project", "Owner(s)", "Minerals", "Region", "Stage", "Capex (US$)", "Mine life", "Resource/reserve",
  "Additional info", "Latest report", "Source",
];

function quote(value: string | null): string {
  let text = value ?? "";
  // Excel runs cells starting with these as formulas; a leading apostrophe keeps them as text.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(projects: PublicProject[]): string {
  const rows = projects.map((p) => [
    p.name,
    p.owners,
    p.mineralsText,
    p.region,
    p.stalled ? `${p.stageLabel} (stalled)` : p.stageLabel,
    p.capex,
    p.mineLife,
    p.resourceReserve,
    p.additionalInfo,
    p.latestReport?.slice(0, 10) ?? null,
    p.sourceUrl,
  ]);
  // BOM so Excel opens the UTF-8 file with accents intact.
  return "﻿" + [HEADERS, ...rows].map((r) => r.map(quote).join(",")).join("\r\n") + "\r\n";
}
