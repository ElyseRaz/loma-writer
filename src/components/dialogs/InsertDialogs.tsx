import katex from "katex";
import { BookMarked, BookOpen, ChartColumn, Plus, Search, Sigma, Trash2, Smile, Bookmark as BookmarkIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import { useLomaEditor } from "../../editor/EditorProvider";
import { useApp } from "../../state/store";
import { chartAltText, chartIsValid, renderChart, type ChartSpec, type ChartType, CHART_COLORS } from "../../services/insert/chart";
import { COVER_STYLES, coverPageBlocks, type CoverFields, type CoverStyle } from "../../services/insert/coverPage";
import { ICONS, renderIcon } from "../../services/insert/icons";
import { ensureHeadingAnchor, gotoBookmark, isValidBookmarkName, listBookmarks, listHeadings, normalizeBookmarkName } from "../../services/insert/bookmarks";
import { Button, Dialog } from "../ui/Dialog";

const field = "h-8 w-full rounded-md border border-line bg-surface px-2 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";
const label = "text-[11px] font-medium uppercase tracking-wide text-muted";

// ---------- Page de garde ----------
export function CoverPageDialog() {
  const editor = useLomaEditor();
  const { state, set } = useApp();
  const [style, setStyle] = useState<CoverStyle>("classic");
  const [f, setF] = useState<CoverFields>({ title: state.doc.title === "Document sans titre" ? "" : state.doc.title, subtitle: "", author: "", date: new Date().toLocaleDateString("fr-FR", { dateStyle: "long" }) });
  const close = () => set({ dialog: null });
  const insert = () => {
    editor?.chain().focus().insertContentAt(0, coverPageBlocks(style, f)).run();
    set((s) => ({ dialog: null, doc: { ...s.doc, dirty: true } }));
  };
  const input = (k: keyof CoverFields, text: string, ph = "") => (
    <label className={label}>{text}<input value={f[k]} placeholder={ph} onChange={(e) => setF({ ...f, [k]: e.target.value })} className={cn(field, "mt-1 normal-case tracking-normal text-fg")} /></label>
  );
  return (
    <Dialog title="Page de garde" icon={BookOpen} onClose={close} width={560} footer={<><Button onClick={close}>Annuler</Button><Button variant="primary" onClick={insert}>Insérer au début</Button></>}>
      <div className="space-y-4 p-5">
        <div className="grid grid-cols-3 gap-3">
          {COVER_STYLES.map((s) => (
            <button key={s.id} onClick={() => setStyle(s.id)} aria-pressed={style === s.id} className={cn("rounded-lg border p-2 text-left hover:bg-hover", style === s.id ? "border-accent ring-1 ring-accent" : "border-line")}>
              <div className="mb-2 flex h-16 flex-col justify-center gap-1 rounded bg-chrome px-2" style={{ alignItems: s.id === "modern" ? "flex-start" : "center" }}>
                <div className="h-2 w-3/4 rounded-sm" style={{ background: s.id === "modern" ? "#1d4ed8" : "#374151" }} />
                {s.id !== "plain" ? <div className="h-1 w-1/2 rounded-sm bg-muted/50" /> : <div className="h-px w-3/4 bg-muted" />}
              </div>
              <div className="text-[12px] font-medium">{s.label}</div>
              <div className="text-[11px] text-muted">{s.hint}</div>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">{input("title", "Titre", "Titre du document")}</div>
          <div className="col-span-2">{input("subtitle", "Sous-titre")}</div>
          {input("author", "Auteur")}
          {input("date", "Date")}
        </div>
        <p className="text-[12px] text-muted">La page de garde est ajoutée au début du document, suivie d'un saut de page.</p>
      </div>
    </Dialog>
  );
}

// ---------- Icônes ----------
const ICON_COLORS = ["#242424", "#2563eb", "#16a34a", "#dc2626", "#ea580c", "#7c3aed", "#6b7280"];
export function IconsDialog() {
  const editor = useLomaEditor();
  const { set, notify } = useApp();
  const [query, setQuery] = useState("");
  const [color, setColor] = useState(ICON_COLORS[1]);
  const [size, setSize] = useState(48);
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => ICONS.filter((i) => !q || i.label.toLowerCase().includes(q)), [q]);
  const close = () => set({ dialog: null });
  const insert = async (id: string) => {
    const def = ICONS.find((i) => i.id === id)!;
    try {
      const png = await renderIcon(def, color, size);
      editor?.chain().focus().insertContent({ type: "image", attrs: { src: png.src, alt: `Icône : ${def.label}`, width: size, height: size } }).run();
      set((s) => ({ dialog: null, doc: { ...s.doc, dirty: true } }));
    } catch (e) {
      notify(`Insertion impossible : ${e instanceof Error ? e.message : e}`, "error");
    }
  };
  return (
    <Dialog title="Icônes" icon={Smile} onClose={close} width={600} footer={<Button onClick={close}>Fermer</Button>}>
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex h-8 min-w-[200px] flex-1 items-center gap-2 rounded-md border border-line bg-surface px-2 text-muted focus-within:border-accent"><Search size={14} /><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher une icône" aria-label="Rechercher une icône" className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none" /></label>
          <div className="flex gap-1" role="group" aria-label="Couleur">{ICON_COLORS.map((c) => <button key={c} aria-label={c} title={c} aria-pressed={color === c} onClick={() => setColor(c)} style={{ background: c }} className={cn("h-6 w-6 rounded-full border border-black/10", color === c && "ring-2 ring-accent ring-offset-1")} />)}</div>
          <select aria-label="Taille" value={size} onChange={(e) => setSize(+e.target.value)} className="h-8 rounded-md border border-line bg-surface px-2 text-[13px]">{[24, 32, 48, 64, 96].map((s) => <option key={s} value={s}>{s} px</option>)}</select>
        </div>
        <div className="grid max-h-[320px] grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-1.5 overflow-y-auto">
          {shown.map((i) => (
            <button key={i.id} title={i.label} onClick={() => void insert(i.id)} className="flex h-[72px] flex-col items-center justify-center gap-1 rounded-md border border-transparent hover:border-line hover:bg-hover">
              <i.icon size={26} color={color} strokeWidth={1.75} />
              <span className="max-w-full truncate px-1 text-[10.5px] text-muted">{i.label}</span>
            </button>
          ))}
          {shown.length === 0 && <p className="col-span-full py-6 text-center text-[13px] text-muted">Aucune icône ne correspond.</p>}
        </div>
      </div>
    </Dialog>
  );
}

// ---------- Graphique ----------
const parseNum = (v: string) => Number(v.trim().replace(",", ".").replace(/\s/g, ""));
export function ChartDialog() {
  const editor = useLomaEditor();
  const { set, notify } = useApp();
  const [type, setType] = useState<ChartType>("bar");
  const [title, setTitle] = useState("Ventes par trimestre");
  const [seriesNames, setSeriesNames] = useState(["2025"]);
  const [labels, setLabels] = useState(["T1", "T2", "T3", "T4"]);
  const [cells, setCells] = useState<string[][]>([["12"], ["19"], ["8"], ["15"]]); // [row][series]
  const spec: ChartSpec = { type, title, labels, series: seriesNames.map((name, si) => ({ name, values: cells.map((r) => parseNum(r[si] ?? "")) })) };
  const valid = chartIsValid(spec) && labels.every((l) => l.trim());
  const preview = useMemo(() => (valid ? renderChart(spec, 420, 255).src : null), [valid, type, title, JSON.stringify(labels), JSON.stringify(cells), JSON.stringify(seriesNames)]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => set({ dialog: null });
  const insert = () => {
    if (!valid) return notify("Complétez le tableau : chaque case doit contenir un nombre.", "error");
    const png = renderChart(spec);
    editor?.chain().focus().insertContent({ type: "image", attrs: { src: png.src, alt: chartAltText(spec), width: png.width, height: png.height } }).run();
    set((s) => ({ dialog: null, doc: { ...s.doc, dirty: true } }));
  };
  const setCell = (r: number, c: number, v: string) => setCells(cells.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)));
  const cellInput = "h-7 w-full rounded border border-line bg-surface px-1.5 text-[12px] outline-none focus:border-accent";
  return (
    <Dialog title="Graphique" icon={ChartColumn} onClose={close} width={760} footer={<><Button onClick={close}>Annuler</Button><Button variant="primary" onClick={insert} disabled={!valid}>Insérer</Button></>}>
      <div className="grid grid-cols-[1fr_300px] gap-5 p-5">
        <div className="space-y-3">
          <div className="flex gap-2" role="radiogroup" aria-label="Type de graphique">
            {([["bar", "Histogramme"], ["line", "Courbes"], ["pie", "Secteurs"]] as const).map(([id, text]) => (
              <button key={id} role="radio" aria-checked={type === id} onClick={() => setType(id)} className={cn("h-8 flex-1 rounded-md border text-[12px]", type === id ? "border-accent bg-accent-soft text-accent" : "border-line hover:bg-hover")}>{text}</button>
            ))}
          </div>
          <label className={label}>Titre<input value={title} onChange={(e) => setTitle(e.target.value)} className={cn(field, "mt-1 normal-case tracking-normal text-fg")} /></label>
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-1 text-[12px]">
              <thead><tr><th className="w-28 text-left font-medium text-muted">Catégorie</th>{seriesNames.map((n, si) => (
                <th key={si} className="min-w-[88px]"><span className="flex items-center gap-1"><span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: CHART_COLORS[si] }} /><input aria-label={`Nom de la série ${si + 1}`} value={n} onChange={(e) => setSeriesNames(seriesNames.map((x, i) => (i === si ? e.target.value : x)))} className={cellInput} /></span></th>
              ))}<th /></tr></thead>
              <tbody>
                {labels.map((l, r) => (
                  <tr key={r}>
                    <td><input aria-label={`Catégorie ${r + 1}`} value={l} onChange={(e) => setLabels(labels.map((x, i) => (i === r ? e.target.value : x)))} className={cellInput} /></td>
                    {seriesNames.map((_, c) => <td key={c}><input aria-label={`Valeur ${r + 1}, série ${c + 1}`} inputMode="decimal" value={cells[r][c] ?? ""} onChange={(e) => setCell(r, c, e.target.value)} className={cn(cellInput, "text-right", cells[r][c] !== undefined && !Number.isFinite(parseNum(cells[r][c])) && "border-danger")} /></td>)}
                    <td><button aria-label={`Supprimer la ligne ${r + 1}`} disabled={labels.length <= 1} onClick={() => { setLabels(labels.filter((_, i) => i !== r)); setCells(cells.filter((_, i) => i !== r)); }} className="flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-hover disabled:opacity-30"><Trash2 size={13} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <Button className="h-7 px-2 text-[12px]" disabled={labels.length >= 12} onClick={() => { setLabels([...labels, `Cat. ${labels.length + 1}`]); setCells([...cells, seriesNames.map(() => "0")]); }}><Plus size={12} /> Ligne</Button>
            <Button className="h-7 px-2 text-[12px]" disabled={seriesNames.length >= 3 || type === "pie"} onClick={() => { setSeriesNames([...seriesNames, `Série ${seriesNames.length + 1}`]); setCells(cells.map((r) => [...r, "0"])); }}><Plus size={12} /> Série</Button>
            <Button className="h-7 px-2 text-[12px]" disabled={seriesNames.length <= 1} onClick={() => { setSeriesNames(seriesNames.slice(0, -1)); setCells(cells.map((r) => r.slice(0, -1))); }}>− Série</Button>
          </div>
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-[255px] w-full items-center justify-center overflow-hidden rounded-md border border-line bg-white">{preview ? <img src={preview} alt="Aperçu du graphique" className="max-h-full max-w-full" /> : <span className="px-4 text-center text-[12px] text-muted">Saisissez des nombres pour voir l'aperçu.</span>}</div>
          <p className="text-[11px] leading-4 text-muted">Le graphique est inséré comme une image : il garde son aspect dans Word et LibreOffice, mais ne peut plus être modifié ensuite. Les données restent dans le texte alternatif.</p>
        </div>
      </div>
    </Dialog>
  );
}

// ---------- Signet ----------
export function BookmarkDialog() {
  const editor = useLomaEditor();
  const { set, notify } = useApp();
  const [name, setName] = useState("");
  const [tick, setTick] = useState(0);
  const bookmarks = useMemo(() => (editor ? listBookmarks(editor.state.doc) : []), [editor, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const normalized = normalizeBookmarkName(name);
  const valid = isValidBookmarkName(normalized);
  const exists = bookmarks.some((b) => b.name === normalized);
  const close = () => set({ dialog: null });
  const add = () => {
    if (!editor || !valid) return;
    editor.chain().focus().insertBookmark(normalized).run();
    set((s) => ({ dialog: null, doc: { ...s.doc, dirty: true } }));
    notify(exists ? `Signet « ${normalized} » déplacé.` : `Signet « ${normalized} » ajouté.`);
  };
  return (
    <Dialog title="Signet" icon={BookmarkIcon} onClose={close} width={460} footer={<Button onClick={close}>Fermer</Button>}>
      <div className="space-y-3 p-5">
        <label className={label}>Nom du signet
          <div className="mt-1 flex gap-2">
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} aria-invalid={!!name && !valid} placeholder="ex. Conclusion" className={cn(field, "normal-case tracking-normal text-fg")} />
            <Button variant="primary" onClick={add} disabled={!valid}>{exists ? "Déplacer ici" : "Ajouter"}</Button>
          </div>
        </label>
        {name && !valid && <p role="alert" className="text-[12px] text-danger">Le nom doit commencer par une lettre et ne contenir que des lettres, chiffres et « _ » (40 caractères au maximum).</p>}
        {name && valid && normalized !== name.trim() && <p className="text-[12px] text-muted">Sera enregistré sous « {normalized} ».</p>}
        <div>
          <div className={label}>Signets du document</div>
          {bookmarks.length === 0 ? <p className="py-3 text-[12.5px] text-muted">Aucun signet pour l'instant. Placez le curseur à l'endroit voulu puis ajoutez-en un.</p> : (
            <ul className="mt-1 max-h-48 divide-y divide-line overflow-y-auto rounded-md border border-line">
              {bookmarks.map((b) => (
                <li key={b.name} className="flex items-center gap-2 px-3 py-1.5 text-[13px]">
                  <BookMarked size={14} className="text-accent" /><span className="flex-1 truncate">{b.name}</span>
                  <Button className="h-6 px-2 text-[11px]" onClick={() => { if (editor && gotoBookmark(editor, b.name)) close(); }}>Atteindre</Button>
                  <button aria-label={`Supprimer le signet ${b.name}`} onClick={() => { editor?.commands.removeBookmark(b.name); setTick((t) => t + 1); }} className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-hover"><Trash2 size={13} /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Dialog>
  );
}

// ---------- Renvoi ----------
export function CrossRefDialog() {
  const editor = useLomaEditor();
  const { set, notify } = useApp();
  const bookmarks = useMemo(() => (editor ? listBookmarks(editor.state.doc).filter((b) => !b.name.startsWith("Titre_")) : []), [editor]);
  const headings = useMemo(() => (editor ? listHeadings(editor.state.doc) : []), [editor]);
  const [target, setTarget] = useState<{ kind: "bookmark"; name: string } | { kind: "heading"; index: number } | null>(null);
  const [text, setText] = useState("");
  const choose = (t: NonNullable<typeof target>, suggestion: string) => { setTarget(t); setText(suggestion); };
  const close = () => set({ dialog: null });
  const insert = () => {
    if (!editor || !target) return;
    const name = target.kind === "bookmark" ? target.name : ensureHeadingAnchor(editor, headings[target.index]);
    editor.chain().focus().insertContent({ type: "text", text: text.trim() || name, marks: [{ type: "link", attrs: { href: `#${encodeURIComponent(name)}` } }] }).run();
    set((s) => ({ dialog: null, doc: { ...s.doc, dirty: true } }));
    notify("Renvoi inséré. Ctrl+clic sur le lien pour y aller.");
  };
  const row = (active: boolean) => cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-hover", active && "bg-accent-soft text-accent");
  return (
    <Dialog title="Renvoi" icon={BookMarked} onClose={close} width={500} footer={<><Button onClick={close}>Annuler</Button><Button variant="primary" onClick={insert} disabled={!target}>Insérer</Button></>}>
      <div className="space-y-3 p-5">
        <div className={label}>Titres</div>
        {headings.length === 0 ? <p className="text-[12.5px] text-muted">Aucun titre (Titre 1, 2, 3) dans le document.</p> : (
          <ul className="max-h-40 divide-y divide-line overflow-y-auto rounded-md border border-line" role="listbox" aria-label="Titres">
            {headings.map((h, i) => <li key={h.pos}><button role="option" aria-selected={target?.kind === "heading" && target.index === i} onClick={() => choose({ kind: "heading", index: i }, h.text)} style={{ paddingLeft: 12 + (h.level - 1) * 14 }} className={row(target?.kind === "heading" && target.index === i)}><span className="truncate">{h.text}</span></button></li>)}
          </ul>
        )}
        <div className={label}>Signets</div>
        {bookmarks.length === 0 ? <p className="text-[12.5px] text-muted">Aucun signet. Ajoutez-en avec « Signet ».</p> : (
          <ul className="max-h-32 divide-y divide-line overflow-y-auto rounded-md border border-line" role="listbox" aria-label="Signets">
            {bookmarks.map((b) => <li key={b.name}><button role="option" aria-selected={target?.kind === "bookmark" && target.name === b.name} onClick={() => choose({ kind: "bookmark", name: b.name }, b.name)} className={row(target?.kind === "bookmark" && target.name === b.name)}><BookMarked size={13} /><span className="truncate">{b.name}</span></button></li>)}
          </ul>
        )}
        <label className={label}>Texte du renvoi<input value={text} onChange={(e) => setText(e.target.value)} placeholder="Choisissez une cible" className={cn(field, "mt-1 normal-case tracking-normal text-fg")} /></label>
      </div>
    </Dialog>
  );
}

// ---------- Équation ----------
const EQUATION_TEMPLATES: Array<[string, string]> = [
  ["Fraction", "\\frac{a}{b}"], ["Racine", "\\sqrt{x}"], ["Exposant", "x^{2}"], ["Indice", "x_{i}"], ["Somme", "\\sum_{i=1}^{n} i"],
  ["Intégrale", "\\int_{a}^{b} f(x)\\,dx"], ["Limite", "\\lim_{x \\to \\infty} f(x)"], ["Matrice", "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}"],
  ["Grec", "\\alpha + \\beta = \\gamma"], ["Quadratique", "x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}"],
];
export function EquationDialog() {
  const editor = useLomaEditor();
  const { state, set } = useApp();
  const editing = state.equationPos;
  const [latex, setLatex] = useState(() => (editing !== null ? String(editor?.state.doc.nodeAt(editing)?.attrs.latex ?? "") : ""));
  const area = useRef<HTMLTextAreaElement>(null);
  const html = useMemo(() => {
    try { return { ok: true as const, html: katex.renderToString(latex || "\;", { throwOnError: true, displayMode: false }) }; } catch (e) { return { ok: false as const, html: "", error: e instanceof Error ? e.message.replace(/^KaTeX parse error: /, "") : String(e) }; }
  }, [latex]);
  useEffect(() => area.current?.focus(), []);
  const close = () => set({ dialog: null, equationPos: null });
  const apply = () => {
    if (!editor || !latex.trim() || !html.ok) return;
    if (editing !== null) editor.chain().focus().updateEquation(editing, latex.trim()).run();
    else editor.chain().focus().insertEquation(latex.trim()).run();
    set((s) => ({ dialog: null, equationPos: null, doc: { ...s.doc, dirty: true } }));
  };
  const add = (snippet: string) => {
    const el = area.current;
    if (!el) return setLatex(latex + snippet);
    const { selectionStart: a, selectionEnd: b } = el;
    setLatex(latex.slice(0, a) + snippet + latex.slice(b));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + snippet.length, a + snippet.length); });
  };
  return (
    <Dialog title={editing !== null ? "Modifier l'équation" : "Équation"} icon={Sigma} onClose={close} width={560} footer={<><Button onClick={close}>Annuler</Button><Button variant="primary" onClick={apply} disabled={!latex.trim() || !html.ok}>{editing !== null ? "Appliquer" : "Insérer"}</Button></>}>
      <div className="space-y-3 p-5">
        <div className="flex flex-wrap gap-1.5">{EQUATION_TEMPLATES.map(([n, s]) => <button key={n} onClick={() => add(s)} className="h-7 rounded-md border border-line px-2 text-[12px] hover:bg-hover">{n}</button>)}</div>
        <label className={label}>Formule (LaTeX)
          <textarea ref={area} value={latex} onChange={(e) => setLatex(e.target.value)} rows={3} spellCheck={false} aria-invalid={!html.ok} placeholder="ex. E = mc^2" className="mt-1 w-full rounded-md border border-line bg-surface p-2 font-mono text-[13px] normal-case tracking-normal text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" />
        </label>
        <div>
          <div className={label}>Aperçu</div>
          <div className="mt-1 flex min-h-[64px] items-center justify-center overflow-x-auto rounded-md border border-line bg-white p-3 text-[20px] text-[#1b1c1c]" aria-live="polite">
            {html.ok ? <span dangerouslySetInnerHTML={{ __html: html.html }} /> : <span role="alert" className="text-[12px] text-danger">{html.error}</span>}
          </div>
        </div>
        <p className="text-[11.5px] text-muted">Dans un fichier DOCX ou ODT, l'équation est enregistrée comme texte LaTeX entre « \( » et « \) » ; Loma Writer la reconnaît à la réouverture.</p>
      </div>
    </Dialog>
  );
}
