import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useEditor, type Editor } from "@tiptap/react";
import { gotoBookmark } from "../services/insert/bookmarks";
import { createExtensions } from "./extensions";
import { useApp } from "../state/store";

const EditorContext = createContext<Editor | null>(null);

/** Owns the single TipTap instance shared by the ribbon, the page, the status bar and the commands. */
export function EditorProvider({ children }: { children: ReactNode }) {
  const { state, set } = useApp();
  const extensions = useMemo(() => createExtensions(), []);

  const editor = useEditor({
    extensions,
    content: "<p></p>",
    editorProps: { attributes: { spellcheck: "true", lang: "fr", "aria-label": "Zone de rédaction du document" } },
    onUpdate: () => set((s) => (s.doc.dirty ? {} : { doc: { ...s.doc, dirty: true } })),
  });

  // End-to-end tests drive the real editor through this hook; it does not exist in production builds.
  useEffect(() => {
    if (import.meta.env.DEV && editor) (window as unknown as { __lomaEditor?: unknown }).__lomaEditor = editor;
  }, [editor]);

  useEffect(() => {
    const go = (e: Event) => editor && gotoBookmark(editor, (e as CustomEvent<{ name: string }>).detail.name);
    window.addEventListener("loma:goto-bookmark", go);
    return () => window.removeEventListener("loma:goto-bookmark", go);
  }, [editor]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    // setOptions never touches editor.view directly, so it is safe before the view is mounted.
    editor.setOptions({ editorProps: { attributes: { spellcheck: String(state.spellcheck), lang: "fr", "aria-label": "Zone de rédaction du document" } } });
  }, [editor, state.spellcheck]);

  return <EditorContext.Provider value={editor}>{children}</EditorContext.Provider>;
}

export function useLomaEditor(): Editor | null {
  return useContext(EditorContext);
}
