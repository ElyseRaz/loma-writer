import { Extension, mergeAttributes, Node } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import katex from "katex";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    bookmarkNode: {
      /** Inserts an invisible named anchor at the caret (an existing bookmark of that name moves here). */
      insertBookmark: (name: string) => ReturnType;
      removeBookmark: (name: string) => ReturnType;
    };
    equationNode: {
      insertEquation: (latex: string) => ReturnType;
      /** Changes the formula of the equation at `pos`. */
      updateEquation: (pos: number, latex: string) => ReturnType;
    };
  }
}

/** A named anchor ("Signet"): the target of cross-references. Invisible unless formatting marks are shown. */
export const Bookmark = Node.create({
  name: "bookmark",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  addAttributes() {
    return { name: { default: "" } };
  },
  parseHTML: () => [{ tag: "span[data-bookmark]", getAttrs: (el) => ({ name: (el as HTMLElement).getAttribute("data-bookmark") ?? "" }) }],
  renderHTML: ({ node, HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { "data-bookmark": node.attrs.name, class: "bookmark", title: `Signet : ${node.attrs.name}` })],
  addCommands() {
    return {
      insertBookmark:
        (name) =>
        ({ commands, editor }) => {
          // A bookmark name is unique: moving it is what a user means by reusing a name.
          let existing: number | null = null;
          editor.state.doc.descendants((n, pos) => { if (n.type.name === "bookmark" && n.attrs.name === name) existing = pos; });
          if (existing !== null) editor.commands.removeBookmark(name);
          return commands.insertContent({ type: this.name, attrs: { name } });
        },
      removeBookmark:
        (name) =>
        ({ tr, state, dispatch }) => {
          const spots: number[] = [];
          state.doc.descendants((n, pos) => { if (n.type.name === "bookmark" && n.attrs.name === name) spots.push(pos); });
          for (const pos of spots.reverse()) tr.delete(pos, pos + 1);
          if (dispatch && spots.length) dispatch(tr);
          return spots.length > 0;
        },
    };
  },
});

const renderMath = (el: HTMLElement, latex: string) => {
  try {
    katex.render(latex, el, { throwOnError: false, displayMode: false, output: "html" });
  } catch {
    el.textContent = latex;
  }
};

/** Inline formula typed in LaTeX and drawn with KaTeX. */
export const Equation = Node.create({
  name: "equation",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return { latex: { default: "" } };
  },
  parseHTML: () => [{ tag: "span[data-equation]", getAttrs: (el) => ({ latex: (el as HTMLElement).getAttribute("data-equation") ?? "" }) }],
  renderHTML: ({ node, HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { "data-equation": node.attrs.latex, class: "equation" }), node.attrs.latex],
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("span");
      dom.className = "equation";
      dom.contentEditable = "false";
      dom.setAttribute("data-equation", node.attrs.latex);
      dom.title = "Double-clic pour modifier";
      renderMath(dom, node.attrs.latex);
      return {
        dom,
        update: (updated) => {
          if (updated.type.name !== "equation") return false;
          dom.setAttribute("data-equation", updated.attrs.latex);
          renderMath(dom, updated.attrs.latex);
          return true;
        },
      };
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            dblclick: (view, event) => {
              const el = (event.target as HTMLElement | null)?.closest?.("[data-equation]");
              if (!el) return false;
              const pos = view.posAtDOM(el, 0);
              window.dispatchEvent(new CustomEvent("loma:edit-equation", { detail: { pos } }));
              return true;
            },
          },
        },
      }),
    ];
  },
  addCommands() {
    return {
      insertEquation: (latex) => ({ commands }) => commands.insertContent({ type: this.name, attrs: { latex } }),
      updateEquation:
        (pos, latex) =>
        ({ tr, state, dispatch }) => {
          const node = state.doc.nodeAt(pos);
          if (!node || node.type.name !== "equation") return false;
          tr.setNodeMarkup(pos, undefined, { latex });
          dispatch?.(tr);
          return true;
        },
    };
  },
});

/** Ctrl+click on a cross-reference (a link to "#bookmark") jumps to the bookmark. */
export const InternalLinks = Extension.create({
  name: "internalLinks",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleClick: (_view, _pos, event) => {
            if (!(event.ctrlKey || event.metaKey)) return false;
            const a = (event.target as HTMLElement | null)?.closest?.("a[href^='#']");
            if (!a) return false;
            const name = decodeURIComponent(a.getAttribute("href")!.slice(1));
            window.dispatchEvent(new CustomEvent("loma:goto-bookmark", { detail: { name } }));
            return true;
          },
        },
      }),
    ];
  },
});
