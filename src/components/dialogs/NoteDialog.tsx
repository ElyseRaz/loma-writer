import StarterKit from "@tiptap/starter-kit";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { Bold, Italic, Link2, Subscript as SubIcon, Superscript as SupIcon, TextQuote, Underline } from "lucide-react";
import { cn } from "../../lib/cn";
import { useLomaEditor } from "../../editor/EditorProvider";
import { bodyOf, bodyText, cleanBody, MAX_NOTE_CHARS } from "../../editor/references/noteBody";
import { useApp } from "../../state/store";
import { Button, Dialog } from "../ui/Dialog";

const toolButton = "flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover aria-pressed:bg-accent-soft aria-pressed:text-accent";

/** The text of a note: typed when the note is inserted, changed with a double-click on its number. Several paragraphs, with formatting. */
export function NoteDialog() {
  const editor = useLomaEditor();
  const { state, set } = useApp();
  const editing = state.notePos;
  const existing = editing !== null ? editor?.state.doc.nodeAt(editing) : null;
  const kind = existing ? (existing.attrs.kind as "foot" | "end") : state.noteKind;
  const initial = existing ? bodyOf(existing.attrs as { body?: unknown; text?: unknown }) : [];
  const noteEditor = useEditor({
    extensions: [StarterKit.configure({ heading: false, bulletList: false, orderedList: false, listItem: false, listKeymap: false, blockquote: false, codeBlock: false, code: false, horizontalRule: false, strike: false, link: { openOnClick: false, autolink: false } }), Subscript, Superscript],
    content: { type: "doc", content: initial.length ? initial : [{ type: "paragraph" }] } as never,
    autofocus: "end",
    editorProps: { attributes: { class: "note-editor min-h-[110px] px-3 py-2 text-[13px] outline-none", "aria-label": "Texte de la note", role: "textbox", "aria-multiline": "true" } },
  });
  const active = useEditorState({
    editor: noteEditor,
    selector: ({ editor: e }) => ({ bold: !!e?.isActive("bold"), italic: !!e?.isActive("italic"), underline: !!e?.isActive("underline"), sub: !!e?.isActive("subscript"), sup: !!e?.isActive("superscript"), link: !!e?.isActive("link") }),
  });
  const title = kind === "end" ? "Note de fin" : "Note de bas de page";
  const close = () => set({ dialog: null, notePos: null });
  const body = () => cleanBody((noteEditor?.getJSON().content ?? []) as unknown);
  const apply = () => {
    if (!editor || !noteEditor) return;
    const b = body();
    if (editing !== null) editor.chain().focus().updateNote(editing, b).run();
    else editor.chain().focus().insertNote({ kind, body: b }).run();
    set((s) => ({ dialog: null, notePos: null, doc: { ...s.doc, dirty: true } }));
  };
  const setLink = () => {
    if (!noteEditor) return;
    const current = noteEditor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Adresse du lien (https://…) — laisser vide pour retirer le lien", current ?? "https://");
    if (url === null) return;
    if (!url.trim()) noteEditor.chain().focus().extendMarkRange("link").unsetLink().run();
    else if (/^(https?:\/\/|mailto:)\S+$/i.test(url.trim())) noteEditor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };
  const chars = noteEditor ? bodyText(body()).length : 0;
  return (
    <Dialog title={editing !== null ? `Modifier la ${title.toLowerCase()}` : title} icon={TextQuote} onClose={close} width={520} backdropClose={false}
      footer={<><Button onClick={close}>Annuler</Button><Button variant="primary" onClick={apply}>{editing !== null ? "Appliquer" : "Insérer"}</Button></>}>
      <div className="space-y-3 p-5" onKeyDownCapture={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); apply(); } }}>
        <div>
          <div className="mb-1 text-[11px] font-medium text-muted">Texte de la note</div>
          <div className="rounded-md border border-line bg-surface focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
            <div className="flex gap-0.5 border-b border-line p-1" role="toolbar" aria-label="Mise en forme de la note">
              <button type="button" className={toolButton} aria-pressed={active?.bold} title="Gras (Ctrl+B)" aria-label="Gras" onClick={() => noteEditor?.chain().focus().toggleBold().run()}><Bold size={14} /></button>
              <button type="button" className={toolButton} aria-pressed={active?.italic} title="Italique (Ctrl+I)" aria-label="Italique" onClick={() => noteEditor?.chain().focus().toggleItalic().run()}><Italic size={14} /></button>
              <button type="button" className={toolButton} aria-pressed={active?.underline} title="Souligné (Ctrl+U)" aria-label="Souligné" onClick={() => noteEditor?.chain().focus().toggleUnderline().run()}><Underline size={14} /></button>
              <button type="button" className={toolButton} aria-pressed={active?.sub} title="Indice" aria-label="Indice" onClick={() => noteEditor?.chain().focus().toggleSubscript().run()}><SubIcon size={14} /></button>
              <button type="button" className={toolButton} aria-pressed={active?.sup} title="Exposant" aria-label="Exposant" onClick={() => noteEditor?.chain().focus().toggleSuperscript().run()}><SupIcon size={14} /></button>
              <button type="button" className={toolButton} aria-pressed={active?.link} title="Lien" aria-label="Lien" onClick={setLink}><Link2 size={14} /></button>
            </div>
            <EditorContent editor={noteEditor} />
          </div>
        </div>
        <p className={cn("text-[12px] text-muted", chars > MAX_NOTE_CHARS * 0.9 && "text-danger")}>
          {kind === "end" ? "Les notes de fin sont réunies à la fin du document." : "Les notes de bas de page s'affichent en bas de la page où se trouve leur numéro."} Plusieurs paragraphes sont possibles (Entrée) ; Ctrl+Entrée valide. {chars}/{MAX_NOTE_CHARS} caractères.
        </p>
      </div>
    </Dialog>
  );
}
