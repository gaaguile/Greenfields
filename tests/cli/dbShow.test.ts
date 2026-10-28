import { describe, expect, it } from "vitest";
import { formatTable } from "../../src/cli/formatTable.ts";

describe("formatTable", () => {
  it("draws a box and truncates long cells", () => {
    const out = formatTable([{ a: 1, b: "x".repeat(50) }]);
    expect(out).toContain("┌");
    expect(out).toContain("x".repeat(39) + "…");
    expect(out).not.toContain("x".repeat(41));
  });

  it("shows null as an empty cell and handles no rows", () => {
    expect(formatTable([{ a: null }])).toMatch(/│\s+│/);
    expect(formatTable([])).toBe("(no rows)");
  });
});
