import type { Editor } from "@tiptap/react";
import type { PainterFormat } from "../state/types";

/** What "Reproduire la mise en forme" copies: the character formatting at the caret and the paragraph alignment. */
export function captureFormat(editor: Editor): PainterFormat {
  const { state } = editor;
  const marks = (state.storedMarks ?? state.selection.$from.marks()).filter((m) => m.type.name !== "link");
  const align = (editor.getAttributes("paragraph").textAlign ?? editor.getAttributes("heading").textAlign ?? null) as string | null;
  return { marks: marks.map((m) => ({ type: m.type.name, attrs: { ...m.attrs } })), align };
}

/** Replaces the formatting of the current selection with the captured one. */
export function applyFormat(editor: Editor, format: PainterFormat): boolean {
  if (editor.state.selection.empty) return false;
  const chain = editor.chain().focus().unsetAllMarks();
  for (const m of format.marks) chain.setMark(m.type, m.attrs);
  if (format.align) chain.setTextAlign(format.align);
  return chain.run();
}
