import { mergeAttributes, Node } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, TextSelection, type EditorState } from "@tiptap/pm/state";
import { sanitizeHeaderFooter, type HeaderFooterSettings } from "../pagination/headerFooter";
import { sanitizePage } from "../services/documents/sanitize";
import { DEFAULT_PAGE, type PageSetup } from "../state/types";

/** A section of the document: its own paper, orientation, margins, headers and footers. */
export interface SectionInfo {
  /** 0 for the first section. */
  index: number;
  /** Document offset of the break that starts the section (-1 for the first one). */
  pos: number;
  page: PageSetup;
  /** Headers and footers in effect (inherited from the previous section when the break does not define its own). */
  hf: HeaderFooterSettings;
  /** True when the section takes its headers and footers from the previous one. */
  linked: boolean;
}

export const SECTION_BREAK = "sectionBreak";
export const SECTION_LABEL = "Saut de section (page suivante)";

/**
 * The sections of a document. The first one is described by the document-level setup (`docPage`, `docHf`); every `sectionBreak`
 * node carries the setup of the section that starts after it (`hf` null = same headers and footers as before).
 */
export interface SectionBreakInfo {
  pos: number;
  page: unknown;
  hf: unknown;
}

/** The raw section breaks of a document, in order (cheap to compare, so React can track them). */
export function readSectionBreaks(doc: PMNode): SectionBreakInfo[] {
  const out: SectionBreakInfo[] = [];
  doc.forEach((n, off) => { if (n.type.name === SECTION_BREAK) out.push({ pos: off, page: n.attrs.page, hf: n.attrs.hf }); });
  return out;
}

/** Resolves breaks into sections (inheritance of paper and of headers/footers). */
export function buildSections(breaks: SectionBreakInfo[], docPage: PageSetup, docHf: HeaderFooterSettings): SectionInfo[] {
  const out: SectionInfo[] = [{ index: 0, pos: -1, page: docPage, hf: docHf, linked: false }];
  for (const b of breaks) {
    const prev = out[out.length - 1];
    const page = b.page ? sanitizePage(b.page as Partial<PageSetup>) : prev.page;
    const linked = !b.hf;
    out.push({ index: out.length, pos: b.pos, page, hf: linked ? prev.hf : sanitizeHeaderFooter(b.hf), linked });
  }
  return out;
}

export const readSections = (doc: PMNode, docPage: PageSetup, docHf: HeaderFooterSettings): SectionInfo[] => buildSections(readSectionBreaks(doc), docPage, docHf);

/** Index of the section holding document position `pos`. */
export function sectionIndexAt(doc: PMNode, pos: number): number {
  let index = 0;
  doc.forEach((n, off) => { if (n.type.name === SECTION_BREAK && off + n.nodeSize <= pos) index++; });
  return index;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    sections: {
      /** Starts a new section (on a new page) at the cursor; it begins with the current paper, margins and headers. */
      insertSectionBreak: () => ReturnType;
      /** Changes the paper/margins of the section `index` (the first one is stored with the document, not in a break). */
      setSectionPage: (index: number, page: PageSetup) => ReturnType;
      /** Gives section `index` its own headers and footers, or links it to the previous section again (null). */
      setSectionHeaderFooter: (index: number, hf: HeaderFooterSettings | null) => ReturnType;
    };
  }
}

const json = (el: HTMLElement, name: string) => {
  try { const v = el.getAttribute(name); return v ? JSON.parse(v) : null; } catch { return null; }
};

export const SectionBreak = Node.create({
  name: SECTION_BREAK,
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      page: { default: null, parseHTML: (el: HTMLElement) => json(el, "data-page"), renderHTML: (a: Record<string, unknown>) => (a.page ? { "data-page": JSON.stringify(a.page) } : {}) },
      hf: { default: null, parseHTML: (el: HTMLElement) => json(el, "data-hf"), renderHTML: (a: Record<string, unknown>) => (a.hf ? { "data-hf": JSON.stringify(a.hf) } : {}) },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-section-break]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-section-break": "", class: "section-break", contenteditable: "false" }), ["span", {}, SECTION_LABEL]];
  },

  addCommands() {
    return {
      insertSectionBreak:
        () =>
        ({ state, tr, dispatch, editor }) => {
          const { $from } = state.selection;
          // Top-level position: after the block holding the cursor (the block is split first when the cursor is inside text).
          const index = $from.depth >= 1 ? $from.index(0) : 0;
          const top = state.doc.child(index);
          const sections = (editor.storage as unknown as { sectionBreak?: { current: () => SectionInfo[] } }).sectionBreak?.current();
          const cur = sections?.[sectionIndexAt(state.doc, $from.pos)];
          const page = cur ? cur.page : DEFAULT_PAGE;
          let at = $from.after(1);
          if (top.isTextblock && $from.depth === 1 && $from.parentOffset > 0 && $from.parentOffset < top.content.size) {
            tr.split($from.pos);
            at = tr.mapping.map($from.after(1));
          } else if (top.isTextblock && $from.depth === 1 && $from.parentOffset === 0 && top.content.size > 0) at = $from.before(1);
          const node = state.schema.nodes[SECTION_BREAK].create({ page, hf: null });
          tr.insert(at, node);
          // A paragraph must follow the break, to type in the new section.
          const after = at + node.nodeSize;
          if (after >= tr.doc.content.size || tr.doc.nodeAt(after)?.type.name === SECTION_BREAK) tr.insert(after, state.schema.nodes.paragraph.create());
          tr.setSelection(TextSelection.near(tr.doc.resolve(after), 1));
          dispatch?.(tr.scrollIntoView());
          return true;
        },
      setSectionPage:
        (index, page) =>
        ({ state, tr, dispatch }) => {
          if (index <= 0) return false;
          let k = 0, done = false;
          state.doc.forEach((n, off) => {
            if (n.type.name !== SECTION_BREAK || done) return;
            if (++k === index) { tr.setNodeMarkup(off, undefined, { ...n.attrs, page }); done = true; }
          });
          if (done) dispatch?.(tr);
          return done;
        },
      setSectionHeaderFooter:
        (index, hf) =>
        ({ state, tr, dispatch }) => {
          if (index <= 0) return false;
          let k = 0, done = false;
          state.doc.forEach((n, off) => {
            if (n.type.name !== SECTION_BREAK || done) return;
            if (++k === index) { tr.setNodeMarkup(off, undefined, { ...n.attrs, hf }); done = true; }
          });
          if (done) dispatch?.(tr);
          return done;
        },
    };
  },

  addStorage() {
    return { current: (): SectionInfo[] => [] };
  },
});

/** The section break node selected right now, if any. */
export function selectedSectionBreak(state: EditorState): PMNode | null {
  const s = state.selection;
  return s instanceof NodeSelection && s.node.type.name === SECTION_BREAK ? s.node : null;
}
