/** Paragraph styles of a document that the user can edit ("Modifier le style…"). */
export type StyleId = "normal" | "h1" | "h2" | "h3" | "quote" | "code";

export interface StyleDef {
  fontFamily?: string;
  sizePt?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right" | "justify";
  /** Space above and below the paragraph, in points. */
  spaceBefore?: number;
  spaceAfter?: number;
  lineHeight?: number;
}

/** Only what differs from the built-in look is stored. */
export type DocStyles = Partial<Record<StyleId, StyleDef>>;

export const STYLE_IDS: StyleId[] = ["normal", "h1", "h2", "h3", "quote", "code"];
export const STYLE_LABELS: Record<StyleId, string> = { normal: "Normal", h1: "Titre 1", h2: "Titre 2", h3: "Titre 3", quote: "Citation", code: "Code" };
export const STYLE_SELECTORS: Record<StyleId, string> = { normal: "p", h1: "h1", h2: "h2", h3: "h3", quote: "blockquote", code: "pre" };

/** The built-in look of each style (what the stylesheet draws without any override). `font`/`size` of Normal come from the document defaults. */
export function builtinStyle(id: StyleId, defaults: { fontFamily: string; sizePt: number }): Required<StyleDef> {
  const base = { fontFamily: defaults.fontFamily, sizePt: defaults.sizePt, color: "#1b1c1c", bold: false, italic: false, align: "left" as const, spaceBefore: 0, spaceAfter: 7, lineHeight: 1.55 };
  switch (id) {
    case "normal": return base;
    case "h1": return { ...base, sizePt: 22, color: "#1d4ed8", bold: true, spaceBefore: 24, spaceAfter: 9, lineHeight: 1.25 };
    case "h2": return { ...base, sizePt: 16, bold: true, spaceBefore: 18, spaceAfter: 6, lineHeight: 1.25 };
    case "h3": return { ...base, sizePt: 13, bold: true, spaceBefore: 14, spaceAfter: 5, lineHeight: 1.25 };
    case "quote": return { ...base, color: "#3f4a63", italic: true, spaceBefore: 11, spaceAfter: 11 };
    case "code": return { ...base, fontFamily: "JetBrains Mono", sizePt: 10, spaceBefore: 8, spaceAfter: 8 };
  }
}

const HEX = /^#[0-9a-f]{6}$/i;
const num = (v: unknown, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined);

/** Drops anything invalid (documents and drafts are untrusted input). */
export function cleanStyles(raw: unknown): DocStyles {
  const out: DocStyles = {};
  if (!raw || typeof raw !== "object") return out;
  for (const id of STYLE_IDS) {
    const r = (raw as Record<string, unknown>)[id];
    if (!r || typeof r !== "object") continue;
    const s = r as Record<string, unknown>;
    const def: StyleDef = {};
    if (typeof s.fontFamily === "string" && s.fontFamily.trim() && s.fontFamily.length < 80 && !/[;{}<>"\\]/.test(s.fontFamily)) def.fontFamily = s.fontFamily.trim();
    const size = num(s.sizePt, 6, 96); if (size !== undefined) def.sizePt = Math.round(size * 2) / 2;
    if (typeof s.color === "string" && HEX.test(s.color)) def.color = s.color.toLowerCase();
    if (typeof s.bold === "boolean") def.bold = s.bold;
    if (typeof s.italic === "boolean") def.italic = s.italic;
    if (s.align === "left" || s.align === "center" || s.align === "right" || s.align === "justify") def.align = s.align;
    const before = num(s.spaceBefore, 0, 200); if (before !== undefined) def.spaceBefore = Math.round(before * 2) / 2;
    const after = num(s.spaceAfter, 0, 200); if (after !== undefined) def.spaceAfter = Math.round(after * 2) / 2;
    const line = num(s.lineHeight, 0.8, 3); if (line !== undefined) def.lineHeight = Math.round(line * 100) / 100;
    if (Object.keys(def).length) out[id] = def;
  }
  return out;
}

/** The effective style: built-in look plus overrides. */
export const resolveStyle = (id: StyleId, styles: DocStyles, defaults: { fontFamily: string; sizePt: number }): Required<StyleDef> => ({ ...builtinStyle(id, defaults), ...styles[id] });

const quote = (f: string) => `"${f.replace(/"/g, "")}", sans-serif`;

/** Stylesheet drawing the overrides in the editing area. */
export function stylesCss(styles: DocStyles): string {
  const rules: string[] = [];
  for (const id of STYLE_IDS) {
    const s = styles[id];
    if (!s) continue;
    const sel = `.paper .ProseMirror ${STYLE_SELECTORS[id]}`;
    const decl = [
      s.fontFamily && `font-family:${quote(s.fontFamily)}`,
      s.sizePt && `font-size:${s.sizePt}pt`,
      s.color && `color:${s.color}`,
      s.bold !== undefined && `font-weight:${s.bold ? 700 : 400}`,
      s.italic !== undefined && `font-style:${s.italic ? "italic" : "normal"}`,
      s.align && `text-align:${s.align}`,
      s.spaceBefore !== undefined && `margin-top:${s.spaceBefore}pt`,
      s.spaceAfter !== undefined && `margin-bottom:${s.spaceAfter}pt`,
      s.lineHeight && `line-height:${s.lineHeight}`,
    ].filter(Boolean);
    if (decl.length) rules.push(`${sel}{${decl.join(";")}}`);
    // The quote and code look is carried by the block, its paragraphs inherit it.
    if (id === "quote" && decl.length) rules.push(`.paper .ProseMirror blockquote p{margin:0}`);
  }
  return rules.join("\n");
}
