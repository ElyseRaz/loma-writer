import { cleanLayout, DEFAULT_LAYOUT, type ParagraphLayout } from "./ParagraphFormat";
import { useEditorState, type Editor } from "@tiptap/react";

export interface EditorSnapshot {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  subscript: boolean;
  superscript: boolean;
  highlight: boolean;
  bulletList: boolean;
  orderedList: boolean;
  /** Marker style of the list around the cursor (null = default). */
  listType: string | null;
  blockquote: boolean;
  codeBlock: boolean;
  link: boolean;
  align: "left" | "center" | "right" | "justify";
  heading: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  fontFamily: string | null;
  fontSize: string | null;
  color: string | null;
  lineHeight: string | null;
  /** Layout of the paragraph holding the cursor (indents, spacing, page flow). */
  layout: ParagraphLayout;
  canUndo: boolean;
  canRedo: boolean;
  inTable: boolean;
  hasSelection: boolean;
  words: number;
  characters: number;
}

const EMPTY: EditorSnapshot = {
  bold: false, italic: false, underline: false, strike: false, subscript: false, superscript: false, highlight: false,
  bulletList: false, orderedList: false, listType: null, blockquote: false, codeBlock: false, link: false,
  align: "left", heading: 0, fontFamily: null, fontSize: null, color: null, lineHeight: null, layout: DEFAULT_LAYOUT,
  canUndo: false, canRedo: false, inTable: false, hasSelection: false, words: 0, characters: 0,
};

/** Reactive view of the editor state; re-renders only when one of these values changes. */
export function useEditorSnapshot(editor: Editor | null): EditorSnapshot {
  return (
    useEditorState({
      editor,
      selector: ({ editor: e }): EditorSnapshot => {
        if (!e) return EMPTY;
        const ts = e.getAttributes("textStyle") as Record<string, string | undefined>;
        const alignAttr = (e.getAttributes("paragraph").textAlign ?? e.getAttributes("heading").textAlign ?? "left") as EditorSnapshot["align"];
        const level = [1, 2, 3, 4, 5, 6].find((l) => e.isActive("heading", { level: l })) ?? 0;
        const count = e.storage.characterCount as { words: () => number; characters: () => number };
        return {
          bold: e.isActive("bold"), italic: e.isActive("italic"), underline: e.isActive("underline"), strike: e.isActive("strike"),
          subscript: e.isActive("subscript"), superscript: e.isActive("superscript"), highlight: e.isActive("highlight"),
          bulletList: e.isActive("bulletList"), orderedList: e.isActive("orderedList"), listType: ((e.getAttributes("bulletList").listType ?? e.getAttributes("orderedList").listType) as string | undefined) ?? null, blockquote: e.isActive("blockquote"),
          codeBlock: e.isActive("codeBlock"), link: e.isActive("link"),
          align: alignAttr, heading: level as EditorSnapshot["heading"],
          layout: cleanLayout({ ...(e.state.selection.$from.parent.attrs as object) }),
          fontFamily: ts.fontFamily ?? null, fontSize: ts.fontSize ?? null, color: ts.color ?? null, lineHeight: ts.lineHeight ?? null,
          canUndo: e.can().undo(), canRedo: e.can().redo(), inTable: e.isActive("table"),
          hasSelection: !e.state.selection.empty,
          words: count.words(), characters: count.characters(),
        };
      },
    }) ?? EMPTY
  );
}
