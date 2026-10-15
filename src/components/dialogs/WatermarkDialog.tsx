import { FileDown } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/cn";
import { DEFAULT_WATERMARK, MAX_WATERMARK_TEXT, WATERMARK_PRESETS, WATERMARK_SIZE, cleanWatermark, type Watermark } from "../../editor/watermark";
import { useApp } from "../../state/store";
import { Button, Dialog } from "../ui/Dialog";

const input = "h-8 w-full rounded-md border border-line bg-surface px-2 text-[13px] normal-case tracking-normal text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 aria-[invalid=true]:border-danger";
const label = "text-[11px] font-medium uppercase tracking-wide text-muted";
const COLORS = ["#c0c0c0", "#808080", "#dc2626", "#2563eb", "#16a34a", "#ea580c", "#7c3aed", "#000000"];

/** "Filigrane personnalisé" : text, colour, size, direction and transparency, with a preview of the page. */
export function WatermarkDialog() {
  const { state, set } = useApp();
  const [w, setW] = useState<Watermark>(state.watermark ?? DEFAULT_WATERMARK);
  const textOk = w.text.trim().length > 0 && w.text.length <= MAX_WATERMARK_TEXT;
  const sizeOk = Number.isFinite(w.size) && w.size >= WATERMARK_SIZE.min && w.size <= WATERMARK_SIZE.max;
  const close = () => set({ dialog: null });
  const apply = () => {
    const clean = cleanWatermark(w);
    if (!clean || !textOk || !sizeOk) return;
    set((s) => ({ watermark: clean, dialog: null, doc: { ...s.doc, dirty: true } }));
  };
  // The page, drawn at 1/8 scale (the font size shrinks with it).
  const k = 0.15;
  return (
    <Dialog title="Filigrane" icon={FileDown} onClose={close} width={560} backdropClose={false}
      footer={<><Button onClick={close}>Annuler</Button><Button variant="primary" disabled={!textOk || !sizeOk} onClick={apply}>Appliquer</Button></>}>
      <div className="grid gap-4 p-5 sm:grid-cols-[1fr_150px]">
        <div className="space-y-3">
          <label className={label}>Texte
            <input value={w.text} maxLength={MAX_WATERMARK_TEXT} list="wm-presets" aria-label="Texte du filigrane" aria-invalid={!textOk || undefined} onChange={(e) => setW({ ...w, text: e.target.value })} className={cn(input, "mt-1")} />
            <datalist id="wm-presets">{WATERMARK_PRESETS.map((p) => <option key={p} value={p} />)}</datalist>
          </label>
          <div>
            <span className={label}>Couleur</span>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {COLORS.map((c) => <button key={c} type="button" aria-label={c} title={c} aria-pressed={w.color === c} onClick={() => setW({ ...w, color: c })} style={{ background: c }} className={cn("h-6 w-6 rounded border", w.color === c ? "border-accent ring-2 ring-accent/40" : "border-black/15")} />)}
              <input type="color" aria-label="Autre couleur" value={w.color} onChange={(e) => setW({ ...w, color: e.target.value })} className="h-6 w-8 cursor-pointer rounded border border-line bg-transparent p-0.5" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className={label}>Taille (pt)
              <input type="number" min={WATERMARK_SIZE.min} max={WATERMARK_SIZE.max} aria-label="Taille du filigrane (pt)" aria-invalid={!sizeOk || undefined} value={Number.isNaN(w.size) ? "" : w.size} onChange={(e) => setW({ ...w, size: e.target.valueAsNumber })} className={cn(input, "mt-1")} />
            </label>
            <label className={label}>Opacité ({Math.round(w.opacity * 100)} %)
              <input type="range" min={10} max={100} step={5} aria-label="Opacité du filigrane" value={Math.round(w.opacity * 100)} onChange={(e) => setW({ ...w, opacity: +e.target.value / 100 })} className="mt-2 w-full" />
            </label>
          </div>
          <fieldset className="flex gap-2" aria-label="Disposition">
            {(["diagonal", "horizontal"] as const).map((l) => (
              <button key={l} type="button" role="radio" aria-checked={w.layout === l} onClick={() => setW({ ...w, layout: l })}
                className={cn("h-8 flex-1 rounded-md border text-[13px]", w.layout === l ? "border-accent bg-accent-soft text-accent" : "border-line hover:bg-hover")}>{l === "diagonal" ? "Diagonale" : "Horizontale"}</button>
            ))}
          </fieldset>
          {!textOk && <p role="alert" className="text-[12px] text-danger">Le texte doit contenir de 1 à {MAX_WATERMARK_TEXT} caractères.</p>}
          {!sizeOk && <p role="alert" className="text-[12px] text-danger">La taille doit être comprise entre {WATERMARK_SIZE.min} et {WATERMARK_SIZE.max} pt.</p>}
        </div>
        <div className="flex items-start justify-center rounded-md bg-chrome p-3" aria-hidden>
          <div className="relative flex items-center justify-center overflow-hidden bg-white shadow-sm" style={{ width: 794 * k, height: 1123 * k }}>
            <span style={{ fontSize: `${(Number.isFinite(w.size) ? w.size : 80) * k * (96 / 72)}px`, fontWeight: 700, whiteSpace: "nowrap", color: w.color, opacity: w.opacity, transform: w.layout === "diagonal" ? "rotate(-45deg)" : "none", lineHeight: 1 }}>{w.text}</span>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
