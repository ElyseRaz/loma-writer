import { Extension, mergeAttributes, Node } from "@tiptap/core";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import { collectCaptions } from "./Captions";
import { captionLines, collectHeadings, DEFAULT_TOC_TITLE, entryNodes, headingLines, MAX_TOC_LEVEL } from "./tocBuild";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    tableOfContents: {
      /** Inserts a table of contents (headings down to `levels`) after the block holding the caret. */
      insertTableOfContents: (options?: { levels?: number; title?: string; kind?: "headings" | "captions"; label?: string }) => ReturnType;
      /** Rebuilds every table of contents from the headings and the current pages. */
      updateTableOfContents: () => ReturnType;
      /** Removes the table of contents holding the caret (or the first one). */
      removeTableOfContents: () => ReturnType;
    };
  }
}

/** The page label of a document position, set by the page (it knows the numbering of the sections). */
export interface ReferencesStorage {
  labelAt: (pos: number) => string;
}

/** Title of the list of the captions of a label. */
export const captionsTitle = (label: string) => (label === "Figure" ? "Table des figures" : label === "Tableau" ? "Table des tableaux" : label === "Équation" ? "Table des équations" : `Table : ${label}`);

export const clampLevels = (v: unknown) => Math.min(MAX_TOC_LEVEL, Math.max(1, Math.trunc(Number(v)) || MAX_TOC_LEVEL));

/** One line of a table of contents: the text of a heading, a dotted leader and its page number (drawn by the stylesheet). */
export const TocEntry = Node.create({
  name: "tocEntry",
  content: "inline*",
  defining: true,
  addAttributes() {
    return {
      level: { default: 1, parseHTML: (el: HTMLElement) => clampLevels(el.getAttribute("data-level")) },
      /** Rank of the heading the line points at (Ctrl+click goes there). */
      target: { default: null, parseHTML: (el: HTMLElement) => { const v = el.getAttribute("data-target"); return v !== null && /^\d+$/.test(v) ? +v : null; } },
      page: { default: "", parseHTML: (el: HTMLElement) => (el.getAttribute("data-page") ?? "").slice(0, 12) },
    };
  },
  parseHTML: () => [{ tag: "div.toc-entry" }],
  renderHTML: ({ node }) => ["div", { class: "toc-entry", "data-level": String(node.attrs.level), "data-page": String(node.attrs.page ?? ""), ...(node.attrs.target !== null ? { "data-target": String(node.attrs.target) } : {}) }, 0],
});

/** Table of contents: lines generated from the headings, kept in the document so that every format can carry them. */
export const TableOfContents = Node.create({
  name: "tableOfContents",
  group: "block",
  content: "tocEntry*",
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      levels: { default: MAX_TOC_LEVEL, parseHTML: (el: HTMLElement) => clampLevels(el.getAttribute("data-levels")) },
      kind: { default: "headings", parseHTML: (el: HTMLElement) => el.getAttribute("data-kind") ?? "headings" },
      title: { default: DEFAULT_TOC_TITLE, parseHTML: (el: HTMLElement) => (el.getAttribute("data-title") ?? DEFAULT_TOC_TITLE).slice(0, 120) },
      /** Captions only: the label of the list ("Figure", "Tableau"…). */
      label: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute("data-label") },
    };
  },
  parseHTML: () => [{ tag: "div.toc" }],
  renderHTML: ({ node, HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { class: "toc", "data-toc": "", "data-levels": String(node.attrs.levels), "data-kind": String(node.attrs.kind), "data-title": String(node.attrs.title), ...(node.attrs.label ? { "data-label": String(node.attrs.label) } : {}) }), 0],

  addCommands() {
    const build = (editor: import("@tiptap/core").Editor, levels: unknown, kind: unknown = "headings", label: unknown = null) => {
      const labelAt = (editor.storage as unknown as { references?: ReferencesStorage }).references?.labelAt ?? (() => "");
      const lines = kind === "captions" && typeof label === "string"
        ? captionLines(collectCaptions(editor.state.doc, label), labelAt)
        : headingLines(collectHeadings(editor.state.doc), clampLevels(levels), labelAt);
      return entryNodes(editor.schema, lines);
    };
    return {
      insertTableOfContents:
        (options) =>
        ({ editor, state, tr, dispatch }) => {
          const levels = clampLevels(options?.levels);
          const kind = options?.kind === "captions" && options.label ? "captions" : "headings";
          const label = kind === "captions" ? options!.label! : null;
          const title = options?.title?.trim() || (kind === "captions" ? captionsTitle(label!) : DEFAULT_TOC_TITLE);
          const filled = state.schema.nodes.tableOfContents.create({ levels, kind, label, title }, build(editor, levels, kind, label));
          // After the block holding the caret (or replacing an empty one).
          const $from = state.selection.$from;
          const depth = Math.max(1, $from.depth);
          const at = $from.parent.content.size === 0 && $from.depth === 1 ? $from.before(1) : $from.after(depth > 1 ? 1 : depth);
          const replaceEmpty = $from.parent.content.size === 0 && $from.depth === 1;
          if (replaceEmpty) tr.replaceWith(at, at + $from.parent.nodeSize, [filled, state.schema.nodes.paragraph.create()]);
          else tr.insert(at, filled);
          dispatch?.(tr.scrollIntoView());
          // The table itself moves the text: its page numbers are corrected once the new layout is known.
          setTimeout(() => { if (!editor.isDestroyed) editor.commands.updateTableOfContents(); }, 450);
          setTimeout(() => { if (!editor.isDestroyed) editor.commands.updateTableOfContents(); }, 1100);
          return true;
        },
      updateTableOfContents:
        () =>
        ({ editor, state, tr, dispatch }) => {
          const targets: Array<{ pos: number; node: import("@tiptap/pm/model").Node }> = [];
          state.doc.descendants((node, pos) => {
            if (node.type.name === "tableOfContents") targets.push({ pos, node });
            return node.type.name !== "tableOfContents";
          });
          if (!targets.length) return false;
          let changed = false;
          for (const { pos, node } of targets.reverse()) {
            const fresh = build(editor, node.attrs.levels, node.attrs.kind, node.attrs.label);
            const same = fresh.length === node.childCount && fresh.every((n, i) => n.eq(node.child(i)));
            if (same) continue;
            tr.replaceWith(pos + 1, pos + node.nodeSize - 1, fresh);
            changed = true;
          }
          if (changed) dispatch?.(tr.setMeta("addToHistory", true));
          return true;
        },
      removeTableOfContents:
        () =>
        ({ state, tr, dispatch }) => {
          let found: { pos: number; size: number } | null = null;
          const head = state.selection.head;
          state.doc.descendants((node, pos) => {
            if (node.type.name !== "tableOfContents") return true;
            if (!found || (head >= pos && head <= pos + node.nodeSize)) found = { pos, size: node.nodeSize };
            return false;
          });
          if (!found) return false;
          const { pos, size } = found as { pos: number; size: number };
          dispatch?.(tr.delete(pos, pos + size));
          return true;
        },
    };
  },
  addProseMirrorPlugins() {
    return [
      // Ctrl+click on a line goes to its heading.
      new Plugin({
        props: {
          handleClick: (view, pos, event) => {
            if (!(event.ctrlKey || event.metaKey)) return false;
            const $pos = view.state.doc.resolve(pos);
            for (let d = $pos.depth; d > 0; d--) {
              const n = $pos.node(d);
              if (n.type.name !== "tocEntry" || typeof n.attrs.target !== "number") continue;
              const toc = $pos.node(d - 1);
              const target = toc.attrs.kind === "captions" ? collectCaptions(view.state.doc, String(toc.attrs.label ?? ""))[n.attrs.target as number] : collectHeadings(view.state.doc)[n.attrs.target as number];
              if (!target) return false;
              view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(target.pos + 1))).scrollIntoView());
              view.focus();
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});

/** Storage of the references: the page label of a position. */
export const References = Extension.create({
  name: "references",
  addStorage(): ReferencesStorage {
    return { labelAt: () => "" };
  },
});
