import { Extension, mergeAttributes, Node } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { formatPageNumber } from "../../pagination/pageNumber";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    notes: {
      /** Inserts a footnote (bottom of the page) or an endnote (end of the document) at the caret, with its text. */
      insertNote: (options: { kind: "foot" | "end"; text?: string }) => ReturnType;
      /** Changes the text of the note whose reference is at `pos`. */
      updateNote: (pos: number, text: string) => ReturnType;
    };
  }
}

export type NoteKind = "foot" | "end";
export const MAX_NOTE_TEXT = 2000;

/** Transaction meta that asks the plugins of the references (notes, citations) to bring the document up to date (after it is loaded). */
export const SYNC_META = "lomaSyncReferences";

/** What a note is numbered with: 1, 2, 3 for footnotes, i, ii, iii for endnotes (Word's defaults). */
export const noteLabel = (kind: NoteKind, n: number) => (kind === "end" ? formatPageNumber(n, "lowerRoman") : String(n));

export const cleanNoteText = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, MAX_NOTE_TEXT) : "");

/** The reference of a note in the text: a raised number. Its text lives in the node (plain text, one paragraph). */
export const Footnote = Node.create({
  name: "footnote",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return {
      kind: { default: "foot", parseHTML: (el: HTMLElement) => (el.getAttribute("data-note") === "end" ? "end" : "foot") },
      text: { default: "", parseHTML: (el: HTMLElement) => cleanNoteText(el.getAttribute("data-text")) },
      /** Rank among the notes of its kind (kept up to date by the plugin below). */
      n: { default: 1, parseHTML: (el: HTMLElement) => Math.max(1, parseInt(el.getAttribute("data-n") ?? "1", 10) || 1) },
    };
  },
  parseHTML: () => [{ tag: "span[data-note]" }],
  renderHTML: ({ node, HTMLAttributes }) => [
    "span",
    mergeAttributes(HTMLAttributes, { class: `note-ref note-${node.attrs.kind}`, "data-note": String(node.attrs.kind), "data-text": String(node.attrs.text), "data-n": String(node.attrs.n), title: String(node.attrs.text) }),
    noteLabel(node.attrs.kind as NoteKind, +node.attrs.n),
  ],
});

/** One endnote of the block at the end of the document (generated from the references). */
export const EndnoteItem = Node.create({
  name: "endnoteItem",
  content: "inline*",
  addAttributes() {
    return { n: { default: 1, parseHTML: (el: HTMLElement) => Math.max(1, parseInt(el.getAttribute("data-n") ?? "1", 10) || 1) } };
  },
  parseHTML: () => [{ tag: "div.endnote-item" }],
  renderHTML: ({ node }) => ["div", { class: "endnote-item", "data-n": String(node.attrs.n), "data-label": noteLabel("end", +node.attrs.n) }, 0],
});

/** The endnotes of the document, after the last block. */
export const Endnotes = Node.create({
  name: "endnotes",
  group: "block",
  content: "endnoteItem*",
  defining: true,
  isolating: true,
  parseHTML: () => [{ tag: "div.endnotes" }],
  renderHTML: () => ["div", { class: "endnotes", "data-title": "Notes de fin" }, 0],
});

/** The notes of a kind, in document order (the endnotes block itself is not searched). */
export function collectNotes(doc: PMNode, kind: NoteKind): Array<{ pos: number; text: string; n: number }> {
  const out: Array<{ pos: number; text: string; n: number }> = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "endnotes") return false;
    if (node.type.name === "footnote" && node.attrs.kind === kind) out.push({ pos, text: String(node.attrs.text ?? ""), n: out.length + 1 });
    return true;
  });
  return out;
}

/** True when nothing but empty paragraphs follows the position. */
function onlyEmptyAfter(doc: PMNode, from: number): boolean {
  let ok = true;
  doc.nodesBetween(from, doc.content.size, (n, pos) => { if (pos >= from && !(n.type.name === "paragraph" && n.content.size === 0)) ok = false; return false; });
  return ok;
}

const syncKey = new PluginKey("loma-notes");

export const Notes = Extension.create({
  name: "notes",

  // A document created with notes (opened from a file) gets its numbers and its block of endnotes at once.
  onCreate() {
    if (this.editor.isDestroyed) return;
    this.editor.view.dispatch(this.editor.state.tr.setMeta(SYNC_META, true).setMeta("addToHistory", false));
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            dblclick: (view, event) => {
              const el = (event.target as HTMLElement | null)?.closest?.(".note-ref");
              if (!el) return false;
              window.dispatchEvent(new CustomEvent("loma:edit-note", { detail: { pos: view.posAtDOM(el, 0) } }));
              return true;
            },
          },
        },
      }),
      // Numbers the references, and keeps the block of endnotes (at the very end of the document) in step with them.
      new Plugin({
        key: syncKey,
        appendTransaction: (trs, _old, state) => {
          if (!trs.some((t) => t.docChanged || t.getMeta(SYNC_META))) return null;
          const { doc, schema } = state;
          let tr = state.tr;
          let changed = false;
          const counts = { foot: 0, end: 0 } as Record<NoteKind, number>;
          const endTexts: string[] = [];
          doc.descendants((node, pos) => {
            if (node.type.name === "endnotes") return false;
            if (node.type.name !== "footnote") return true;
            const kind = node.attrs.kind as NoteKind;
            const n = ++counts[kind];
            if (kind === "end") endTexts.push(String(node.attrs.text ?? ""));
            if (node.attrs.n !== n) { tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, n }); changed = true; }
            return false;
          });
          // the block of endnotes
          let existing: { pos: number; node: PMNode } | null = null;
          doc.forEach((n, off) => { if (n.type.name === "endnotes") existing = { pos: off, node: n }; });
          const items = endTexts.map((text, i) => schema.nodes.endnoteItem.create({ n: i + 1 }, text ? schema.text(text) : undefined));
          const same = (node: PMNode) => node.childCount === items.length && items.every((it, i) => it.eq(node.child(i)));
          const ex = existing as { pos: number; node: PMNode } | null;
          if (!items.length) {
            if (ex) { tr = tr.delete(tr.mapping.map(ex.pos), tr.mapping.map(ex.pos + ex.node.nodeSize)); changed = true; }
          } else if (!ex) {
            tr = tr.insert(tr.doc.content.size, schema.nodes.endnotes.create(null, items));
            changed = true;
          } else if (!same(ex.node)) {
            const from = tr.mapping.map(ex.pos) + 1;
            tr = tr.replaceWith(from, from + ex.node.content.size, items);
            changed = true;
          } else if (!onlyEmptyAfter(doc, ex.pos + ex.node.nodeSize)) {
            // text was added after it: put it back at the end (an empty paragraph after it is fine: the editor keeps one there)
            tr = tr.delete(tr.mapping.map(ex.pos), tr.mapping.map(ex.pos + ex.node.nodeSize));
            tr = tr.insert(tr.doc.content.size, ex.node);
            changed = true;
          }
          return changed ? tr.setMeta("addToHistory", false) : null;
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    const ask = (kind: NoteKind) => () => { window.dispatchEvent(new CustomEvent("loma:insert-note", { detail: { kind } })); return true; };
    return { "Mod-Alt-f": ask("foot"), "Mod-Alt-d": ask("end") };
  },

  addCommands() {
    return {
      insertNote:
        ({ kind, text }) =>
        ({ state, tr, dispatch }) => {
          const node = state.schema.nodes.footnote.create({ kind, text: cleanNoteText(text), n: 1 });
          dispatch?.(tr.replaceSelectionWith(node, false).scrollIntoView());
          return true;
        },
      updateNote:
        (pos, text) =>
        ({ state, tr, dispatch }) => {
          const node = state.doc.nodeAt(pos);
          if (!node || node.type.name !== "footnote") return false;
          dispatch?.(tr.setNodeMarkup(pos, undefined, { ...node.attrs, text: cleanNoteText(text) }));
          return true;
        },
    };
  },
});
