import type { Node as PMNode, Schema } from "@tiptap/pm/model";

/** A heading of the document, in document order. */
export interface HeadingInfo {
  /** Rank among all the headings of the document (what an entry of a table of contents points at). */
  index: number;
  level: number;
  text: string;
  pos: number;
}

export const MAX_TOC_LEVEL = 3;
export const DEFAULT_TOC_TITLE = "Table des matières";

/** Every heading of the document (empty ones included, so that ranks stay stable). */
export function collectHeadings(doc: PMNode): HeadingInfo[] {
  const out: HeadingInfo[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "heading") out.push({ index: out.length, level: Math.min(MAX_TOC_LEVEL, Math.max(1, +node.attrs.level || 1)), text: node.textContent.trim(), pos });
    return node.type.name !== "tableOfContents" && node.type.name !== "shape" && node.type.name !== "shapeGroup"; // neither the entries of a table nor the text of a shape are headings
  });
  return out;
}

/** A line of a table of contents. */
export interface TocLine {
  level: number;
  text: string;
  /** Rank of the heading (or of the caption) the line points at. */
  target: number | null;
  page: string;
}

/** The lines of a table of contents of the headings down to `levels`. `labelAt` gives the page label of a position. */
export function headingLines(headings: HeadingInfo[], levels: number, labelAt: (pos: number) => string): TocLine[] {
  return headings.filter((h) => h.level <= levels && h.text).map((h) => ({ level: h.level, text: h.text, target: h.index, page: labelAt(h.pos) }));
}

/** The lines of a list of captions (figures, tables…) of one label. */
export function captionLines(captions: Array<{ index: number; text: string; pos: number }>, labelAt: (pos: number) => string): TocLine[] {
  return captions.filter((c) => c.text).map((c) => ({ level: 1, text: c.text, target: c.index, page: labelAt(c.pos) }));
}

/** Entry nodes for the lines. */
export function entryNodes(schema: Schema, lines: TocLine[]): PMNode[] {
  const entry = schema.nodes.tocEntry;
  return lines.map((l) => entry.create({ level: l.level, target: l.target, page: l.page }, l.text ? schema.text(l.text) : undefined));
}

/**
 * Entries read from a file carry no link to a heading: this gives each one the rank of the first heading (not taken yet, in order)
 * with the same text. Works on any ProseMirror JSON document.
 */
export interface JsonNode { type?: string; attrs?: Record<string, unknown>; content?: JsonNode[]; text?: string }

export function resolveTocTargets(doc: JsonNode): void {
  const headings: string[] = [];
  const captions: Array<{ label: string; text: string }> = [];
  const walk = (n: JsonNode, fn: (n: JsonNode) => void) => { fn(n); if (n.type !== "tableOfContents") n.content?.forEach((c) => walk(c, fn)); };
  const textOf = (n: JsonNode): string => (n.type === "seqField" ? String(n.attrs?.n ?? "") : n.text ?? "") + (n.content ?? []).map(textOf).join("");
  walk(doc, (n) => {
    if (n.type === "heading") headings.push(textOf(n).trim());
    if (n.type === "paragraph" && typeof n.attrs?.caption === "string") captions.push({ label: n.attrs.caption, text: textOf(n).trim() });
  });
  let from = 0;
  const all = (n: JsonNode, fn: (n: JsonNode) => void) => { fn(n); n.content?.forEach((c) => all(c, fn)); };
  all(doc, (n) => {
    if (n.type !== "tableOfContents") return;
    const kind = n.attrs?.kind === "captions" ? "captions" : "headings";
    // The texts the entries can point at: every heading, or the captions of the label of the list.
    const texts = kind === "headings" ? headings : captions.filter((c) => c.label === n.attrs?.label).map((c) => c.text);
    from = 0;
    for (const e of n.content ?? []) {
      if (e.type !== "tocEntry" || typeof e.attrs?.target === "number") continue;
      const text = textOf(e).trim();
      const at = texts.findIndex((h, i) => i >= from && h === text);
      e.attrs = { ...(e.attrs ?? {}), target: at >= 0 ? at : null };
      if (at >= 0) from = at + 1;
    }
  });
}
