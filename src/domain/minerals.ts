const SYMBOLS: [RegExp, string][] = [
  [/^copper\b/i, "Cu"],
  [/^gold\b/i, "Au"],
  [/^silver\b/i, "Ag"],
  [/^molybdenum\b/i, "Mo"],
  [/^lithium\b/i, "Li"],
  [/^potassium\b/i, "K"],
  [/^zinc\b/i, "Zn"],
  [/^lead\b/i, "Pb"],
  [/^cobalt\b/i, "Co"],
  [/^iron\b/i, "Fe"],
];

export function mineralSymbol(raw: string): string {
  const name = raw.trim();
  for (const [pattern, symbol] of SYMBOLS) if (pattern.test(name)) return symbol;
  return name;
}
