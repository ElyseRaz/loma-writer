import type { PM } from "./pm";

/**
 * Width in px of every column of a table, from the widths its cells carry (`colwidth`, one per column a cell spans). The first row alone
 * is not enough: it may hold cells that span several columns. Columns no cell says anything about get the average of the others;
 * null when no cell carries a width at all.
 */
export function gridWidths(rows: PM[], cols: number): number[] | null {
  const widths: Array<number | undefined> = Array(cols).fill(undefined);
  const pending: number[] = Array(cols).fill(0); // rows still covered by a row span, per column
  for (const row of rows) {
    let col = 0;
    for (const cell of row.content ?? []) {
      while (col < cols && pending[col] > 0) { pending[col]--; col++; }
      const cs = Math.max(1, +(cell.attrs?.colspan ?? 1));
      const rs = Math.max(1, +(cell.attrs?.rowspan ?? 1));
      const w = cell.attrs?.colwidth;
      if (Array.isArray(w) && w.length === cs) for (let k = 0; k < cs && col + k < cols; k++) if (widths[col + k] === undefined && +w[k] > 0) widths[col + k] = +w[k];
      for (let k = 0; k < cs && col + k < cols; k++) pending[col + k] = rs > 1 ? rs - 1 : 0;
      col += cs;
    }
    while (col < cols && pending[col] > 0) { pending[col]--; col++; }
  }
  const known = widths.filter((w): w is number => w !== undefined);
  if (!known.length) return null;
  const avg = known.reduce((a, b) => a + b, 0) / known.length;
  return widths.map((w) => w ?? avg);
}
