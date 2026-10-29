import type { DatabaseSync } from "node:sqlite";
import type { CandidateProject } from "../pipeline/candidate.ts";
import { listProjects } from "../store/projects.ts";

// Deciding whether a candidate is a project we already know: tracked, already suggested, or already rejected.

const FILLER_WORDS = new Set(["proyecto", "project", "prospecto", "prospect", "mina", "mine", "the", "de"]);
const COMPANY_WORDS = new Set([
  "mining", "minera", "mineria", "corporation", "corp", "limited", "ltd", "inc", "resources", "spa",
  // Words that show up in owner descriptions but say nothing about who the owner is.
  "from", "with", "stake", "owned", "private", "project", "group", "company", "investor", "strategic", "interests",
  "chilean", "junior", "vehicle", "developer", "holding", "structure",
]);
const MIN_CONTAINED_CHARS = 6;
const MIN_WORD_OVERLAP = 0.6;
const MIN_OWNER_WORD = 4;

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const words = (s: string) => fold(s).replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);

export function foldName(name: string): string {
  return words(name).filter((w) => !FILLER_WORDS.has(w)).join(" ");
}

export function ownerWords(owners: string): Set<string> {
  return new Set(words(owners).filter((w) => w.length >= MIN_OWNER_WORD && !/^\d/.test(w) && !COMPANY_WORDS.has(w)));
}

export function namesMatch(a: string, b: string): boolean {
  const fa = foldName(a);
  const fb = foldName(b);
  if (!fa || !fb) return false;
  if (fa === fb) return true;
  const [short, long] = fa.length <= fb.length ? [fa, fb] : [fb, fa];
  if (short.length >= MIN_CONTAINED_CHARS && ` ${long} `.includes(` ${short} `)) return true;
  const wa = new Set(fa.split(" "));
  const wb = new Set(fb.split(" "));
  const shared = [...wa].filter((w) => wb.has(w)).length;
  return shared / new Set([...wa, ...wb]).size >= MIN_WORD_OVERLAP;
}

export type MatchResult =
  | { kind: "tracked"; projectId: number }
  | { kind: "pending"; suggestionId: number }
  | { kind: "rejected"; suggestionId: number }
  | { kind: "new"; possibleDuplicateOf: number | null };

interface Known {
  names: string[];
  region: string | null;
  owners: string;
}

// "duplicate": the same project; "similar": a similar name only, worth a warning.
function compare(c: CandidateProject, k: Known): "duplicate" | "similar" | null {
  const candidateNames = [c.name, ...c.aliases];
  const exact = candidateNames.some((n) => k.names.some((m) => foldName(n) !== "" && foldName(n) === foldName(m)));
  if (exact) return "duplicate";
  if (!candidateNames.some((n) => k.names.some((m) => namesMatch(n, m)))) return null;
  const sameRegion = !!c.region && !!k.region && fold(c.region).trim() === fold(k.region).trim();
  const theirs = ownerWords(k.owners);
  const sharedOwner = [...ownerWords(c.company)].some((w) => theirs.has(w));
  return sameRegion || sharedOwner ? "duplicate" : "similar";
}

export function matchCandidate(db: DatabaseSync, c: CandidateProject): MatchResult {
  let similar: number | null = null;
  for (const p of listProjects(db)) {
    const r = compare(c, { names: [p.name, ...p.aliases], region: p.region, owners: p.owners ?? "" });
    if (r === "duplicate") return { kind: "tracked", projectId: p.id };
    if (r === "similar" && similar === null) similar = p.id;
  }
  const suggestions = db.prepare("SELECT id, data, status FROM suggestions WHERE status IN ('pending', 'rejected') ORDER BY id")
    .all() as { id: number; data: string; status: "pending" | "rejected" }[];
  for (const s of suggestions) {
    const d = JSON.parse(s.data) as CandidateProject;
    if (compare(c, { names: [d.name, ...d.aliases], region: d.region, owners: d.company }) === "duplicate") {
      return { kind: s.status, suggestionId: s.id };
    }
  }
  return { kind: "new", possibleDuplicateOf: similar };
}
