import { TextQuote } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/cn";
import { useLomaEditor } from "../../editor/EditorProvider";
import { notesOptionsOf } from "../../editor/references/Notes";
import { formatNoteNumber, NOTE_FORMATS, type NoteFormat, type NoteNumbering, type NoteRestart, type NotesOptions } from "../../editor/references/notesNumbering";
import { useApp } from "../../state/store";
import { Button, Dialog } from "../ui/Dialog";

const input = "h-8 w-full rounded-md border border-line bg-surface px-2 text-[13px] text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 aria-[invalid=true]:border-danger";

const RESTARTS: Array<{ id: NoteRestart; label: string; foot: boolean }> = [
  { id: "continuous", label: "Continue", foot: true },
  { id: "section", label: "À chaque section", foot: true },
  { id: "page", label: "À chaque page", foot: false },
];

/** "Options des notes" : format, first number and restart of the numbering of the footnotes and of the endnotes. */
export function NotesOptionsDialog() {
  const { set } = useApp();
  const editor = useLomaEditor();
  const [opts, setOpts] = useState<NotesOptions>(() => (editor ? notesOptionsOf(editor.state.doc) : notesOptionsOf({ attrs: {} } as never)));
  const valid = (n: NoteNumbering) => Number.isInteger(n.start) && n.start >= 1 && n.start <= 9999;
  const ok = valid(opts.foot) && valid(opts.end);
  const close = () => set({ dialog: null });
  const apply = () => {
    if (!ok) return;
    editor?.commands.setNotesOptions(opts);
    set((s) => ({ doc: { ...s.doc, dirty: true }, dialog: null }));
  };
  const part = (kind: "foot" | "end", title: string) => {
    const n = opts[kind];
    const patch = (p: Partial<NoteNumbering>) => setOpts((o) => ({ ...o, [kind]: { ...o[kind], ...p } }));
    return (
      <fieldset className="space-y-2">
        <legend className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">{title}</legend>
        <div className="grid grid-cols-3 gap-2">
          <label className="text-[12px] text-muted">Format
            <select aria-label={`Format des ${title.toLowerCase()}`} value={n.format} onChange={(e) => patch({ format: e.target.value as NoteFormat })} className={cn(input, "mt-1")}>
              {NOTE_FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </label>
          <label className="text-[12px] text-muted">Commencer à
            <input type="number" min={1} max={9999} aria-label={`Premier numéro des ${title.toLowerCase()}`} aria-invalid={!valid(n) || undefined} value={Number.isNaN(n.start) ? "" : n.start} onChange={(e) => patch({ start: e.target.valueAsNumber })} className={cn(input, "mt-1")} />
          </label>
          <label className="text-[12px] text-muted">Numérotation
            <select aria-label={`Numérotation des ${title.toLowerCase()}`} value={n.restart} onChange={(e) => patch({ restart: e.target.value as NoteRestart })} className={cn(input, "mt-1")}>
              {RESTARTS.filter((r) => r.foot || kind === "foot").map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </label>
        </div>
        <p className="text-[12px] text-muted" aria-live="polite">Aperçu : {valid(n) ? [0, 1, 2].map((i) => formatNoteNumber(n.start + i, n.format)).join(", ") : "—"}…</p>
      </fieldset>
    );
  };
  return (
    <Dialog title="Options des notes" icon={TextQuote} onClose={close} width={520} backdropClose={false}
      footer={<><Button onClick={close}>Annuler</Button><Button variant="primary" disabled={!ok} onClick={apply}>Appliquer</Button></>}>
      <div className="space-y-4 p-5">
        {part("foot", "Notes de bas de page")}
        {part("end", "Notes de fin")}
        {!ok && <p role="alert" className="text-[12px] text-danger">Le premier numéro doit être un entier de 1 à 9 999.</p>}
      </div>
    </Dialog>
  );
}
