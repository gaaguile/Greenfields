function cell(value: unknown, maxWidth: number): string {
  const text = value === null || value === undefined ? "" : String(value).replace(/\s+/g, " ");
  return text.length > maxWidth ? text.slice(0, maxWidth - 1) + "…" : text;
}

export function formatTable(rows: Record<string, unknown>[], maxWidth = 40): string {
  if (rows.length === 0) return "(no rows)";
  const columns = Object.keys(rows[0]);
  const cells = rows.map((r) => columns.map((c) => cell(r[c], maxWidth)));
  const widths = columns.map((c, i) => Math.max(c.length, ...cells.map((r) => r[i].length)));
  const line = (l: string, m: string, r: string) => l + widths.map((w) => "─".repeat(w + 2)).join(m) + r;
  const row = (values: string[]) => "│" + values.map((v, i) => ` ${v.padEnd(widths[i])} `).join("│") + "│";
  return [
    line("┌", "┬", "┐"),
    row(columns),
    line("├", "┼", "┤"),
    ...cells.map(row),
    line("└", "┴", "┘"),
  ].join("\n");
}
