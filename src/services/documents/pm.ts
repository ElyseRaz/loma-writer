import { cleanLayout, DEFAULT_LAYOUT, type ParagraphLayout } from "../../editor/ParagraphFormat";
import type { JSONContent } from "@tiptap/react";

export type PM = JSONContent;
export type Mark = { type: string; attrs?: Record<string, unknown> };

/** Run-level formatting shared by the DOCX and ODT importers. */
export interface RunProps {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  sub?: boolean;
  sup?: boolean;
  color?: string;
  sizePt?: number;
  font?: string;
  highlight?: string;
  lineHeight?: string;
  link?: string;
}

export function marksFor(p: RunProps): Mark[] {
  const marks: Mark[] = [];
  if (p.bold) marks.push({ type: "bold" });
  if (p.italic) marks.push({ type: "italic" });
  if (p.underline) marks.push({ type: "underline" });
  if (p.strike) marks.push({ type: "strike" });
  if (p.sub) marks.push({ type: "subscript" });
  if (p.sup) marks.push({ type: "superscript" });
  const style: Record<string, string> = {};
  if (p.font) style.fontFamily = p.font;
  if (p.sizePt) style.fontSize = `${p.sizePt}pt`;
  if (p.color) style.color = p.color;
  if (p.lineHeight) style.lineHeight = p.lineHeight;
  if (Object.keys(style).length) marks.push({ type: "textStyle", attrs: style });
  if (p.highlight) marks.push({ type: "highlight", attrs: { color: p.highlight } });
  if (p.link) marks.push({ type: "link", attrs: { href: p.link } });
  return marks;
}

export const textNode = (text: string, props: RunProps = {}): PM => {
  const marks = marksFor(props);
  return marks.length ? { type: "text", text, marks } : { type: "text", text };
};

/** Paragraph decoration shared by every format: background colour and borders. */
export interface BlockDecoration {
  shading?: string | null;
  borders?: { top?: boolean; right?: boolean; bottom?: boolean; left?: boolean } | null;
  /** Indents, spacing and page-flow options (only the non-default ones are kept). */
  layout?: Partial<ParagraphLayout>;
}

const layoutAttrs = (l?: Partial<ParagraphLayout>) => {
  if (!l) return {};
  const c = cleanLayout(l);
  return Object.fromEntries(Object.entries(c).filter(([k, v]) => v !== (DEFAULT_LAYOUT as unknown as Record<string, unknown>)[k]));
};
const decorationAttrs = (d?: BlockDecoration) => ({ ...(d?.shading ? { shading: d.shading } : {}), ...(d?.borders ? { borders: d.borders } : {}), ...layoutAttrs(d?.layout) });

export const paragraph = (content: PM[], align?: string, deco?: BlockDecoration): PM => {
  const attrs = { ...(align && align !== "left" ? { textAlign: align } : {}), ...decorationAttrs(deco) };
  return { type: "paragraph", ...(Object.keys(attrs).length ? { attrs } : {}), ...(content.length ? { content } : {}) };
};

export const heading = (level: number, content: PM[], align?: string, deco?: BlockDecoration): PM => ({
  type: "heading",
  attrs: { level, ...(align && align !== "left" ? { textAlign: align } : {}), ...decorationAttrs(deco) },
  ...(content.length ? { content } : {}),
});

/** Merges adjacent text nodes that carry identical marks. */
export function mergeText(nodes: PM[]): PM[] {
  const out: PM[] = [];
  for (const n of nodes) {
    const prev = out[out.length - 1];
    if (prev && prev.type === "text" && n.type === "text" && JSON.stringify(prev.marks ?? []) === JSON.stringify(n.marks ?? [])) {
      prev.text = (prev.text ?? "") + (n.text ?? "");
    } else out.push({ ...n });
  }
  return out;
}

export const plainText = (node: PM): string =>
  node.type === "text" ? node.text ?? "" : node.type === "hardBreak" ? "\n" : (node.content ?? []).map(plainText).join(node.type === "doc" ? "\n" : "");

export function hasVisibleContent(blocks: PM[]): boolean {
  const walk = (n: PM): boolean =>
    n.type === "image" || n.type === "table" || n.type === "horizontalRule" || (n.type === "text" && !!n.text?.trim()) || (n.content ?? []).some(walk);
  return blocks.some(walk);
}

export const ensureBlocks = (blocks: PM[]): PM[] => (blocks.length ? blocks : [paragraph([])]);

/** Accumulates nested lists from a flat sequence of list paragraphs (shared by DOCX and similar flat formats). */
export class ListBuilder {
  private stack: PM[] = [];
  constructor(private readonly out: PM[]) {}

  get active() {
    return this.stack.length > 0;
  }
  close() {
    this.stack = [];
  }
  add(kind: "bulletList" | "orderedList", level: number, blocks: PM[], listType: string | null = null) {
    const lvl = Math.min(level, this.stack.length);
    this.stack.length = Math.min(this.stack.length, lvl + 1);
    if (this.stack.length === lvl + 1 && (this.stack[lvl].type !== kind || (lvl === 0 && (this.stack[0].attrs?.listType ?? null) !== listType))) this.stack.length = lvl;
    if (this.stack.length === lvl) {
      const list: PM = { type: kind, ...(listType && lvl === 0 ? { attrs: { listType } } : {}), content: [] };
      if (lvl === 0) this.out.push(list);
      else {
        const parentItems = this.stack[lvl - 1].content!;
        parentItems[parentItems.length - 1].content!.push(list);
      }
      this.stack.push(list);
    }
    this.stack[lvl].content!.push({ type: "listItem", content: blocks });
  }
}

/**
 * Formats without a native formula object store an equation as text `\(latex\)`. This turns such text back
 * into equation nodes (the exporters write it, so Loma Writer documents round-trip).
 */
export function splitEquations(nodes: PM[]): PM[] {
  const out: PM[] = [];
  for (const n of nodes) {
    if (n.type !== "text" || !n.text || !n.text.includes("\\(")) { out.push(n); continue; }
    const re = /\\\(([^\n]+?)\\\)/g;
    let last = 0;
    for (let m = re.exec(n.text); m; m = re.exec(n.text)) {
      if (m.index > last) out.push({ ...n, text: n.text.slice(last, m.index) });
      out.push({ type: "equation", attrs: { latex: m[1] } });
      last = m.index + m[0].length;
    }
    if (last < n.text.length) out.push({ ...n, text: n.text.slice(last) });
  }
  return out;
}

export const equationText = (latex: string) => `\\(${latex}\\)`;
