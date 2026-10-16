import { Tags } from "lucide-react";
import { useMemo, useState } from "react";
import { NodeSelection } from "@tiptap/pm/state";
import { cn } from "../../lib/cn";
import { useLomaEditor } from "../../editor/EditorProvider";
import { cleanLabel, collectCaptions, DEFAULT_LABELS, MAX_LABEL } from "../../editor/references/Captions";
import { useApp } from "../../state/store";
import { Button, Dialog } from "../ui/Dialog";

const field = "h-8 w-full rounded-md border border-line bg-surface px-2 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

/** "Insérer une légende" : the label (Figure, Tableau, Équation or one of your own), the text and the position. */
export function CaptionDialog() {
  const editor = useLomaEditor();
  const { set } = useApp();
  // Tables are captioned above and the rest below, as Word does; the labels already used in the document come first.
  const inTable = !!editor && (() => { const { selection } = editor.state; if (selection instanceof NodeSelection && selection.node.type.name === "table") return true; for (let d = selection.$from.depth; d > 0; d--) if (selection.$from.node(d).type.name === "table") return true; return false; })();
  const used = useMemo(() => (editor ? [...new Set(collectCaptions(editor.state.doc).map((c) => c.label))] : []), [editor]);
  const labels = useMemo(() => [...new Set([...DEFAULT_LABELS, ...used])], [used]);
  const [label, setLabel] = useState(inTable ? "Tableau" : "Figure");
  const [custom, setCustom] = useState("");
  const [text, setText] = useState("");
  const [position, setPosition] = useState<"above" | "below">(inTable ? "above" : "below");
  const chosen = label === "__custom" ? cleanLabel(custom) : label;
  const next = chosen && editor ? collectCaptions(editor.state.doc, chosen).length + 1 : 1;
  const close = () => set({ dialog: null });
  const insert = () => {
    if (!chosen) return;
    editor?.chain().focus().insertCaption({ label: chosen, text, position }).run();
    set((s) => ({ dialog: null, doc: { ...s.doc, dirty: true } }));
  };
  return (
    <Dialog title="Insérer une légende" icon={Tags} onClose={close} width={420}
      footer={<><Button onClick={close}>Annuler</Button><Button variant="primary" onClick={insert} disabled={!chosen}>Insérer</Button></>}>
      <div className="space-y-3 p-5">
        <label className="block text-[11px] font-medium uppercase tracking-wide text-muted">
          Libellé
          <select value={label} onChange={(e) => setLabel(e.target.value)} className={cn(field, "mt-1 normal-case tracking-normal text-fg")}>
            {labels.map((l) => <option key={l} value={l}>{l}</option>)}
            <option value="__custom">Nouveau libellé…</option>
          </select>
        </label>
        {label === "__custom" && (
          <label className="block text-[11px] font-medium uppercase tracking-wide text-muted">
            Nouveau libellé (un mot)
            <input value={custom} maxLength={MAX_LABEL} aria-invalid={!chosen} onChange={(e) => setCustom(e.target.value)} className={cn(field, "mt-1 normal-case tracking-normal text-fg", !chosen && "border-danger")} />
          </label>
        )}
        <label className="block text-[11px] font-medium uppercase tracking-wide text-muted">
          Texte de la légende (facultatif)
          <input value={text} maxLength={200} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && insert()} className={cn(field, "mt-1 normal-case tracking-normal text-fg")} autoFocus />
        </label>
        <label className="block text-[11px] font-medium uppercase tracking-wide text-muted">
          Position
          <select value={position} onChange={(e) => setPosition(e.target.value as "above" | "below")} className={cn(field, "mt-1 normal-case tracking-normal text-fg")}>
            <option value="above">Au-dessus de l'élément</option>
            <option value="below">Sous l'élément</option>
          </select>
        </label>
        <p className="text-[12px] text-muted">Aperçu : <b className="text-fg">{chosen ?? "…"} {next}{text.trim() ? ` : ${text.trim()}` : ""}</b>. La numérotation suit l'ordre des légendes du document.</p>
      </div>
    </Dialog>
  );
}
