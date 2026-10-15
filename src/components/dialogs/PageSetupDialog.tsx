import { FileText, RectangleHorizontal, RectangleVertical } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/cn";
import {
  CUSTOM_SIZE_LIMITS, DEFAULT_CUSTOM_SIZE, MARGIN_PRESETS, MAX_MARGIN_CM, PAPER_SIZES, baseMarginsCm, effectiveMarginsCm, fitMargins, formatCm, formatSize, gutterOf, isMirrored, paperCm, validatePage,
} from "../../state/page";
import { useApp } from "../../state/store";
import type { MarginsCm, PageSetup, PageSize } from "../../state/types";
import { Button, Dialog } from "../ui/Dialog";

type Tab = "margins" | "paper";

const input = "h-8 w-full rounded-md border border-line bg-surface px-2 pr-8 text-[13px] normal-case tracking-normal text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 aria-[invalid=true]:border-danger";
const label = "text-[11px] font-medium uppercase tracking-wide text-muted";

/** Number field in centimetres. The draft keeps what was typed (even NaN) so the validation can explain what is wrong. */
function CmField({ name, value, onChange, invalid, min = 0, max = MAX_MARGIN_CM }: { name: string; value: number; onChange: (v: number) => void; invalid?: boolean; min?: number; max?: number }) {
  return (
    <label className={label}>
      {name}
      <div className="relative mt-1">
        <input type="number" inputMode="decimal" min={min} max={max} step={0.01} value={Number.isNaN(value) ? "" : value} aria-label={`${name} (cm)`} aria-invalid={invalid || undefined} onChange={(e) => onChange(e.target.valueAsNumber)} className={input} />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] normal-case text-muted">cm</span>
      </div>
    </label>
  );
}

/** The page drawn to scale, with its text area. */
function Preview({ page }: { page: PageSetup }) {
  const { width, height } = paperCm(page);
  const [w, h] = page.orientation === "landscape" ? [height, width] : [width, height];
  const k = 120 / Math.max(w, h);
  const m = effectiveMarginsCm(page);
  const ok = Number.isFinite(w + h + m.left + m.right + m.top + m.bottom);
  return (
    <div className="flex h-[140px] items-center justify-center rounded-md bg-chrome" aria-hidden>
      {ok && (
        <div className="relative border border-line bg-white shadow-sm" style={{ width: w * k, height: h * k }}>
          <div className="absolute border border-dashed border-accent/70" style={{ left: Math.max(0, m.left * k), right: Math.max(0, m.right * k), top: Math.max(0, m.top * k), bottom: Math.max(0, m.bottom * k) }}>
            <div className="m-1 space-y-1">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-[2px] rounded bg-line" style={{ width: `${100 - (i % 3) * 14}%` }} />)}</div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * "Mise en page": margins (presets, custom, mirrored, binding) and paper (standard or custom size, orientation), in centimetres.
 * Nothing is applied until "Appliquer"; invalid values are explained and block it.
 */
export function PageSetupDialog({ initialTab }: { initialTab: Tab }) {
  const { state, set } = useApp();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [draft, setDraft] = useState<PageSetup>(state.page);
  const problems = validatePage(draft);
  const bad = (f: string) => problems.some((p) => p.field === f);
  const base = baseMarginsCm(draft);
  const mirrored = isMirrored(draft);
  const gutter = gutterOf(draft);
  const paper = paperCm(draft);
  const close = () => set({ dialog: null });

  const setMargin = (k: keyof MarginsCm, v: number) => setDraft((d) => ({ ...d, margins: "custom", customMarginsCm: { ...baseMarginsCm(d), [k]: v }, ...(isMirrored(d) ? { mirrored: true } : {}) }));
  const setPreset = (id: string) =>
    setDraft((d) => {
      if (id === "custom") return { ...d, margins: "custom", customMarginsCm: { ...baseMarginsCm(d) } };
      const { mirrored: _m, customMarginsCm: _c, ...rest } = d;
      return fitMargins({ ...rest, margins: id as PageSetup["margins"] });
    });
  const setMirrored = (on: boolean) => setDraft((d) => ({ ...d, margins: "custom", customMarginsCm: { ...baseMarginsCm(d) }, mirrored: on }));
  const setGutter = (patch: { cm?: number; pos?: "left" | "top" }) =>
    setDraft((d) => {
      const { gutterCm: _g, gutterPos: _p, ...rest } = d;
      const cm = patch.cm ?? gutterOf(d).cm;
      const pos = patch.pos ?? gutterOf(d).pos;
      return Number.isNaN(cm) || cm > 0 ? { ...rest, gutterCm: cm, ...(pos === "top" ? { gutterPos: "top" as const } : {}) } : rest;
    });
  const setPaper = (size: PageSize) =>
    setDraft((d) => fitMargins({ ...d, size, ...(size === "Custom" ? { customSizeCm: d.customSizeCm ?? paperCm(d) } : { customSizeCm: undefined }) }));
  const setCustomSize = (k: "width" | "height", v: number) => setDraft((d) => ({ ...d, size: "Custom", customSizeCm: { ...(d.customSizeCm ?? DEFAULT_CUSTOM_SIZE), [k]: v } }));
  const setOrientation = (o: PageSetup["orientation"]) => setDraft((d) => fitMargins({ ...d, orientation: o }));

  const apply = () => {
    if (problems.length) return;
    const { customSizeCm, ...rest } = draft;
    const next: PageSetup = draft.size === "Custom" ? { ...rest, customSizeCm } : rest;
    if (next.margins !== "custom") { delete next.customMarginsCm; delete next.mirrored; }
    if (!next.mirrored) delete next.mirrored;
    set((s) => ({ page: next, doc: { ...s.doc, dirty: true }, dialog: null }));
  };

  const preset = draft.margins === "custom" ? "custom" : draft.margins;
  const tabBtn = (id: Tab, text: string) => (
    <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn("h-8 rounded-md border px-3 text-[13px]", tab === id ? "border-accent bg-accent-soft text-accent" : "border-line hover:bg-hover")}>{text}</button>
  );

  return (
    <Dialog title="Mise en page" icon={FileText} onClose={close} width={600} backdropClose={false}
      footer={<><Button onClick={close}>Annuler</Button><Button variant="primary" disabled={problems.length > 0} onClick={apply}>Appliquer</Button></>}>
      <div className="grid gap-4 p-5 sm:grid-cols-[1fr_170px]">
        <div className="min-w-0 space-y-3">
          <div role="tablist" aria-label="Mise en page" className="flex gap-1.5">{tabBtn("margins", "Marges")}{tabBtn("paper", "Papier")}</div>

          {tab === "margins" && (
            <div className="space-y-3">
              <label className={label}>Préréglage
                <select aria-label="Préréglage de marges" value={preset} onChange={(e) => setPreset(e.target.value)} className={cn(input, "mt-1 pr-2")}>
                  {MARGIN_PRESETS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  <option value="custom">Personnalisées</option>
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <CmField name="Haut" value={base.top} onChange={(v) => setMargin("top", v)} invalid={bad("top")} />
                <CmField name="Bas" value={base.bottom} onChange={(v) => setMargin("bottom", v)} invalid={bad("bottom")} />
                <CmField name={mirrored ? "Intérieur" : "Gauche"} value={base.left} onChange={(v) => setMargin("left", v)} invalid={bad("left")} />
                <CmField name={mirrored ? "Extérieur" : "Droite"} value={base.right} onChange={(v) => setMargin("right", v)} invalid={bad("right")} />
              </div>
              <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={mirrored} onChange={(e) => setMirrored(e.target.checked)} /> Marges en miroir (impression recto verso)</label>
              <div className="grid grid-cols-2 gap-3">
                <CmField name="Marge de reliure" value={draft.gutterCm ?? 0} onChange={(v) => setGutter({ cm: v })} invalid={bad("gutter")} />
                <label className={label}>Position de la reliure
                  <select aria-label="Position de la reliure" value={gutter.pos} onChange={(e) => setGutter({ pos: e.target.value as "left" | "top" })} className={cn(input, "mt-1 pr-2")}>
                    <option value="left">Gauche</option>
                    <option value="top">Haut</option>
                  </select>
                </label>
              </div>
              {mirrored && <p className="text-[12px] text-muted">Les pages sont affichées avec la marge intérieure à gauche ; l'alternance recto verso est écrite dans le fichier et appliquée par Word ou LibreOffice à l'impression.</p>}
            </div>
          )}

          {tab === "paper" && (
            <div className="space-y-3">
              <label className={label}>Format du papier
                <select aria-label="Format du papier" value={draft.size} onChange={(e) => setPaper(e.target.value as PageSize)} className={cn(input, "mt-1 pr-2")}>
                  {PAPER_SIZES.map((p) => <option key={p.id} value={p.id}>{p.label} — {formatSize(p.width, p.height)}</option>)}
                  <option value="Custom">Personnalisé</option>
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <CmField name="Largeur" value={paper.width} onChange={(v) => setCustomSize("width", v)} invalid={bad("width")} min={CUSTOM_SIZE_LIMITS.min} max={CUSTOM_SIZE_LIMITS.max} />
                <CmField name="Hauteur" value={paper.height} onChange={(v) => setCustomSize("height", v)} invalid={bad("height")} min={CUSTOM_SIZE_LIMITS.min} max={CUSTOM_SIZE_LIMITS.max} />
              </div>
              <fieldset className="flex gap-2" aria-label="Orientation">
                {(["portrait", "landscape"] as const).map((o) => (
                  <button key={o} type="button" role="radio" aria-checked={draft.orientation === o} onClick={() => setOrientation(o)}
                    className={cn("flex h-9 flex-1 items-center justify-center gap-2 rounded-md border text-[13px]", draft.orientation === o ? "border-accent bg-accent-soft text-accent" : "border-line hover:bg-hover")}>
                    {o === "portrait" ? <RectangleVertical size={16} /> : <RectangleHorizontal size={16} />}{o === "portrait" ? "Portrait" : "Paysage"}
                  </button>
                ))}
              </fieldset>
              <p className="text-[12px] text-muted">Dimensions en portrait : {formatSize(paper.width, paper.height)}. Le contenu du document n'est pas modifié ; seuls les sauts de page automatiques sont recalculés.</p>
            </div>
          )}

          {problems.length > 0 && <ul role="alert" className="space-y-0.5 text-[12px] text-danger">{[...new Set(problems.map((p) => p.message))].map((m) => <li key={m}>{m}</li>)}</ul>}
        </div>
        <div className="space-y-1.5">
          <Preview page={draft} />
          <p className="text-center text-[11px] text-muted">{draft.size === "Custom" ? "Personnalisé" : paperCm(draft) && PAPER_SIZES.find((p) => p.id === draft.size)?.label} · {draft.orientation === "portrait" ? "Portrait" : "Paysage"}<br />Texte : {formatCm(Math.max(0, (draft.orientation === "landscape" ? paper.height : paper.width) - effectiveMarginsCm(draft).left - effectiveMarginsCm(draft).right))} cm de large</p>
        </div>
      </div>
    </Dialog>
  );
}
