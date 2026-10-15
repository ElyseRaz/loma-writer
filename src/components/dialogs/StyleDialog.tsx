import { Palette } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "../../lib/cn";
import { builtinStyle, cleanStyles, resolveStyle, STYLE_IDS, STYLE_LABELS, type DocStyles, type StyleDef, type StyleId } from "../../editor/docStyles";
import { useFontLists } from "../../editor/fonts";
import { useApp } from "../../state/store";
import { Button, Dialog } from "../ui/Dialog";

const field = "h-8 w-full rounded-md border border-line bg-surface px-2 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";
const label = "text-[11px] font-medium uppercase tracking-wide text-muted";

/** "Modifier le style…": font, colour, spacing and alignment of Normal, the headings, the quote and the code style. */
export function StyleDialog() {
  const { state, set } = useApp();
  const fonts = useFontLists();
  const defaults = { fontFamily: state.prefs.fontFamily, sizePt: state.prefs.fontSizePt };
  const [id, setId] = useState<StyleId>(state.styleTarget);
  const [draft, setDraft] = useState<DocStyles>(() => structuredClone({ ...state.docStyles, normal: { ...state.docStyles.normal, ...defaults, fontFamily: defaults.fontFamily, sizePt: defaults.sizePt } }));
  const cur = resolveStyle(id, draft, defaults);
  const base = builtinStyle(id, defaults);
  const patch = (p: StyleDef) => setDraft((d) => ({ ...d, [id]: { ...d[id], ...p } }));
  const fontList = useMemo(() => [...new Set(["Inter", "Ubuntu", ...fonts.word, ...fonts.system])], [fonts]);
  const close = () => set({ dialog: null });

  const apply = () => {
    const { normal, ...others } = cleanStyles(draft);
    // Normal's font and size are the document defaults (written to DOCX/ODT as such).
    set((s) => ({
      dialog: null,
      docStyles: { ...others, ...(normal && (({ fontFamily: _f, sizePt: _s, ...rest }) => (Object.keys(rest).length ? { normal: rest } : {}))(normal)) },
      prefs: { ...s.prefs, fontFamily: normal?.fontFamily ?? s.prefs.fontFamily, fontSizePt: normal?.sizePt ?? s.prefs.fontSizePt },
      doc: { ...s.doc, dirty: true },
    }));
  };
  const reset = () => setDraft((d) => { const n = { ...d }; delete n[id]; if (id === "normal") n.normal = { fontFamily: "Inter", sizePt: 11 }; return n; });

  const preview: React.CSSProperties = {
    fontFamily: `"${cur.fontFamily}", sans-serif`, fontSize: `${cur.sizePt}pt`, color: cur.color, fontWeight: cur.bold ? 700 : 400, fontStyle: cur.italic ? "italic" : "normal",
    textAlign: cur.align, lineHeight: cur.lineHeight, marginTop: `${Math.min(cur.spaceBefore, 24)}pt`, marginBottom: `${Math.min(cur.spaceAfter, 24)}pt`,
  };

  return (
    <Dialog title="Modifier le style" icon={Palette} onClose={close} width={520}
      footer={<><Button onClick={reset}>Rétablir ce style</Button><Button onClick={close}>Annuler</Button><Button variant="primary" onClick={apply}>Appliquer</Button></>}>
      <div className="space-y-3 p-5">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Style à modifier">
          {STYLE_IDS.map((s) => (
            <button key={s} role="tab" aria-selected={s === id} onClick={() => setId(s)}
              className={cn("h-7 rounded-md border px-2.5 text-[12px]", s === id ? "border-accent bg-accent-soft text-accent" : "border-line hover:bg-hover")}>{STYLE_LABELS[s]}</button>
          ))}
        </div>
        <div className="grid grid-cols-[1fr_84px] gap-3">
          <label className={label}>Police
            <input list="style-fonts" aria-label="Police" value={cur.fontFamily} onChange={(e) => patch({ fontFamily: e.target.value })} className={cn(field, "mt-1 normal-case tracking-normal text-fg")} />
            <datalist id="style-fonts">{fontList.map((f) => <option key={f} value={f} />)}</datalist>
          </label>
          <label className={label}>Taille (pt)
            <input type="number" min={6} max={96} step={0.5} aria-label="Taille" value={cur.sizePt} onChange={(e) => e.target.valueAsNumber > 0 && patch({ sizePt: e.target.valueAsNumber })} className={cn(field, "mt-1 text-fg")} />
          </label>
        </div>
        <div className="flex items-end gap-3">
          <label className={label}>Couleur
            <input type="color" aria-label="Couleur du style" value={cur.color} onChange={(e) => patch({ color: e.target.value })} className="mt-1 block h-8 w-12 cursor-pointer rounded-md border border-line bg-transparent p-0.5" />
          </label>
          <button aria-pressed={cur.bold} onClick={() => patch({ bold: !cur.bold })} className={cn("h-8 w-8 rounded-md border text-[14px] font-bold", cur.bold ? "border-accent bg-accent-soft text-accent" : "border-line hover:bg-hover")} title="Gras">G</button>
          <button aria-pressed={cur.italic} onClick={() => patch({ italic: !cur.italic })} className={cn("h-8 w-8 rounded-md border text-[14px] italic", cur.italic ? "border-accent bg-accent-soft text-accent" : "border-line hover:bg-hover")} title="Italique">I</button>
          <label className={cn(label, "ml-auto w-36")}>Alignement
            <select aria-label="Alignement" value={cur.align} onChange={(e) => patch({ align: e.target.value as StyleDef["align"] })} className={cn(field, "mt-1 text-fg")}>
              <option value="left">À gauche</option><option value="center">Centré</option><option value="right">À droite</option><option value="justify">Justifié</option>
            </select>
          </label>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {([["spaceBefore", "Avant (pt)", 0, 200, 1], ["spaceAfter", "Après (pt)", 0, 200, 1], ["lineHeight", "Interligne", 0.8, 3, 0.05]] as const).map(([k, l, min, max, step]) => (
            <label key={k} className={label}>{l}
              <input type="number" min={min} max={max} step={step} aria-label={l} value={cur[k]} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && patch({ [k]: e.target.valueAsNumber })} className={cn(field, "mt-1 text-fg")} />
            </label>
          ))}
        </div>
        <div className="rounded-md border border-line bg-white p-3 text-black" aria-label="Aperçu">
          <div style={preview}>{id === "normal" ? "Texte de paragraphe — AaBbCc 123" : `${STYLE_LABELS[id]} — AaBbCc 123`}</div>
        </div>
        {JSON.stringify(cur) === JSON.stringify(base) && <p className="text-[12px] text-muted">Ce style a son aspect d'origine.</p>}
      </div>
    </Dialog>
  );
}
