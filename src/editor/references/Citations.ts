import { Extension, mergeAttributes, Node } from "@tiptap/core";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { SYNC_META } from "./Notes";
import { citationText, cleanSources, entrySegments, isCitationStyle, sortKey, type CitationStyle, type Source } from "./sources";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    citations: {
      /** Inserts a citation of the source `tag` at the caret (`page` is the optional page or location). */
      insertCitation: (options: { tag: string; page?: string }) => ReturnType;
      /** Replaces the sources of the document. */
      setSources: (sources: Source[]) => ReturnType;
      setCitationStyle: (style: CitationStyle) => ReturnType;
      /** Inserts the bibliography (the cited sources, or every source) after the block holding the caret. */
      insertBibliography: (options?: { mode?: "cited" | "all"; title?: string }) => ReturnType;
      removeBibliography: () => ReturnType;
    };
  }
}

export const DEFAULT_BIBLIOGRAPHY_TITLE = "Bibliographie";

export const sourcesOf = (doc: PMNode): Source[] => cleanSources(doc.attrs.sources);
export const styleOf = (doc: PMNode): CitationStyle => (isCitationStyle(doc.attrs.citationStyle) ? doc.attrs.citationStyle : "apa");

/** The sources and the style of the citations live in the document itself (so every format and undo carry them). */
export const SourcesAttributes = Extension.create({
  name: "sourcesAttributes",
  addGlobalAttributes() {
    return [{ types: ["doc"], attributes: { sources: { default: [] }, citationStyle: { default: "apa" } } }];
  },
});

/** A citation in the text: "(Dupont, 2020)", written from its source and the style of the document. */
export const Citation = Node.create({
  name: "citation",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return {
      tag: { default: "", parseHTML: (el: HTMLElement) => (el.getAttribute("data-tag") ?? "").replace(/[^\p{L}\p{N}_.:-]/gu, "").slice(0, 60) },
      page: { default: "", parseHTML: (el: HTMLElement) => (el.getAttribute("data-page") ?? "").slice(0, 40) },
      text: { default: "", parseHTML: (el: HTMLElement) => (el.textContent ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, 120) },
    };
  },
  parseHTML: () => [{ tag: "span.citation" }],
  renderHTML: ({ node, HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { class: "citation", "data-tag": String(node.attrs.tag), ...(node.attrs.page ? { "data-page": String(node.attrs.page) } : {}) }), String(node.attrs.text || "()")],
});

/** One entry of the bibliography (generated). */
export const BibEntry = Node.create({
  name: "bibEntry",
  content: "inline*",
  parseHTML: () => [{ tag: "div.bib-entry" }],
  renderHTML: () => ["div", { class: "bib-entry" }, 0],
});

export const Bibliography = Node.create({
  name: "bibliography",
  group: "block",
  content: "bibEntry*",
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      title: { default: DEFAULT_BIBLIOGRAPHY_TITLE, parseHTML: (el: HTMLElement) => (el.getAttribute("data-title") ?? DEFAULT_BIBLIOGRAPHY_TITLE).slice(0, 120) },
      mode: { default: "cited", parseHTML: (el: HTMLElement) => (el.getAttribute("data-mode") === "all" ? "all" : "cited") },
    };
  },
  parseHTML: () => [{ tag: "div.bibliography" }],
  renderHTML: ({ node }) => ["div", { class: "bibliography", "data-title": String(node.attrs.title), "data-mode": String(node.attrs.mode) }, 0],
});

/** The cited sources in order of first citation (tags without a source are left out). */
export function citedSources(doc: PMNode, sources: Source[]): Source[] {
  const byTag = new Map(sources.map((s) => [s.tag, s]));
  const seen = new Set<string>();
  const out: Source[] = [];
  doc.descendants((n) => {
    if (n.type.name === "bibliography") return false;
    if (n.type.name === "citation" && !seen.has(String(n.attrs.tag))) { seen.add(String(n.attrs.tag)); const s = byTag.get(String(n.attrs.tag)); if (s) out.push(s); }
    return true;
  });
  return out;
}

/** The entries of a bibliography, ready to be put in the document. */
export function bibliographyEntries(schema: Schema, doc: PMNode, mode: "cited" | "all", sources: Source[], style: CitationStyle): PMNode[] {
  const cited = citedSources(doc, sources);
  const list = mode === "all" ? (style === "numeric" ? [...cited, ...sources.filter((s) => !cited.includes(s))] : [...sources]) : cited;
  const ordered = style === "numeric" ? list : [...list].sort((a, b) => sortKey(a).localeCompare(sortKey(b), "fr"));
  const italic = schema.marks.italic;
  return ordered.map((s) => {
    const order = Math.max(1, (style === "numeric" ? ordered : cited).indexOf(s) + 1);
    const content = entrySegments(s, style, order).map((p) => schema.text(p.text, p.italic && italic ? [italic.create()] : undefined));
    return schema.nodes.bibEntry.create(null, content);
  });
}

const syncKey = new PluginKey("loma-citations");

export const Citations = Extension.create({
  name: "citations",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            // A double-click on a citation opens its source.
            dblclick: (_view, event) => {
              const el = (event.target as HTMLElement | null)?.closest?.(".citation");
              if (!el) return false;
              window.dispatchEvent(new CustomEvent("loma:edit-source", { detail: { tag: el.getAttribute("data-tag") ?? "" } }));
              return true;
            },
          },
        },
      }),
      // Keeps the text of the citations and the bibliography in step with the sources, the style and the citations.
      new Plugin({
        key: syncKey,
        appendTransaction: (trs, _old, state) => {
          if (!trs.some((t) => t.docChanged || t.getMeta(SYNC_META))) return null;
          const { doc, schema } = state;
          const sources = sourcesOf(doc);
          const style = styleOf(doc);
          const byTag = new Map(sources.map((s) => [s.tag, s]));
          const cited = citedSources(doc, sources);
          let tr = state.tr;
          let changed = false;
          const biblios: Array<{ pos: number; node: PMNode }> = [];
          doc.descendants((node, pos) => {
            if (node.type.name === "bibliography") { biblios.push({ pos, node }); return false; }
            if (node.type.name !== "citation") return true;
            const s = byTag.get(String(node.attrs.tag));
            const text = citationText(s, style, String(node.attrs.page ?? ""), s ? cited.indexOf(s) + 1 : 0);
            if (node.attrs.text !== text) { tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, text }); changed = true; }
            return false;
          });
          for (const { pos, node } of biblios.reverse()) {
            const fresh = bibliographyEntries(schema, doc, node.attrs.mode === "all" ? "all" : "cited", sources, style);
            if (fresh.length === node.childCount && fresh.every((n, i) => n.eq(node.child(i)))) continue;
            tr = tr.replaceWith(tr.mapping.map(pos) + 1, tr.mapping.map(pos + node.nodeSize) - 1, fresh);
            changed = true;
          }
          return changed ? tr.setMeta("addToHistory", false) : null;
        },
      }),
    ];
  },

  onCreate() {
    if (this.editor.isDestroyed) return;
    this.editor.view.dispatch(this.editor.state.tr.setMeta(SYNC_META, true).setMeta("addToHistory", false));
  },

  addCommands() {
    return {
      insertCitation:
        ({ tag, page }) =>
        ({ state, tr, dispatch }) => {
          if (!sourcesOf(state.doc).some((s) => s.tag === tag)) return false;
          dispatch?.(tr.replaceSelectionWith(state.schema.nodes.citation.create({ tag, page: (page ?? "").slice(0, 40), text: "" }), false).scrollIntoView());
          return true;
        },
      setSources:
        (sources) =>
        ({ tr, dispatch }) => {
          dispatch?.(tr.setDocAttribute("sources", cleanSources(sources)));
          return true;
        },
      setCitationStyle:
        (style) =>
        ({ tr, dispatch }) => {
          if (!isCitationStyle(style)) return false;
          dispatch?.(tr.setDocAttribute("citationStyle", style));
          return true;
        },
      insertBibliography:
        (options) =>
        ({ state, tr, dispatch }) => {
          const { schema, doc, selection } = state;
          const mode = options?.mode === "all" ? "all" : "cited";
          const node = schema.nodes.bibliography.create({ mode, title: options?.title?.trim() || DEFAULT_BIBLIOGRAPHY_TITLE }, bibliographyEntries(schema, doc, mode, sourcesOf(doc), styleOf(doc)));
          const $from = selection.$from;
          const at = $from.depth >= 1 ? $from.after(1) : $from.pos;
          dispatch?.(tr.insert(at, node).scrollIntoView());
          return true;
        },
      removeBibliography:
        () =>
        ({ state, tr, dispatch }) => {
          let found: { pos: number; size: number } | null = null;
          state.doc.descendants((n, pos) => { if (n.type.name === "bibliography" && !found) found = { pos, size: n.nodeSize }; return n.type.name !== "bibliography"; });
          if (!found) return false;
          const { pos, size } = found as { pos: number; size: number };
          dispatch?.(tr.delete(pos, pos + size));
          return true;
        },
    };
  },
});
