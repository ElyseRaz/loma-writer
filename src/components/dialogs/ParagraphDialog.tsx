import { AlignLeft } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/cn";
import { cleanLayout, MAX_INDENT_CM, MAX_SPACE_PT, type ParagraphLayout } from "../../editor/ParagraphFormat";
import { useLomaEditor } from "../../editor/EditorProvider";
import { useEditorSnapshot } from "../../editor/useEditorSnapshot";
import { useApp } from "../../state/store";
import { Button, Dialog } from "../ui/Dialog";

const input = "h-8 w-full rounded-md border border-line bg-surface px-2 pr-8 text-[13px] normal-case tracking-normal text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 aria-[invalid=true]:border-danger";
const label = "text-[11px] font-medium uppercase tracking-wide text-muted";

function Field({ name, unit, value, onChange, min, max, invalid }: { name: string; unit: string; value: number | null; onChange: (v: number) => void; min: number; max: number; invalid: boolean }) {
  return (
    <label className={label}>{name}
      <div className="relative mt-1">
        <input type="number" step={unit === "cm" ? 0.1 : 1} min={min} max={max} aria-label={`${name} (${unit})`} aria-invalid={invalid || undefined} value={value === null || Number.isNaN(value) ? "" : value} onChange={(e) => onChange(e.target.valueAsNumber)} className={input} />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] normal-case text-muted">{unit}</span>
      </div>
    </label>
  );
}

/** "Paragraphe…": indents (with first-line / hanging), spacing and page-flow options of the selected paragraphs. */
export function ParagraphDialog() {
  const editor = useLomaEditor();
  const snap = useEditorSnapshot(editor);
  const { set } = useApp();
  const [d, setD] = useState<ParagraphLayout>(snap.layout);
  const [special, setSpecial] = useState<"none" | "first" | "hanging">(snap.layout.firstLine > 0 ? "first" : snap.layout.firstLine < 0 ? "hanging" : "none");
  const close = () => set({ dialog: null });
  const bad = (v: number | null, lo: number, hi: number) => v !== null && (!Number.isFinite(v) || v < lo || v > hi);
  const first = Math.abs(d.firstLine);
  const invalid = bad(d.indentLeft, 0, MAX_INDENT_CM) || bad(d.indentRight, 0, MAX_INDENT_CM) || bad(first, 0, MAX_INDENT_CM) || bad(d.spaceBefore, 0, MAX_SPACE_PT) || bad(d.spaceAfter, 0, MAX_SPACE_PT);
  const apply = () => {
    if (invalid) return;
    const firstLine = special === "none" ? 0 : special === "first" ? first : -first;
    editor?.chain().focus().setParagraphLayout(cleanLayout({ ...d, firstLine })).run();
    set((s) => ({ dialog: null, doc: { ...s.doc, dirty: true } }));
  };
  const check = (key: "pageBreakBefore" | "keepWithNext" | "keepLines", text: string) => (
    <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={d[key]} onChange={(e) => setD({ ...d, [key]: e.target.checked })} /> {text}</label>
  );
  return (
    <Dialog title="Paragraphe" icon={AlignLeft} onClose={close} width={520} backdropClose={false}
      footer={<><Button onClick={close}>Annuler</Button><Button variant="primary" disabled={invalid} onClick={apply}>Appliquer</Button></>}>
      <div className="space-y-4 p-5">
        <section className="space-y-2">
          <h3 className="text-[12px] font-semibold">Retrait</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field name="À gauche" unit="cm" value={d.indentLeft} onChange={(v) => setD({ ...d, indentLeft: v })} min={0} max={MAX_INDENT_CM} invalid={bad(d.indentLeft, 0, MAX_INDENT_CM)} />
            <Field name="À droite" unit="cm" value={d.indentRight} onChange={(v) => setD({ ...d, indentRight: v })} min={0} max={MAX_INDENT_CM} invalid={bad(d.indentRight, 0, MAX_INDENT_CM)} />
            <label className={label}>Première ligne
              <select aria-label="Retrait spécial" value={special} onChange={(e) => setSpecial(e.target.value as typeof special)} className={cn(input, "mt-1 pr-2")}>
                <option value="none">(aucun)</option><option value="first">Positif (1re ligne)</option><option value="hanging">Suspendu</option>
              </select>
            </label>
            <Field name="De" unit="cm" value={special === "none" ? 0 : first} onChange={(v) => setD({ ...d, firstLine: special === "hanging" ? -v : v })} min={0} max={MAX_INDENT_CM} invalid={special !== "none" && bad(first, 0, MAX_INDENT_CM)} />
          </div>
        </section>
        <section className="space-y-2">
          <h3 className="text-[12px] font-semibold">Espacement</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field name="Avant" unit="pt" value={d.spaceBefore} onChange={(v) => setD({ ...d, spaceBefore: v })} min={0} max={MAX_SPACE_PT} invalid={bad(d.spaceBefore, 0, MAX_SPACE_PT)} />
            <Field name="Après" unit="pt" value={d.spaceAfter} onChange={(v) => setD({ ...d, spaceAfter: v })} min={0} max={MAX_SPACE_PT} invalid={bad(d.spaceAfter, 0, MAX_SPACE_PT)} />
          </div>
          <p className="text-[12px] text-muted">Un champ vide garde l'espacement du style (Normal, Titre…).</p>
        </section>
        <section className="space-y-2">
          <h3 className="text-[12px] font-semibold">Enchaînements</h3>
          {check("pageBreakBefore", "Saut de page avant")}
          {check("keepWithNext", "Paragraphe suivant solidaire")}
          {check("keepLines", "Lignes solidaires (ne pas couper le paragraphe entre deux pages)")}
        </section>
        {invalid && <p role="alert" className="text-[12px] text-danger">Retraits : de 0 à {MAX_INDENT_CM} cm. Espacements : de 0 à {MAX_SPACE_PT} pt.</p>}
      </div>
    </Dialog>
  );
}
