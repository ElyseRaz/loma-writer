import { Extension, mergeAttributes, Node } from "@tiptap/core";
import { Fragment, Slice, type Mark, type Node as PMNode, type Schema } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { bodyFromText, bodyOf, bodyText, cleanBody, type NoteParagraph } from "./noteBody";
import { cleanNotesOptions, DEFAULT_NOTES, formatNoteNumber, noteValue, type NotesOptions } from "./notesNumbering";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    notes: {
      /** Inserts a footnote (bottom of the page) or an endnote (end of the document) at the caret, with its text. */
      insertNote: (options: { kind: "foot" | "end"; text?: string; body?: unknown }) => ReturnType;
      /** Changes the text of the note whose reference is at `pos` (plain text, or paragraphs of formatted text). */
      updateNote: (pos: number, content: string | unknown) => ReturnType;
      /** Chooses how the notes are numbered (format, restart, first number). */
      setNotesOptions: (options: NotesOptions) => ReturnType;
    };
  }
}

export type NoteKind = "foot" | "end";
export const MAX_NOTE_TEXT = 4000;

/** Transaction meta that asks the plugins of the references (notes, citations) to bring the document up to date (after it is loaded). */
export const SYNC_META = "lomaSyncReferences";

/** What a note is numbered with when nothing else is chosen: 1, 2, 3 for footnotes, i, ii, iii for endnotes (Word's defaults). */
export const noteLabel = (kind: NoteKind, n: number) => formatNoteNumber(n, kind === "end" ? DEFAULT_NOTES.end.format : DEFAULT_NOTES.foot.format);

export const cleanNoteText = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, MAX_NOTE_TEXT) : "");

/** The numbering options of the notes of the document (they are attributes of the document). */
export const NotesAttributes = Extension.create({
  name: "notesAttributes",
  addGlobalAttributes() {
    return [{ types: ["doc"], attributes: { notes: { default: null } } }];
  },
});

export const notesOptionsOf = (doc: PMNode): NotesOptions => cleanNotesOptions(doc.attrs.notes);

/** The reference of a note in the text: its number. The text of the note (formatted paragraphs) lives in the node. */
export const Footnote = Node.create({
  name: "footnote",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return {
      kind: { default: "foot", parseHTML: (el: HTMLElement) => (el.getAttribute("data-note") === "end" ? "end" : "foot") },
      /** Plain text of the note (kept in step with `body`). */
      text: { default: "", parseHTML: (el: HTMLElement) => cleanNoteText(el.getAttribute("data-text")) },
      /** The note itself: paragraphs of formatted text. */
      body: { default: [], parseHTML: (el: HTMLElement) => { try { return cleanBody(JSON.parse(el.getAttribute("data-body") ?? "[]")); } catch { return []; } } },
      /** Number of the note (after the restarts and the first number of the document's options), and how it is written. */
      n: { default: 1, parseHTML: (el: HTMLElement) => Math.max(1, parseInt(el.getAttribute("data-n") ?? "1", 10) || 1) },
      label: { default: "", parseHTML: (el: HTMLElement) => (el.getAttribute("data-label") ?? "").slice(0, 12) },
    };
  },
  parseHTML: () => [{ tag: "span[data-note]" }],
  renderHTML: ({ node, HTMLAttributes }) => [
    "span",
    mergeAttributes(HTMLAttributes, { class: `note-ref note-${node.attrs.kind}`, "data-note": String(node.attrs.kind), "data-text": String(node.attrs.text), "data-body": JSON.stringify(node.attrs.body ?? []), "data-n": String(node.attrs.n), "data-label": String(node.attrs.label), title: String(node.attrs.text) }),
    String(node.attrs.label || noteLabel(node.attrs.kind as NoteKind, +node.attrs.n)),
  ],
});

/** One endnote of the block at the end of the document (generated from the references). */
export const EndnoteItem = Node.create({
  name: "endnoteItem",
  content: "inline*",
  addAttributes() {
    return {
      n: { default: 1, parseHTML: (el: HTMLElement) => Math.max(1, parseInt(el.getAttribute("data-n") ?? "1", 10) || 1) },
      label: { default: "", parseHTML: (el: HTMLElement) => (el.getAttribute("data-label") ?? "").slice(0, 12) },
    };
  },
  parseHTML: () => [{ tag: "div.endnote-item" }],
  renderHTML: ({ node }) => ["div", { class: "endnote-item", "data-n": String(node.attrs.n), "data-label": String(node.attrs.label || noteLabel("end", +node.attrs.n)) }, 0],
});

/** The endnotes of the document, after the last block (generated: it is not edited by hand). */
export const Endnotes = Node.create({
  name: "endnotes",
  group: "block",
  content: "endnoteItem*",
  defining: true,
  isolating: true,
  selectable: false,
  parseHTML: () => [{ tag: "div.endnotes" }],
  renderHTML: () => ["div", { class: "endnotes", "data-title": "Notes de fin", contenteditable: "false" }, 0],
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

/** The content of an endnote item: the paragraphs of the note joined by line breaks, with their formatting. */
function itemContent(schema: Schema, body: NoteParagraph[]): PMNode[] {
  const out: PMNode[] = [];
  body.forEach((p, i) => {
    if (i > 0) out.push(schema.nodes.hardBreak.create());
    for (const c of p.content) {
      if (c.type === "hardBreak") { out.push(schema.nodes.hardBreak.create()); continue; }
      const marks: Mark[] = [];
      for (const m of c.marks ?? []) {
        const type = schema.marks[m.type];
        if (type) marks.push(m.type === "link" ? type.create({ href: m.attrs?.href }) : type.create());
      }
      if (c.text) out.push(schema.text(c.text, marks));
    }
  });
  return out;
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
          // The generated block of endnotes is never pasted (it would be a second one).
          transformPasted: (slice) => {
            const strip = (f: Fragment): Fragment => {
              const kept: PMNode[] = [];
              f.forEach((n) => { if (n.type.name !== "endnotes") kept.push(n.isLeaf ? n : n.copy(strip(n.content))); });
              return Fragment.fromArray(kept);
            };
            return new Slice(strip(slice.content), slice.openStart, slice.openEnd);
          },
        },
      }),
      // Numbers the references (restarts, first number and format of the options), and keeps the block of endnotes (at the very end
      // of the document) in step with them. Footnotes that restart on each page are numbered by the layout (the page is not known here).
      new Plugin({
        key: syncKey,
        appendTransaction: (trs, _old, state) => {
          if (!trs.some((t) => t.docChanged || t.getMeta(SYNC_META))) return null;
          const { doc, schema } = state;
          const options = notesOptionsOf(doc);
          let tr = state.tr;
          let changed = false;
          const counts = new Map<string, number>();
          let section = 0;
          const endItems: Array<{ body: NoteParagraph[]; n: number; label: string }> = [];
          doc.descendants((node, pos) => {
            if (node.type.name === "sectionBreak") { section++; return false; }
            if (node.type.name === "endnotes") return false;
            if (node.type.name !== "footnote") return true;
            const kind = node.attrs.kind as NoteKind;
            const o = options[kind];
            const key = `${kind}:${o.restart === "section" ? section : 0}`;
            const index = counts.get(key) ?? 0;
            counts.set(key, index + 1);
            const body = bodyOf(node.attrs);
            const text = bodyText(body);
            let n = noteValue(o, index);
            let label = formatNoteNumber(n, o.format);
            // footnotes that restart on each page keep the number the layout gave them (a new one gets a provisional number)
            if (kind === "foot" && o.restart === "page" && node.attrs.label) { n = +node.attrs.n || n; label = String(node.attrs.label); }
            if (kind === "end") endItems.push({ body, n, label });
            const same = node.attrs.n === n && node.attrs.label === label && node.attrs.text === text && JSON.stringify(node.attrs.body) === JSON.stringify(body);
            if (!same) { tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, n, label, text, body }); changed = true; }
            return false;
          });
          // the block of endnotes (all of them but the last are stray copies)
          const blocks: Array<{ pos: number; node: PMNode }> = [];
          doc.forEach((n, off) => { if (n.type.name === "endnotes") blocks.push({ pos: off, node: n }); });
          for (const stray of blocks.slice(0, -1).reverse()) { tr = tr.delete(tr.mapping.map(stray.pos), tr.mapping.map(stray.pos + stray.node.nodeSize)); changed = true; }
          const ex = blocks.length ? blocks[blocks.length - 1] : null;
          const items = endItems.map((it) => schema.nodes.endnoteItem.create({ n: it.n, label: it.label }, itemContent(schema, it.body)));
          const same = (node: PMNode) => node.childCount === items.length && items.every((it, i) => it.eq(node.child(i)));
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
        ({ kind, text, body }) =>
        ({ state, tr, dispatch }) => {
          const b = body ? cleanBody(body) : bodyFromText(cleanNoteText(text));
          const node = state.schema.nodes.footnote.create({ kind, text: bodyText(b), body: b, n: 1, label: "" });
          dispatch?.(tr.replaceSelectionWith(node, false).scrollIntoView());
          return true;
        },
      updateNote:
        (pos, content) =>
        ({ state, tr, dispatch }) => {
          const node = state.doc.nodeAt(pos);
          if (!node || node.type.name !== "footnote") return false;
          const b = typeof content === "string" ? bodyFromText(cleanNoteText(content)) : cleanBody(content);
          dispatch?.(tr.setNodeMarkup(pos, undefined, { ...node.attrs, text: bodyText(b), body: b }));
          return true;
        },
      setNotesOptions:
        (options) =>
        ({ tr, dispatch }) => {
          dispatch?.(tr.setDocAttribute("notes", cleanNotesOptions(options)));
          return true;
        },
    };
  },
});
