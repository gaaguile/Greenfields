const MIN_QUOTE_CHARS = 15;

// Makes PDF and HTML text comparable with a model's quote: case, typographic quotes and dashes, odd spaces.
export function normalizeForQuote(s: string): string {
  return s
    .toLowerCase()
    .replace(/­/g, "")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/[\s  -​  　]+/g, " ")
    .trim();
}

export function quoteFound(quote: string, text: string): boolean {
  const q = normalizeForQuote(quote);
  if (q.length < MIN_QUOTE_CHARS) return false;
  return normalizeForQuote(text).includes(q);
}
