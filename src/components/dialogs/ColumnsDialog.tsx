import { Columns2 } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/cn";
import { useLomaEditor } from "../../editor/EditorProvider";
import { useSections } from "../../editor/useSections";
import { columnWidthCm, DEFAULT_COLUMN_GAP_CM, formatCm, MAX_COLUMNS, MIN_COLUMN_CM, textWidthCm } from "../../state/page";
import { useApp } from "../../state/store";
import type { ColumnsSpec, PageSetup } from "../../state/types";
import { Button, Dialog } from "../ui/Dialog";

const input = "h-8 w-full rounded-md border border-line bg-surface px-2 text-[13px] text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 aria-[invalid=true]:border-danger";
const label = "text-[11px] font-medium uppercase tracking-wide text-muted";

/** "Colonnes" : number, spacing and separator line, for the section holding the caret or from the caret to the end of the document. */
export function ColumnsDialog() {
  const { state, set } = useApp();
  const editor = useLomaEditor();
  const { sections, current, section } = useSections(editor, state.page, state.headerFooter);
  const page = section.page;
  const [count, setCount] = useState(page.columns?.count ?? 2);
  const [gap, setGap] = useState(page.columns?.gapCm ?? DEFAULT_COLUMN_GAP_CM);
  const [line, setLine] = useState(page.columns?.line ?? false);
  const [scope, setScope] = useState<"section" | "from-here">("section");
  const spec: ColumnsSpec | undefined = count >= 2 ? { count, gapCm: gap, line } : undefined;
  const next: PageSetup = { ...page, ...(spec ? { columns: spec } : {}) };
  if (!spec) delete next.columns;
  const countOk = Number.isInteger(count) && count >= 1 && count <= MAX_COLUMNS;
  const gapOk = Number.isFinite(gap) && gap >= 0 && gap <= 5;
  const width = countOk && gapOk ? columnWidthCm(next) ?? textWidthCm(next) : NaN;
  const fits = Number.isNaN(width) || count < 2 || width >= MIN_COLUMN_CM;
  const valid = countOk && gapOk && fits;
  const close = () => set({ dialog: null });
  const apply = () => {
    if (!valid || !editor) return;
    if (scope === "from-here") editor.chain().focus().insertSectionBreak({ kind: "continuous", columns: spec ?? null }).run();
    else if (current === 0) set((s) => ({ page: next, doc: { ...s.doc, dirty: true } }));
    else editor.commands.setSectionPage(current, next);
    set((s) => ({ dialog: null, doc: { ...s.doc, dirty: true } }));
  };
  return (
    <Dialog title="Colonnes" icon={Columns2} onClose={close} width={500} backdropClose={false}
      footer={<><Button onClick={close}>Annuler</Button><Button variant="primary" disabled={!valid} onClick={apply}>Appliquer</Button></>}>
      <div className="space-y-4 p-5">
        <div>
          <span className={label}>Nombre de colonnes</span>
          <div className="mt-1 flex flex-wrap items-center gap-1.5" role="group" aria-label="Nombre de colonnes">
            {[1, 2, 3, 4].map((n) => (
              <button key={n} type="button" aria-pressed={count === n} onClick={() => setCount(n)} className={cn("flex h-12 w-14 items-center justify-center gap-0.5 rounded-md border", count === n ? "border-accent bg-accent-soft" : "border-line hover:bg-hover")} title={n === 1 ? "Une colonne" : `${n} colonnes`}>
                {Array.from({ length: n }, (_, i) => <span key={i} className="h-7 flex-1 rounded-sm bg-line first:ml-1.5 last:mr-1.5" />)}
              </button>
            ))}
            <label className="ml-2 flex items-center gap-2 text-[13px]">Autre :
              <input type="number" min={1} max={MAX_COLUMNS} aria-label="Nombre de colonnes (autre)" aria-invalid={!countOk || undefined} value={Number.isNaN(count) ? "" : count} onChange={(e) => setCount(e.target.valueAsNumber)} className={cn(input, "w-16")} />
            </label>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className={label}>Espacement (cm)
            <input type="number" step={0.05} min={0} max={5} aria-label="Espacement entre colonnes (cm)" aria-invalid={!gapOk || undefined} disabled={count < 2} value={Number.isNaN(gap) ? "" : gap} onChange={(e) => setGap(e.target.valueAsNumber)} className={cn(input, "mt-1")} />
          </label>
          <label className="mt-5 flex items-center gap-2 text-[13px]"><input type="checkbox" disabled={count < 2} checked={line} onChange={(e) => setLine(e.target.checked)} /> Ligne entre les colonnes</label>
        </div>
        <label className={label}>Appliquer à
          <select aria-label="Appliquer à" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} className={cn(input, "mt-1")}>
            <option value="section">{sections.length > 1 ? `Cette section (section ${current + 1})` : "Tout le document"}</option>
            <option value="from-here">À partir d'ici (saut de section continu)</option>
          </select>
        </label>
        <p className="text-[12px] text-muted" aria-live="polite">
          {count >= 2 && Number.isFinite(width) ? <>Chaque colonne mesurera {formatCm(width)} cm.</> : "Le texte s'écoule sur une seule colonne."}
          {" "}Les paragraphes peuvent se répartir sur les colonnes d'une page ; une liste, un tableau ou une image plus haut qu'une colonne dépasse en bas de la colonne.
        </p>
        {!valid && <p role="alert" className="text-[12px] text-danger">{!countOk ? `Le nombre de colonnes doit être compris entre 1 et ${MAX_COLUMNS}.` : !gapOk ? "L'espacement doit être compris entre 0 et 5 cm." : `Chaque colonne doit mesurer au moins ${MIN_COLUMN_CM} cm : réduisez le nombre de colonnes ou l'espacement.`}</p>}
      </div>
    </Dialog>
  );
}
