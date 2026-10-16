import { useEditorState, type Editor } from "@tiptap/react";
import { useEffect, useState } from "react";
import { paginationKey, type PageNote } from "./extension";
import type { Band, Sheet } from "./model";

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
        const state = paginationKey.getState(e.state);
        const total = state?.pages ?? 1;
        try {
          const root = e.view.dom;
          if (root.getClientRects().length === 0) return { total, current: 1 };
          const scale = (e.storage as unknown as { pagination: { scale: number } }).pagination.scale || 1;
          const caret = e.view.coordsAtPos(e.state.selection.head);
          const y = (caret.top + (caret.bottom - caret.top) / 2 - root.getBoundingClientRect().top) / scale;
          const sheets = state?.sheets ?? [];
          if (sheets.length) {
            // The last sheet that starts above the caret (sheets may differ in height).
            let page = 0;
            sheets.forEach((s, i) => { if (s.top + s.insetTop <= y + 1) page = i; });
            return { total, current: Math.min(total, page + 1) };
          }
          return { total, current: Math.min(total, Math.max(1, Math.floor(y / pitch) + 1)) };
        } catch {
          return { total, current: 1 };
        }
      },
    }) ?? { total: 1, current: 1 }
  );
}

/** The sheets of the last layout (engine coordinates), empty until the first layout. */
export function usePaginationSheets(editor: Editor | null): Sheet[] {
  return useEditorState({ editor, selector: ({ editor: e }) => (e ? paginationKey.getState(e.state)?.sheets ?? [] : []) }) ?? [];
}

/** The vertical rules between columns of the last layout (engine coordinates). */
export function usePaginationBands(editor: Editor | null): Band[] {
  return useEditorState({ editor, selector: ({ editor: e }) => (e ? paginationKey.getState(e.state)?.bands ?? [] : []) }) ?? [];
}

/** The footnotes of each page (by page index), updated after every layout. */
export function usePageNotes(editor: Editor | null): Record<number, PageNote[]> {
  const [notes, setNotes] = useState<Record<number, PageNote[]>>({});
  useEffect(() => {
    if (!editor) return;
    const read = () => {
      const next = (editor.storage as unknown as { pagination?: { pageNotes: Record<number, PageNote[]> } }).pagination?.pageNotes ?? {};
      setNotes((cur) => (JSON.stringify(cur) === JSON.stringify(next) ? cur : next));
    };
    read();
    window.addEventListener("loma:layout", read);
    return () => window.removeEventListener("loma:layout", read);
  }, [editor]);
  return notes;
}
