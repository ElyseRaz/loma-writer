import { BULLET_TYPES, NUMBER_TYPES } from "../../editor/ListTypes";

/** Marker character of each bullet style in DOCX and ODT. */
export const BULLET_CHARS: Record<string, string> = { disc: "•", circle: "○", square: "▪", dash: "–", arrow: "➢", check: "✓", star: "★", diamond: "◆" };

/** Characters other writers use for the same bullet (Symbol/Wingdings code points live in the private-use area). */
const BULLET_ALIASES: Record<string, string> = {
  "•": "disc", "·": "disc", "": "disc", "●": "disc",
  "o": "circle", "○": "circle", "◦": "circle", "": "circle",
  "▪": "square", "■": "square", "§": "square", "": "square", "□": "square",
  "–": "dash", "-": "dash", "—": "dash", "": "dash",
  "➢": "arrow", "Ø": "arrow", "": "arrow", "➔": "arrow", "➤": "arrow",
  "✓": "check", "ü": "check", "": "check", "✔": "check",
  "★": "star", "": "star", "✶": "star",
  "◆": "diamond", "": "diamond", "❖": "diamond",
};

/** Our bullet style for a bullet character, or null for the default one. */
export function bulletFromChar(ch: string | null | undefined): string | null {
  const id = ch ? BULLET_ALIASES[ch] : undefined;
  return id && id !== BULLET_TYPES[0].id ? id : null;
}

/** OOXML `w:numFmt` and ODF `style:num-format` of each numbering style. */
export const NUMBER_FORMATS: Record<string, { docx: string; odf: string }> = {
  decimal: { docx: "decimal", odf: "1" },
  "lower-alpha": { docx: "lowerLetter", odf: "a" },
  "upper-alpha": { docx: "upperLetter", odf: "A" },
  "lower-roman": { docx: "lowerRoman", odf: "i" },
  "upper-roman": { docx: "upperRoman", odf: "I" },
};

export function numberFromFormat(fmt: string | null | undefined, from: "docx" | "odf"): string | null {
  const id = NUMBER_TYPES.find((t) => NUMBER_FORMATS[t.id][from] === fmt)?.id;
  return id && id !== NUMBER_TYPES[0].id ? id : null;
}

/** Marker style (bullet or numbering) of level `level` of a list whose first level uses `type`. */
export const levelType = (kind: "bullet" | "number", level: number, type: string | null): string =>
  level === 0 && type ? type : kind === "bullet" ? ["disc", "circle", "square"][level % 3] : ["decimal", "lower-alpha", "lower-roman"][level % 3];

export const ALL_BULLET_IDS = BULLET_TYPES.map((t) => t.id);
export const ALL_NUMBER_IDS = NUMBER_TYPES.map((t) => t.id);
