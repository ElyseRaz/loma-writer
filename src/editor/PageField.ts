import { mergeAttributes, Node } from "@tiptap/core";

/** Page number or page count inside a header/footer. Shown as a chip while editing, as digits on the page. */
export const PageField = Node.create({
  name: "pageField",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return { kind: { default: "page" } };
  },
  parseHTML: () => [{ tag: "span[data-page-field]", getAttrs: (el) => ({ kind: (el as HTMLElement).getAttribute("data-page-field") === "pages" ? "pages" : "page" }) }],
  renderHTML: ({ node, HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { "data-page-field": node.attrs.kind, class: "page-field" }), node.attrs.kind === "pages" ? "N" : "n°"],
});
