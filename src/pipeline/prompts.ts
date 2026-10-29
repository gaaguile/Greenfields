import type { ProjectRow } from "../domain/types.ts";

const GREENFIELD =
  "A greenfield project is a new mineral deposit in Chile with no operating mine on site, from early exploration " +
  "onwards. Brownfield expansions of operating mines are not greenfield.";

export const candidateLine = (p: ProjectRow) =>
  `${p.slug} — ${p.name} — owners: ${p.owners || "unknown"}${p.aliases.length ? ` — also known as: ${p.aliases.join(", ")}` : ""}`;

export function triageSystem(candidates: ProjectRow[]): string {
  return [
    "You sort mining company news for a tracker of greenfield metal projects in Chile.",
    GREENFIELD,
    "Decide which tracked project the document is about (use its slug, or null if none),",
    "its category, whether it is material, and whether it describes a possible new greenfield project in Chile",
    "that is not in the list.",
    "Categories: study (scoping/PEA/PFS/FS results), resource (resource or reserve estimate), drilling (drill results),",
    "permit (environmental or other permits), ownership (acquisitions, joint ventures, option deals),",
    "financing (funding for a project), routine (anything else: dividends, meetings, management changes,",
    "results of operating mines, conferences).",
    "Material means it states or changes a project's figures, stage, owners or minerals.",
    "",
    "Tracked projects (slug — name — owners):",
    ...candidates.map(candidateLine),
  ].join("\n");
}

export const TRIAGE_SCHEMA_HINT =
  '{"projectSlug": string | null, "category": "study" | "resource" | "drilling" | "permit" | "ownership" | ' +
  '"financing" | "routine", "material": boolean, "possibleNewProject": boolean, "reason": string}';

export function documentMessage(doc: { title: string | null; text: string }, maxChars: number): string {
  return `Title: ${doc.title ?? "(none)"}\n\n${doc.text.slice(0, maxChars)}`;
}
