import { Hash } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/cn";
import { useLomaEditor } from "../../editor/EditorProvider";
import { useSections } from "../../editor/useSections";
import { formatPageNumber, PAGE_NUMBER_FORMATS, type PageNumberFormat } from "../../pagination/pageNumber";
import { useApp } from "../../state/store";
import type { PageSetup } from "../../state/types";
import { Button, Dialog } from "../ui/Dialog";

const input = "h-8 w-full rounded-md border border-line bg-surface px-2 text-[13px] text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 aria-[invalid=true]:border-danger";

/** "Format du numéro de page" : numeral style and restart of the numbering, for the section holding the caret. */
export function PageNumberDialog() {
  const { state, set } = useApp();
  const editor = useLomaEditor();
  const { sections, current } = useSections(editor, state.page, state.headerFooter);
  const page = sections[current].page;
  const [format, setFormat] = useState<PageNumberFormat>(page.numberFormat ?? "decimal");
  const [restart, setRestart] = useState(current === 0 || page.numberStart !== undefined);
  const [start, setStart] = useState<number>(page.numberStart ?? 1);
  const valid = !restart || (Number.isInteger(start) && start >= 0 && start <= 99999);
  const close = () => set({ dialog: null });
  const apply = () => {
    if (!valid) return;
    const { numberFormat: _f, numberStart: _s, ...rest } = page;
    const next: PageSetup = { ...rest, ...(format !== "decimal" ? { numberFormat: format } : {}), ...(restart ? { numberStart: start } : {}) };
    if (current === 0) set((s) => ({ page: next, doc: { ...s.doc, dirty: true }, dialog: null }));
    else {
      editor?.commands.setSectionPage(current, next);
      set((s) => ({ doc: { ...s.doc, dirty: true }, dialog: null }));
    }
  };
  const first = restart && valid ? start : current === 0 ? 1 : null;
  return (
    <Dialog title="Numéros de page" icon={Hash} onClose={close} width={460} backdropClose={false}
      footer={<><Button onClick={close}>Annuler</Button><Button variant="primary" disabled={!valid} onClick={apply}>Appliquer</Button></>}>
      <div className="space-y-4 p-5">
        {sections.length > 1 && <p className="rounded-md bg-chrome px-3 py-2 text-[13px]">Section {current + 1} sur {sections.length} : les réglages s'appliquent à cette section.</p>}
        <label className="block text-[11px] font-medium uppercase tracking-wide text-muted">Format
          <select aria-label="Format du numéro de page" value={format} onChange={(e) => setFormat(e.target.value as PageNumberFormat)} className={cn(input, "mt-1")}>
            {PAGE_NUMBER_FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </label>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">Numérotation</legend>
          {current > 0 && (
            <label className="flex items-center gap-2 text-[13px]"><input type="radio" name="numbering" checked={!restart} onChange={() => setRestart(false)} /> Continuer à partir de la section précédente</label>
          )}
          <label className="flex items-center gap-2 text-[13px]">
            <input type="radio" name="numbering" checked={restart} onChange={() => setRestart(true)} /> Commencer à :
            <input type="number" min={0} max={99999} aria-label="Premier numéro" aria-invalid={!valid || undefined} disabled={!restart} value={Number.isNaN(start) ? "" : start} onChange={(e) => setStart(e.target.valueAsNumber)} className={cn(input, "w-24")} />
          </label>
        </fieldset>
        <p className="text-[12px] text-muted" aria-live="polite">
          {first !== null ? <>La première page de la section sera numérotée <strong>{formatPageNumber(first, format)}</strong>, puis {formatPageNumber(first + 1, format)}, {formatPageNumber(first + 2, format)}…</> : "La numérotation continue après la dernière page de la section précédente."}
        </p>
        {!valid && <p role="alert" className="text-[12px] text-danger">Le premier numéro doit être un entier de 0 à 99 999.</p>}
      </div>
    </Dialog>
  );
}
