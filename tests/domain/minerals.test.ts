import { describe, expect, it } from "vitest";
import { mineralSymbol } from "../../src/domain/minerals.ts";

describe("mineralSymbol", () => {
  it.each([
    ["Copper", "Cu"],
    ["Gold", "Au"],
    ["Silver", "Ag"],
    ["Molybdenum", "Mo"],
    ["Lithium (brine)", "Li"],
    ["Lithium (as lithium carbonate)", "Li"],
    ["Potassium chloride (byproduct)", "K"],
    ["Potassium", "K"],
    ["Unobtainium", "Unobtainium"],
  ])("%s → %s", (raw, symbol) => {
    expect(mineralSymbol(raw)).toBe(symbol);
  });
});
