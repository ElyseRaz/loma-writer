import { mergeAttributes, Node } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    pageBreak: {
      /** Inserts a manual page break: the following content starts on a new page. */
      insertPageBreak: () => ReturnType;
    };
    columnBreak: {
      /** Inserts a column break: the following content starts in the next column (on a new page in a section with one column). */
      insertColumnBreak: () => ReturnType;
    };
  }
}

/** Manual page break. A block atom, so it survives every edit and maps 1:1 to DOCX/ODT page breaks. */
export const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: "div[data-page-break]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-page-break": "", class: "page-break", contenteditable: "false" }), ["span", "Saut de page"]],
  addCommands() {
    return {
      insertPageBreak:
        () =>
        ({ commands }) =>
          commands.insertContent([{ type: this.name }, { type: "paragraph" }]),
    };
  },
  addKeyboardShortcuts() {
    return { "Mod-Enter": () => this.editor.commands.insertPageBreak() };
  },
});

/** Manual column break (Word: Ctrl+Maj+Entrée). In a section with several columns the text goes on in the next column; elsewhere it behaves like a page break. */
export const ColumnBreak = Node.create({
  name: "columnBreak",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: "div[data-column-break]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-column-break": "", class: "page-break column-break", contenteditable: "false" }), ["span", "Saut de colonne"]],
  addCommands() {
    return {
      insertColumnBreak:
        () =>
        ({ commands }) =>
          commands.insertContent([{ type: this.name }, { type: "paragraph" }]),
    };
  },
  addKeyboardShortcuts() {
    return { "Mod-Shift-Enter": () => this.editor.commands.insertColumnBreak() };
  },
});
