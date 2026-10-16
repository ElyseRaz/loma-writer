import { Extension, mergeAttributes, Node } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    captions: {
      /** Inserts a caption ("Figure 1 : text") above or below the picture, table, shape or paragraph holding the selection. */
      insertCaption: (options: { label: string; text?: string; position?: "above" | "below" }) => ReturnType;
    };
  }
}

export const DEFAULT_LABELS = ["Figure", "Tableau", "Équation"];
export const MAX_LABEL = 30;

/** A label is one word (it names the numbering sequence in DOCX and ODT). */
export const cleanLabel = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s && s.length <= MAX_LABEL && /^[\p{L}\p{N}_-]+$/u.test(s) ? s : null;
};

/** The number of a caption ("Figure 3"): counts the captions of its label in document order; kept up to date by the plugin below. */
export const SeqField = Node.create({
  name: "seqField",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  addAttributes() {
    return {
      label: { default: "Figure", parseHTML: (el: HTMLElement) => cleanLabel(el.getAttribute("data-seq")) ?? "Figure" },
      n: { default: 1, parseHTML: (el: HTMLElement) => Math.max(1, parseInt(el.textContent ?? "1", 10) || 1) },
    };
  },
  parseHTML: () => [{ tag: "span[data-seq]" }],
  renderHTML: ({ node, HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { "data-seq": String(node.attrs.label), class: "seq-field" }), String(node.attrs.n)],
});

/** Text of a node with the numbers of its numbering fields (a node's own `textContent` leaves atoms out). */
export function textWithSeq(node: PMNode): string {
  return node.textBetween(0, node.content.size, "", (leaf) => (leaf.type.name === "seqField" ? String(leaf.attrs.n) : ""));
}

/** A caption paragraph, in document order. */
export interface CaptionInfo {
  /** Rank among all the captions of the document. */
  index: number;
  label: string;
  text: string;
  pos: number;
}

export function collectCaptions(doc: PMNode, label?: string | null): CaptionInfo[] {
  const out: CaptionInfo[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "tableOfContents") return false;
    if (node.type.name === "paragraph" && typeof node.attrs.caption === "string") {
      if (!label || node.attrs.caption === label) out.push({ index: out.length, label: node.attrs.caption, text: textWithSeq(node).trim(), pos });
    }
    return true;
  });
  return out;
}

const renumberKey = new PluginKey("loma-seq");

/** Caption paragraphs and their numbering. */
export const Captions = Extension.create({
  name: "captions",

  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          // The label of the caption this paragraph is ("Figure", "Tableau"…), null for an ordinary paragraph.
          caption: {
            default: null,
            parseHTML: (el: HTMLElement) => cleanLabel(el.getAttribute("data-caption")),
            renderHTML: (a: Record<string, unknown>) => (typeof a.caption === "string" ? { "data-caption": a.caption } : {}),
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      // Every numbering field takes the rank of its caption among those of its label.
      new Plugin({
        key: renumberKey,
        appendTransaction: (trs, _old, state) => {
          if (!trs.some((t) => t.docChanged)) return null;
          const counts = new Map<string, number>();
          let tr = state.tr;
          let changed = false;
          state.doc.descendants((node, pos) => {
            if (node.type.name !== "seqField") return true;
            const label = String(node.attrs.label);
            const n = (counts.get(label) ?? 0) + 1;
            counts.set(label, n);
            if (node.attrs.n !== n) { tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, n }); changed = true; }
            return false;
          });
          return changed ? tr.setMeta("addToHistory", false) : null;
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      // Enter at the end of a caption goes on with an ordinary paragraph.
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty || $from.parent.type.name !== "paragraph" || typeof $from.parent.attrs.caption !== "string" || $from.parentOffset !== $from.parent.content.size) return false;
        return editor.chain().splitBlock().updateAttributes("paragraph", { caption: null }).run();
      },
    };
  },

  addCommands() {
    return {
      insertCaption:
        ({ label, text, position }) =>
        ({ state, tr, dispatch }) => {
          const name = cleanLabel(label);
          if (!name) return false;
          const { schema, selection } = state;
          // The block the caption goes with: the selected picture / table / shape, or the block holding the caret.
          let from = selection.$from;
          let blockPos: number;
          let blockSize: number;
          let kindOf = "paragraph";
          if (selection instanceof NodeSelection && ["table", "shape", "shapeGroup"].includes(selection.node.type.name)) {
            blockPos = selection.from;
            blockSize = selection.node.nodeSize;
            kindOf = selection.node.type.name;
          } else {
            let depth = from.depth;
            // inside a table: the whole table
            for (let d = from.depth; d > 0; d--) if (from.node(d).type.name === "table") { depth = d; kindOf = "table"; break; }
            if (depth < 1) return false;
            blockPos = from.before(depth);
            blockSize = from.node(depth).nodeSize;
            if (kindOf !== "table") {
              const hasImage = from.node(depth).type.name === "paragraph" && (() => { let f = false; from.node(depth).forEach((c) => { if (c.type.name === "image") f = true; }); return f; })();
              if (hasImage) kindOf = "image";
            }
          }
          // Tables are captioned above, pictures and the rest below (Word's habit).
          const where = position ?? (kindOf === "table" ? "above" : "below");
          const caption = schema.nodes.paragraph.create({ caption: name }, [
            schema.text(`${name} `),
            schema.nodes.seqField.create({ label: name, n: 1 }),
            ...(text?.trim() ? [schema.text(` : ${text.trim()}`)] : []),
          ]);
          const at = where === "above" ? blockPos : blockPos + blockSize;
          tr.insert(at, caption);
          // The caret goes to the end of the caption, ready to type its text.
          tr.setSelection(TextSelection.near(tr.doc.resolve(at + caption.nodeSize - 1), -1));
          dispatch?.(tr.scrollIntoView());
          return true;
        },
    };
  },
});
