export interface ScoredFigure {
  field: string;
  valueText: string;
  valueNum?: number | null;
}

const NUM_TOLERANCE = 0.01;
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function matches(e: ScoredFigure, a: ScoredFigure): boolean {
  if (e.field !== a.field) return false;
  if (e.valueNum != null && a.valueNum != null && e.valueNum !== 0) {
    if (Math.abs(a.valueNum - e.valueNum) / Math.abs(e.valueNum) <= NUM_TOLERANCE) return true;
  }
  return norm(e.valueText) === norm(a.valueText);
}

// Field-level precision and recall; each actual figure can match one expected figure only.
export function scoreFigures(
  expected: ScoredFigure[],
  actual: ScoredFigure[],
): { precision: number; recall: number; matched: number } {
  const unused = [...actual];
  let matched = 0;
  for (const e of expected) {
    const i = unused.findIndex((a) => matches(e, a));
    if (i !== -1) {
      unused.splice(i, 1);
      matched++;
    }
  }
  return {
    matched,
    precision: actual.length ? matched / actual.length : 1,
    recall: expected.length ? matched / expected.length : 1,
  };
}
