import { useEditorState, type Editor } from "@tiptap/react";
import { paginationKey } from "./extension";

export interface PageInfo {
  /** Number of pages computed by the pagination engine. */
  total: number;
  /** Page containing the caret (1-based). */
  current: number;
}

/** Page count and caret page, read from the real pagination (not from the height of the document). */
export function usePageInfo(editor: Editor | null, pitch: number): PageInfo {
  return (
    useEditorState({
      editor,
      selector: ({ editor: e }): PageInfo => {
        if (!e) return { total: 1, current: 1 };
        const total = paginationKey.getState(e.state)?.pages ?? 1;
        try {
          const root = e.view.dom;
          if (root.getClientRects().length === 0) return { total, current: 1 };
          const scale = (e.storage as unknown as { pagination: { scale: number } }).pagination.scale || 1;
          const caret = e.view.coordsAtPos(e.state.selection.head);
          const y = (caret.top + (caret.bottom - caret.top) / 2 - root.getBoundingClientRect().top) / scale;
          return { total, current: Math.min(total, Math.max(1, Math.floor(y / pitch) + 1)) };
        } catch {
          return { total, current: 1 };
        }
      },
    }) ?? { total: 1, current: 1 }
  );
}
