import { createDocument } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import type { Editor, JSONContent } from "@tiptap/react";

/**
 * Replaces the whole document and resets the undo history, so that Ctrl+Z can never
 * "undo" back into the previously opened document. Does not mark the document dirty.
 */
export function loadContent(editor: Editor, content: string | JSONContent): void {
  const doc = createDocument(content, editor.schema);
  editor.view.updateState(EditorState.create({ doc, plugins: editor.state.plugins }));
  // Notify subscribers (word count, toolbar state). No doc change, so `update` does not fire.
  editor.view.dispatch(editor.state.tr.setMeta("addToHistory", false));
}
