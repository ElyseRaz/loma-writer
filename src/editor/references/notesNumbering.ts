import { formatPageNumber, type PageNumberFormat } from "../../pagination/pageNumber";

/** How the references of the notes are written. */
export type NoteFormat = PageNumberFormat | "symbols";
/** When the numbering starts again: never, at each section, or (footnotes only) on each page. */
export type NoteRestart = "continuous" | "section" | "page";

export interface NoteNumbering {
  format: NoteFormat;
  restart: NoteRestart;
  /** Number of the first note (of the document, of each section or of each page). */
  start: number;
}

export interface NotesOptions {
  foot: NoteNumbering;
  end: NoteNumbering;
}

export const NOTE_FORMATS: Array<{ id: NoteFormat; label: string; sample: string }> = [
  { id: "decimal", label: "1, 2, 3…", sample: "1" },
  { id: "lowerRoman", label: "i, ii, iii…", sample: "i" },
  { id: "upperRoman", label: "I, II, III…", sample: "I" },
  { id: "lowerLetter", label: "a, b, c…", sample: "a" },
  { id: "upperLetter", label: "A, B, C…", sample: "A" },
  { id: "symbols", label: "*, †, ‡, §…", sample: "*" },
];

export const DEFAULT_NOTES: NotesOptions = {
  foot: { format: "decimal", restart: "continuous", start: 1 },
  end: { format: "lowerRoman", restart: "continuous", start: 1 },
};

const SYMBOLS = ["*", "†", "‡", "§", "‖", "¶"];

/** A note number in the format: symbols repeat (*, †, ‡, §, ‖, ¶, **, ††…) as in Word. */
export function formatNoteNumber(n: number, format: NoteFormat): string {
  const v = Math.max(1, Math.trunc(n) || 1);
  if (format === "symbols") return SYMBOLS[(v - 1) % SYMBOLS.length].repeat(Math.floor((v - 1) / SYMBOLS.length) + 1);
  return formatPageNumber(v, format);
}

const FORMATS = new Set<string>(NOTE_FORMATS.map((f) => f.id));

function cleanNumbering(raw: unknown, base: NoteNumbering, pageAllowed: boolean): NoteNumbering {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const restart = r.restart === "section" || (r.restart === "page" && pageAllowed) ? (r.restart as NoteRestart) : "continuous";
  const start = typeof r.start === "number" && Number.isInteger(r.start) && r.start >= 1 && r.start <= 9999 ? r.start : base.start;
  return { format: typeof r.format === "string" && FORMATS.has(r.format) ? (r.format as NoteFormat) : base.format, restart, start };
}

export function cleanNotesOptions(raw: unknown): NotesOptions {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { foot: cleanNumbering(r.foot, DEFAULT_NOTES.foot, true), end: cleanNumbering(r.end, DEFAULT_NOTES.end, false) };
}

/** Value (number) of each note from its rank among the notes of its restart group (0-based `index` inside the group). */
export const noteValue = (o: NoteNumbering, index: number) => o.start + index;
