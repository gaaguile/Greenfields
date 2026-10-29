import { describe, expect, it } from "vitest";
import { scoreFigures } from "../../src/eval/score.ts";

describe("scoreFigures", () => {
  it("scores precision and recall over matched figures", () => {
    const expected = [
      { field: "capex_usd", valueText: "US$2.4 billion", valueNum: 2.4e9 },
      { field: "mine_life_years", valueText: "26 years", valueNum: 26 },
    ];
    const actual = [
      { field: "capex_usd", valueText: "US$2.42 bn", valueNum: 2.42e9 }, // within 1%
      { field: "mine_life_years", valueText: "26 Years", valueNum: null }, // same text, different case
      { field: "grade", valueText: "0.4% Cu", valueNum: null },
    ];
    const s = scoreFigures(expected, actual);
    expect(s.matched).toBe(2);
    expect(s.recall).toBe(1);
    expect(s.precision).toBeCloseTo(0.667, 3);
  });

  it("does not match a different field or a number more than 1% off", () => {
    const s = scoreFigures(
      [{ field: "capex_usd", valueText: "US$2.4 billion", valueNum: 2.4e9 }],
      [{ field: "c1_cost", valueText: "US$2.4 billion", valueNum: 2.4e9 }, { field: "capex_usd", valueText: "x", valueNum: 2.5e9 }],
    );
    expect(s).toEqual({ matched: 0, precision: 0, recall: 0 });
  });

  it("counts each actual figure once", () => {
    const e = { field: "capex_usd", valueText: "US$2.4 billion", valueNum: 2.4e9 };
    expect(scoreFigures([e, e], [e]).matched).toBe(1);
  });

  it("scores an empty case as perfect", () => {
    expect(scoreFigures([], [])).toEqual({ matched: 0, precision: 1, recall: 1 });
  });
});
