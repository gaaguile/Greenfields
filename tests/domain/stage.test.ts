import { describe, expect, it } from "vitest";
import { normalizeStage } from "../../src/domain/stage.ts";

const cases: [string, string, boolean][] = [
  ["Pre-Feasibility Study (PFS) completed", "pfs", false],
  ["Feasibility-level studies historically completed; no construction decision taken — long-stalled", "fs", true],
  ["Pre-feasibility level; long-stalled, no updated timeline", "pfs", true],
  ["Construction (targeting start-up mid-2026)", "construction", false],
  ["Construction", "construction", false],
  ["Environmentally approved (RCA granted); pre-construction, seeking a strategic/financial partner", "permitting", false],
  ["Preliminary Economic Assessment (PEA, Feb 2026); integrated technical report filed Mar 2026", "scoping_pea", false],
  ["Advanced permitting / feasibility-stage development", "permitting", false],
  ["Exploration and scoping", "scoping_pea", false],
  ["Exploration and resource definition", "advanced_exploration", false],
  ["Exploration / pre-feasibility evaluation", "pfs", false],
  ["Exploration / early studies", "exploration", false],
  ["Exploration and early permitting", "exploration", false],
];

describe("normalizeStage", () => {
  it.each(cases)("%s → %s", (text, stage, stalled) => {
    expect(normalizeStage(text)).toEqual({ stage, stalled });
  });
});
