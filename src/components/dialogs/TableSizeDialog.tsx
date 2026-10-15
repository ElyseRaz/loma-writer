import { Table } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/cn";
import { useLomaEditor } from "../../editor/EditorProvider";
import { useApp } from "../../state/store";
import { Button, Dialog } from "../ui/Dialog";

/** Same limits as Word: 63 columns, and a generous number of rows. */
export const MAX_TABLE_COLUMNS = 63;
export const MAX_TABLE_ROWS = 500;

const field = "h-8 w-full rounded-md border border-line bg-surface px-2 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

/** "Insérer un tableau…": any number of rows and columns, with or without a header row. */
export function TableSizeDialog() {
  const editor = useLomaEditor();
  const { set } = useApp();
  const [cols, setCols] = useState(3);
  const [rows, setRows] = useState(3);
  const [header, setHeader] = useState(true);
  const validC = Number.isInteger(cols) && cols >= 1 && cols <= MAX_TABLE_COLUMNS;
  const validR = Number.isInteger(rows) && rows >= 1 && rows <= MAX_TABLE_ROWS;
  const close = () => set({ dialog: null });
  const insert = () => {
    if (!validC || !validR) return;
    editor?.chain().focus().insertTable({ rows, cols, withHeaderRow: header }).run();
    set((s) => ({ dialog: null, doc: { ...s.doc, dirty: true } }));
  };
  const num = (label: string, value: number, setValue: (n: number) => void, max: number, valid: boolean) => (
    <label className="text-[11px] font-medium uppercase tracking-wide text-muted">
      {label}
      <input type="number" min={1} max={max} value={Number.isNaN(value) ? "" : value} aria-invalid={!valid} onChange={(e) => setValue(e.target.valueAsNumber)}
        onKeyDown={(e) => e.key === "Enter" && insert()} className={cn(field, "mt-1 normal-case tracking-normal text-fg", !valid && "border-danger")} />
    </label>
  );
  return (
    <Dialog title="Insérer un tableau" icon={Table} onClose={close} width={380}
      footer={<><Button onClick={close}>Annuler</Button><Button variant="primary" onClick={insert} disabled={!validC || !validR}>Insérer</Button></>}>
      <div className="space-y-3 p-5">
        <div className="grid grid-cols-2 gap-3">
          {num("Colonnes", cols, setCols, MAX_TABLE_COLUMNS, validC)}
          {num("Lignes", rows, setRows, MAX_TABLE_ROWS, validR)}
        </div>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} /> Première ligne d'en-tête</label>
        {(!validC || !validR) && <p role="alert" className="text-[12px] text-danger">Colonnes : de 1 à {MAX_TABLE_COLUMNS}. Lignes : de 1 à {MAX_TABLE_ROWS}.</p>}
        <p className="text-[12px] text-muted">Les lignes et colonnes se complètent ensuite avec la barre « Outils de tableau ».</p>
      </div>
    </Dialog>
  );
}
