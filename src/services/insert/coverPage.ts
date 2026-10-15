import type { PM } from "../documents/pm";

export type CoverStyle = "classic" | "modern" | "plain";

export interface CoverFields {
  title: string;
  subtitle: string;
  author: string;
  date: string;
}

export const COVER_STYLES: Array<{ id: CoverStyle; label: string; hint: string }> = [
  { id: "classic", label: "Classique", hint: "Titre centré, en grand" },
  { id: "modern", label: "Moderne", hint: "Titre à gauche, filet bleu" },
  { id: "plain", label: "Sobre", hint: "Texte centré entre deux filets" },
];

const run = (text: string, size: number, extra: { bold?: boolean; color?: string } = {}): PM => ({
  type: "text",
  text,
  marks: [
    ...(extra.bold ? [{ type: "bold" }] : []),
    { type: "textStyle", attrs: { fontSize: `${size}pt`, ...(extra.color ? { color: extra.color } : {}) } },
  ],
});

const para = (text: string, size: number, align: string, extra: { bold?: boolean; color?: string; borders?: object } = {}): PM => ({
  type: "paragraph",
  attrs: { textAlign: align, ...(extra.borders ? { borders: extra.borders } : {}) },
  ...(text ? { content: [run(text, size, extra)] } : {}),
});

const gap = (n: number): PM[] => Array.from({ length: n }, () => ({ type: "paragraph" }));

/** Blocks of a cover page, ending with a page break so the document starts on the next page. */
export function coverPageBlocks(style: CoverStyle, f: CoverFields): PM[] {
  const title = f.title.trim() || "Titre du document";
  const out: PM[] = [];
  if (style === "classic") {
    out.push(...gap(7), para(title, 34, "center", { bold: true }));
    if (f.subtitle.trim()) out.push(para(f.subtitle.trim(), 18, "center", { color: "#4b5563" }));
    out.push(...gap(8));
    if (f.author.trim()) out.push(para(f.author.trim(), 14, "center"));
    if (f.date.trim()) out.push(para(f.date.trim(), 12, "center", { color: "#6b7280" }));
  } else if (style === "modern") {
    out.push(...gap(6), para(title, 38, "left", { bold: true, color: "#1d4ed8", borders: { bottom: true } }));
    if (f.subtitle.trim()) out.push(para(f.subtitle.trim(), 18, "left", { color: "#4b5563" }));
    out.push(...gap(9));
    if (f.author.trim()) out.push(para(f.author.trim(), 14, "left", { bold: true }));
    if (f.date.trim()) out.push(para(f.date.trim(), 12, "left", { color: "#6b7280" }));
  } else {
    out.push(...gap(6), para(title, 28, "center", { bold: true, borders: { top: true, bottom: true } }));
    if (f.subtitle.trim()) out.push(para(f.subtitle.trim(), 16, "center", { color: "#4b5563" }));
    out.push(...gap(8));
    if (f.author.trim()) out.push(para(f.author.trim(), 13, "center"));
    if (f.date.trim()) out.push(para(f.date.trim(), 12, "center", { color: "#6b7280" }));
  }
  out.push({ type: "pageBreak" });
  return out;
}
