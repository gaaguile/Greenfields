import { describe, expect, it } from "vitest";
import { normalizeForQuote, quoteFound } from "../../src/pipeline/verify.ts";

const pdfText =
  "The updated PFS estimates initial capital costs of\nUS$2.7 billion and a mine life of 26 years.\n" +
  "The Company’s “base case” assumes a long‑term copper price of US$4.00/lb. Avail-­able data.";

describe("quoteFound", () => {
  it("matches a quote across a PDF line break", () => {
    expect(quoteFound("initial capital costs of US$2.7 billion", pdfText)).toBe(true);
  });

  it("matches curly quotes, non-breaking spaces and non-breaking hyphens to their plain forms", () => {
    expect(quoteFound('The Company\'s "base case" assumes a long-term copper price', pdfText)).toBe(true);
    expect(quoteFound("a mine life of 26 years", pdfText)).toBe(true);
  });

  it("ignores case", () => {
    expect(quoteFound("INITIAL CAPITAL COSTS OF US$2.7 BILLION", pdfText)).toBe(true);
  });

  it("rejects a paraphrase with one word changed", () => {
    expect(quoteFound("initial capital costs of US$2.9 billion", pdfText)).toBe(false);
    expect(quoteFound("estimated initial capital costs of US$2.7 billion", pdfText)).toBe(false);
  });

  it("rejects quotes shorter than 15 characters", () => {
    expect(quoteFound("US$2.7 bil", pdfText)).toBe(false);
    expect(quoteFound("", pdfText)).toBe(false);
  });
});

describe("normalizeForQuote", () => {
  it("drops soft hyphens and collapses whitespace", () => {
    expect(normalizeForQuote("Avail-­able  data")).toBe("avail-able data");
    expect(normalizeForQuote("  A\tB\nC  ")).toBe("a b c");
  });
});
