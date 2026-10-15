/** Number formats of page numbers (Word's "Format du numéro de page"). */
export type PageNumberFormat = "decimal" | "upperRoman" | "lowerRoman" | "upperLetter" | "lowerLetter";

export const PAGE_NUMBER_FORMATS: Array<{ id: PageNumberFormat; label: string; sample: string }> = [
  { id: "decimal", label: "1, 2, 3…", sample: "1" },
  { id: "lowerRoman", label: "i, ii, iii…", sample: "i" },
  { id: "upperRoman", label: "I, II, III…", sample: "I" },
  { id: "lowerLetter", label: "a, b, c…", sample: "a" },
  { id: "upperLetter", label: "A, B, C…", sample: "A" },
];

const ROMAN: Array<[number, string]> = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];

/** A page number in the given format. Roman numerals and letters start at 1 (other values are written in decimal, as Word does). */
export function formatPageNumber(n: number, format: PageNumberFormat = "decimal"): string {
  if (format === "decimal" || !Number.isFinite(n) || n < 1) return String(Math.trunc(n));
  if (format === "upperRoman" || format === "lowerRoman") {
    let r = "";
    let rest = Math.min(3999, Math.trunc(n));
    for (const [v, s] of ROMAN) while (rest >= v) { r += s; rest -= v; }
    return format === "lowerRoman" ? r.toLowerCase() : r;
  }
  // Letters: a … z, then aa, bb, cc … like Word.
  const i = Math.trunc(n) - 1;
  const letter = String.fromCharCode(97 + (i % 26)).repeat(Math.floor(i / 26) + 1);
  return format === "upperLetter" ? letter.toUpperCase() : letter;
}

export const isPageNumberFormat = (v: unknown): v is PageNumberFormat => PAGE_NUMBER_FORMATS.some((f) => f.id === v);

/** Number shown on each page: a section can restart at a given number; otherwise numbering goes on. */
export function displayedNumbers(sheets: Array<{ section: number; indexInSection: number }>, starts: Array<number | undefined>): number[] {
  const out: number[] = [];
  let last = 0;
  sheets.forEach((s) => {
    const restart = s.indexInSection === 0 ? starts[s.section] : undefined;
    last = restart !== undefined ? restart : last + 1;
    out.push(last);
  });
  return out;
}
