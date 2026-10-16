import { Extension } from "@tiptap/core";

/** Paragraph layout settings (the "Retrait", "Espacement" and "Enchaînements" of Word's Paragraphe dialog). */
export interface ParagraphLayout {
  /** Left and right indent in cm. */
  indentLeft: number;
  indentRight: number;
  /** First-line indent in cm: positive = indented first line, negative = hanging indent. */
  firstLine: number;
  /** Space above and below in pt (null = the style's own spacing). */
  spaceBefore: number | null;
  spaceAfter: number | null;
  pageBreakBefore: boolean;
  keepWithNext: boolean;
  keepLines: boolean;
}

export const DEFAULT_LAYOUT: ParagraphLayout = { indentLeft: 0, indentRight: 0, firstLine: 0, spaceBefore: null, spaceAfter: null, pageBreakBefore: false, keepWithNext: false, keepLines: false };
export const MAX_INDENT_CM = 20;
export const MAX_SPACE_PT = 200;

const TEXT_BLOCKS = ["paragraph", "heading"]; // (the lines of a table of contents keep the default layout)
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Valid layout values from anything (a file, the ribbon). */
export function cleanLayout(input: Partial<Record<keyof ParagraphLayout, unknown>> | null | undefined, base: ParagraphLayout = DEFAULT_LAYOUT): ParagraphLayout {
  const raw = input ?? {};
  const num = (v: unknown, d: number, lo: number, hi: number) => (fin(v) ? r2(clamp(v, lo, hi)) : d);
  const sp = (v: unknown, d: number | null) => (v === null ? null : fin(v) ? r2(clamp(v, 0, MAX_SPACE_PT)) : d);
  return {
    indentLeft: num(raw.indentLeft, base.indentLeft, 0, MAX_INDENT_CM),
    indentRight: num(raw.indentRight, base.indentRight, 0, MAX_INDENT_CM),
    firstLine: num(raw.firstLine, base.firstLine, -MAX_INDENT_CM, MAX_INDENT_CM),
    spaceBefore: sp(raw.spaceBefore, base.spaceBefore),
    spaceAfter: sp(raw.spaceAfter, base.spaceAfter),
    pageBreakBefore: typeof raw.pageBreakBefore === "boolean" ? raw.pageBreakBefore : base.pageBreakBefore,
    keepWithNext: typeof raw.keepWithNext === "boolean" ? raw.keepWithNext : base.keepWithNext,
    keepLines: typeof raw.keepLines === "boolean" ? raw.keepLines : base.keepLines,
  };
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    paragraphFormat: {
      /** Changes some layout settings of the selected paragraphs and headings. */
      setParagraphLayout: (patch: Partial<ParagraphLayout>) => ReturnType;
    };
  }
}

const attr = (name: keyof ParagraphLayout, dataName: string, def: unknown, parse: (v: string) => unknown, css: (v: never) => string | null) => ({
  default: def,
  parseHTML: (el: HTMLElement) => { const v = el.getAttribute(dataName); return v === null ? def : parse(v); },
  renderHTML: (a: Record<string, unknown>) => {
    const v = a[name];
    if (v === def || v === undefined) return {};
    const style = css(v as never);
    return { [dataName]: String(v), ...(style ? { style } : {}) };
  },
});

/**
 * Paragraph indents, spacing and page-flow options, stored as node attributes (written to DOCX/ODT, and used by the pagination:
 * "page break before", "keep with next" and "keep lines together").
 */
export const ParagraphFormat = Extension.create({
  name: "paragraphFormat",

  addGlobalAttributes() {
    return [
      {
        types: TEXT_BLOCKS,
        attributes: {
          indentLeft: attr("indentLeft", "data-indent-left", 0, parseFloat, (v: number) => `margin-left:calc(var(--sec-l, 0px) + ${v}cm)`),
          indentRight: attr("indentRight", "data-indent-right", 0, parseFloat, (v: number) => `margin-right:calc(var(--sec-r, 0px) + ${v}cm)`),
          firstLine: attr("firstLine", "data-first-line", 0, parseFloat, (v: number) => `text-indent:${v}cm`),
          spaceBefore: attr("spaceBefore", "data-space-before", null, parseFloat, (v: number) => `margin-top:${v}pt`),
          spaceAfter: attr("spaceAfter", "data-space-after", null, parseFloat, (v: number) => `margin-bottom:${v}pt`),
          pageBreakBefore: attr("pageBreakBefore", "data-page-break-before", false, (v) => v === "true", () => null),
          keepWithNext: attr("keepWithNext", "data-keep-next", false, (v) => v === "true", () => null),
          keepLines: attr("keepLines", "data-keep-lines", false, (v) => v === "true", () => null),
        },
      },
    ];
  },

  addCommands() {
    return {
      setParagraphLayout:
        (patch) =>
        ({ state, tr, dispatch }) => {
          const { from, to } = state.selection;
          let changed = false;
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (!TEXT_BLOCKS.includes(node.type.name)) return true;
            const next = cleanLayout(patch, cleanLayout(node.attrs as never));
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...next });
            changed = true;
            return false;
          });
          if (changed) dispatch?.(tr);
          return changed;
        },
    };
  },
});
