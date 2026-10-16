import { TextQuote } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLomaEditor } from "../../editor/EditorProvider";
import { cleanNoteText, MAX_NOTE_TEXT } from "../../editor/references/Notes";
import { useApp } from "../../state/store";
import { Button, Dialog } from "../ui/Dialog";

/** The text of a note: typed when the note is inserted, changed with a double-click on its number. */
export function NoteDialog() {
  const editor = useLomaEditor();
  const { state, set } = useApp();
  const editing = state.notePos;
  const existing = editing !== null ? editor?.state.doc.nodeAt(editing) : null;
  const kind = existing ? (existing.attrs.kind as "foot" | "end") : state.noteKind;
  const [text, setText] = useState(() => String(existing?.attrs.text ?? ""));
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => area.current?.focus(), []);
  const title = kind === "end" ? "Note de fin" : "Note de bas de page";
  const close = () => set({ dialog: null, notePos: null });
  const apply = () => {
    if (!editor) return;
    if (editing !== null) editor.chain().focus().updateNote(editing, text).run();
    else editor.chain().focus().insertNote({ kind, text }).run();
    set((s) => ({ dialog: null, notePos: null, doc: { ...s.doc, dirty: true } }));
  };
  return (
    <Dialog title={editing !== null ? `Modifier la ${title.toLowerCase()}` : title} icon={TextQuote} onClose={close} width={480}
      footer={<><Button onClick={close}>Annuler</Button><Button variant="primary" onClick={apply}>{editing !== null ? "Appliquer" : "Insérer"}</Button></>}>
      <div className="space-y-3 p-5">
        <label className="block text-[11px] font-medium uppercase tracking-wide text-muted">
          Texte de la note
          <textarea ref={area} value={text} rows={4} maxLength={MAX_NOTE_TEXT} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) apply(); }}
            className="mt-1 w-full rounded-md border border-line bg-surface p-2 text-[13px] normal-case tracking-normal text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" />
        </label>
        <p className="text-[12px] text-muted">
          {kind === "end" ? "Les notes de fin sont réunies à la fin du document." : "Les notes de bas de page s'affichent en bas de la page où se trouve leur numéro."} Ctrl+Entrée valide.
          {cleanNoteText(text).length === 0 && " (Une note vide est autorisée : on peut la compléter plus tard par un double-clic sur son numéro.)"}
        </p>
      </div>
    </Dialog>
  );
}
