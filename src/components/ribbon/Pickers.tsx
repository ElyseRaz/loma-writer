import { Shapes, Baseline, ChevronDown, Grid2x2, Highlighter, PaintBucket, PanelBottom, PanelLeft, PanelRight, PanelTop, Square, SquareDashed } from "lucide-react";
import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { FONT_FAMILIES, FONT_SIZES, HIGHLIGHT_COLORS, LINE_HEIGHTS, MAX_FONT_PT, MIN_FONT_PT, TEXT_COLORS, parsePt } from "../../editor/commands";
import type { EditorSnapshot } from "../../editor/useEditorSnapshot";
import { useApp } from "../../state/store";
import { SHAPE_CATEGORIES, SHAPES } from "../../editor/shapes/catalog";
import { shapeSvg } from "../../editor/shapes/Shape";
import { BULLET_TYPES, NUMBER_TYPES } from "../../editor/ListTypes";
import { useFontLists } from "../../editor/fonts";
import { MenuList } from "../ui/Menu";
import { Popover, usePopover } from "../ui/Popover";
import { ColorPicker } from "../ui/ColorPicker";
import { DropdownButton } from "../ui/Dropdown";

/** Font list with a search box (type to filter, Enter picks the first match). */
export function FontFamilyPicker({ editor, snap }: { editor: Editor | null; snap: EditorSnapshot }) {
  const { state } = useApp();
  const fonts = useFontLists();
  const pop = usePopover();
  const [query, setQuery] = useState("");
  const current = snap.fontFamily ?? state.prefs.fontFamily;
  const norm = (v: string) => v.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  const q = norm(query.trim());
  const match = (list: string[]) => (q ? list.filter((f) => norm(f).includes(q)) : list);
  const groups = [
    { title: "Polices de l'application", list: match(FONT_FAMILIES) },
    { title: "Polices de Word", list: match(fonts.word) },
    { title: "Autres polices du système", list: match(fonts.system) },
  ].filter((g) => g.list.length);
  const first = groups[0]?.list[0];
  const pick = (f: string) => { pop.close(); setQuery(""); editor?.chain().focus().setFontFamily(f).run(); };
  return (
    <>
      <button
        type="button"
        title="Police"
        aria-label="Police"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => { setQuery(""); pop.toggle(e.currentTarget); }}
        style={{ width: 128, fontFamily: current }}
        className="flex h-6 items-center justify-between rounded-md border border-line bg-surface px-2 text-[12px] hover:bg-hover"
      >
        <span className="truncate">{current}</span>
        <ChevronDown size={10} className="ml-1 shrink-0 text-muted" />
      </button>
      {pop.anchor && (
        <Popover anchor={pop.anchor} onClose={() => { pop.close(); setQuery(""); }} className="w-[240px]">
          <div className="border-b border-line p-1.5">
            <input
              autoFocus
              type="search"
              aria-label="Rechercher une police"
              placeholder="Rechercher une police…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && first) { e.preventDefault(); pick(first); } }}
              className="h-7 w-full rounded-md border border-line bg-surface px-2 text-[12px] outline-none focus:border-accent"
            />
          </div>
          <div className="max-h-72 overflow-y-auto py-0.5" role="listbox" aria-label="Polices">
            {groups.map((g) => (
              <div key={g.title}>
                <div className="px-2 pb-0.5 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-muted">{g.title}</div>
                {g.list.map((f) => (
                  <button
                    key={f}
                    role="option"
                    aria-selected={f.toLowerCase() === current.toLowerCase()}
                    onClick={() => pick(f)}
                    style={{ fontFamily: `"${f}"` }}
                    className={`flex h-7 w-full items-center rounded-md px-2 text-left text-[13px] hover:bg-hover ${f.toLowerCase() === current.toLowerCase() ? "text-accent" : ""}`}
                  >
                    <span className="truncate">{f}</span>
                  </button>
                ))}
              </div>
            ))}
            {!groups.length && <div className="px-3 py-3 text-[12px] text-muted">Aucune police trouvée.</div>}
          </div>
        </Popover>
      )}
    </>
  );
}

/** Size box: type any size (1 to 1638 pt) or pick one from the list. */
export function FontSizePicker({ editor, snap }: { editor: Editor | null; snap: EditorSnapshot }) {
  const { state } = useApp();
  const pop = usePopover();
  const current = parsePt(snap.fontSize) ?? state.prefs.fontSizePt;
  const [text, setText] = useState<string | null>(null);
  const apply = (n: number) => {
    if (!Number.isFinite(n) || n < MIN_FONT_PT) return;
    editor?.chain().focus().setFontSize(`${Math.min(MAX_FONT_PT, Math.round(n * 2) / 2)}pt`).run();
  };
  const commit = () => { if (text !== null) apply(parseFloat(text.replace(",", "."))); setText(null); };
  return (
    <>
      <div className="flex h-6 w-[58px] items-center rounded-md border border-line bg-surface focus-within:border-accent">
        <input
          aria-label="Taille de police"
          title="Taille de police (de 1 à 1638)"
          inputMode="decimal"
          value={text ?? String(current)}
          onFocus={(e) => { setText(String(current)); e.currentTarget.select(); }}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => setText(null)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            else if (e.key === "Escape") { setText(null); editor?.commands.focus(); }
          }}
          className="h-full min-w-0 flex-1 bg-transparent px-1.5 text-[12px] outline-none"
        />
        <button
          type="button"
          aria-label="Tailles proposées"
          title="Tailles proposées"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => pop.toggle(e.currentTarget.parentElement as HTMLElement)}
          className="flex h-full w-4 items-center justify-center hover:bg-hover"
        >
          <ChevronDown size={10} className="text-muted" />
        </button>
      </div>
      {pop.anchor && (
        <Popover anchor={pop.anchor} onClose={pop.close} className="max-h-72 overflow-y-auto">
          <MenuList items={FONT_SIZES.map((n) => ({ label: String(n), checked: n === current, onSelect: () => apply(n) }))} onClose={pop.close} />
        </Popover>
      )}
    </>
  );
}

/** Border colours offered for tables. */
export const TEXT_COLORS_TABLE = ["#000000", "#6b7280", "#d1d5db", "#2563eb", "#16a34a", "#ea580c", "#dc2626", "#7c3aed"];

export function Swatches({ colors, onPick, onLive, onReset, resetLabel, current }: { colors: string[]; onPick: (c: string) => void; onLive: (c: string) => void; onReset: () => void; resetLabel: string; current?: string | null }) {
  const [more, setMore] = useState(false);
  return (
    <div className="p-1.5">
      <div className="grid w-[168px] grid-cols-4 gap-1.5">
        {colors.map((c) => (
          <button key={c} aria-label={c} title={c} onClick={() => onPick(c)} style={{ background: c }} className="h-7 rounded border border-black/10 hover:scale-105" />
        ))}
      </div>
      <button onClick={onReset} className="mt-2 h-7 w-full rounded-md text-[12px] hover:bg-hover">{resetLabel}</button>
      <button onClick={() => setMore((m) => !m)} aria-expanded={more} className="h-7 w-full rounded-md text-[12px] hover:bg-hover">{more ? "Moins de couleurs" : "Autres couleurs…"}</button>
      {/* The panel stays open while the colour is chosen: the colour is applied when the pointer is released. */}
      {more && <div className="mt-1 border-t border-line pt-1"><ColorPicker value={/^#[0-9a-f]{6}$/i.test(current ?? "") ? (current as string) : "#2563eb"} onCommit={onLive} /></div>}
    </div>
  );
}

export function HighlightPicker({ editor, snap }: { editor: Editor | null; snap: EditorSnapshot }) {
  return (
    <DropdownButton
      icon={Highlighter}
      title="Couleur de surlignage"
      active={snap.highlight}
      panel={(close) => (
        <Swatches
          colors={HIGHLIGHT_COLORS}
          resetLabel="Aucune couleur"
          onPick={(c) => { close(); editor?.chain().focus().setHighlight({ color: c }).run(); }}
          onLive={(c) => editor?.chain().focus().setHighlight({ color: c }).run()}
          onReset={() => { close(); editor?.chain().focus().unsetHighlight().run(); }}
        />
      )}
    />
  );
}

export function TextColorPicker({ editor, snap }: { editor: Editor | null; snap: EditorSnapshot }) {
  return (
    <DropdownButton
      icon={Baseline}
      title="Couleur de police"
      iconClassName=""
      panel={(close) => (
        <Swatches
          colors={TEXT_COLORS}
          resetLabel="Automatique"
          current={snap.color}
          onPick={(c) => { close(); editor?.chain().focus().setColor(c).run(); }}
          onLive={(c) => editor?.chain().focus().setColor(c).run()}
          onReset={() => { close(); editor?.chain().focus().unsetColor().run(); }}
        />
      )}
    >
      <span className="absolute bottom-0.5 left-1.5 right-1.5 h-[3px] rounded-full" style={{ background: snap.color ?? "var(--c-fg)" }} />
    </DropdownButton>
  );
}

export function LineSpacingPicker({ icon, editor, snap }: { icon: Parameters<typeof DropdownButton>[0]["icon"]; editor: Editor | null; snap: EditorSnapshot }) {
  return (
    <DropdownButton
      icon={icon}
      title="Interligne"
      items={[
        ...LINE_HEIGHTS.map((h) => ({ label: h.replace(".", ","), checked: snap.lineHeight === h, onSelect: () => editor?.chain().focus().setLineHeight(h).run() })),
        { separator: true as const },
        { label: "Interligne par défaut", onSelect: () => editor?.chain().focus().unsetLineHeight().run() },
      ]}
    />
  );
}

/** Rows × columns hover grid, like the Word table picker. */
export function TableGridPanel({ onPick, onCustom }: { onPick: (rows: number, cols: number) => void; onCustom?: () => void }) {
  const [hover, setHover] = useState({ r: 0, c: 0 });
  const ROWS = 6;
  const COLS = 8;
  return (
    <div className="p-2">
      <div className="mb-1.5 text-[12px] font-medium">{hover.r ? `${hover.c} × ${hover.r} tableau` : "Insérer un tableau"}</div>
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${COLS}, 18px)` }} onMouseLeave={() => setHover({ r: 0, c: 0 })}>
        {Array.from({ length: ROWS * COLS }, (_, i) => {
          const r = Math.floor(i / COLS) + 1;
          const c = (i % COLS) + 1;
          const on = r <= hover.r && c <= hover.c;
          return (
            <button
              key={i}
              aria-label={`${c} colonnes, ${r} lignes`}
              onMouseEnter={() => setHover({ r, c })}
              onClick={() => onPick(r, c)}
              className={`h-[18px] w-[18px] rounded-sm border ${on ? "border-accent bg-accent-soft" : "border-line"}`}
            />
          );
        })}
      </div>
      {onCustom && <button onClick={onCustom} className="mt-2 h-7 w-full rounded-md border border-line text-[12px] hover:bg-hover">Insérer un tableau…</button>}
    </div>
  );
}


export const SHADING_COLORS = ["#fef08a", "#bbf7d0", "#bfdbfe", "#fbcfe8", "#fed7aa", "#e9d5ff", "#e5e7eb", "#fecaca"];

/** "Trame de fond": background of the selected paragraphs or table cells. */
export function ShadingPicker({ editor }: { editor: Editor | null }) {
  return (
    <DropdownButton
      icon={PaintBucket}
      title="Trame de fond"
      panel={(close) => (
        <Swatches
          colors={SHADING_COLORS}
          resetLabel="Aucune couleur"
          onPick={(c) => { close(); editor?.chain().focus().setShading(c).run(); }}
          onLive={(c) => editor?.chain().focus().setShading(c).run()}
          onReset={() => { close(); editor?.chain().focus().setShading(null).run(); }}
        />
      )}
    />
  );
}

/** "Bordures": sides of the selected paragraphs; all/none for selected table cells. */
export function BordersPicker({ editor }: { editor: Editor | null }) {
  const run = (mode: "top" | "bottom" | "left" | "right" | "all" | "none") => () => editor?.chain().focus().setBorders(mode).run();
  return (
    <DropdownButton
      icon={Grid2x2}
      title="Bordures"
      items={[
        { label: "Bordure du bas", icon: PanelBottom, onSelect: run("bottom") },
        { label: "Bordure du haut", icon: PanelTop, onSelect: run("top") },
        { label: "Bordure gauche", icon: PanelLeft, onSelect: run("left") },
        { label: "Bordure droite", icon: PanelRight, onSelect: run("right") },
        { separator: true as const },
        { label: "Toutes les bordures", icon: Square, onSelect: run("all") },
        { label: "Aucune bordure", icon: SquareDashed, onSelect: run("none") },
      ]}
    />
  );
}

/** "Formes": the gallery of drawing shapes, by category. Inserted shapes stay editable. */
export function ShapesPicker({ editor }: { editor: Editor | null }) {
  return (
    <DropdownButton
      icon={Shapes}
      size="lg"
      label="Formes"
      panel={(close) => (
        <div className="max-h-[420px] w-[316px] overflow-y-auto p-2">
          {SHAPE_CATEGORIES.map((cat) => (
            <div key={cat} className="mb-2">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">{cat}</div>
              <div className="grid grid-cols-6 gap-1">
                {SHAPES.filter((s) => s.category === cat).map((s) => (
                  <button
                    key={s.id}
                    title={s.label}
                    aria-label={s.label}
                    onClick={() => { close(); editor?.chain().focus().insertShape(s.id).run(); }}
                    className="flex h-11 items-center justify-center rounded-md border border-transparent hover:border-line hover:bg-hover"
                    // Previews are generated from the catalogue, never from user input.
                    dangerouslySetInnerHTML={{ __html: `<span style="position:relative;display:block;width:30px;height:24px">${shapeSvg({ kind: s.id, width: 30, height: 24, fill: s.openPath ? "none" : "#bfdbfe", stroke: "#2563eb", strokeWidth: 1.5 })}</span>` }}
                  />
                ))}
              </div>
            </div>
          ))}
          <p className="text-[11px] leading-4 text-muted">Les formes se redimensionnent à la souris et se modifient dans la barre « Forme ». Cliquez dedans pour écrire.</p>
        </div>
      )}
    />
  );
}

/** Marker styles of bullet and numbered lists. */
export function ListTypePicker({ kind, editor, snap }: { kind: "bulletList" | "orderedList"; editor: Editor | null; snap: EditorSnapshot }) {
  const types = kind === "bulletList" ? BULLET_TYPES : NUMBER_TYPES;
  const active = snap[kind] ? snap.listType ?? types[0].id : null;
  return (
    <DropdownButton
      icon={ChevronDown}
      title={kind === "bulletList" ? "Style de puces" : "Style de numérotation"}
      className="w-4"
      panel={(close) => (
        <div className="w-[196px] p-1.5">
          <div className="px-1 pb-1 text-[11px] font-medium text-muted">{kind === "bulletList" ? "Bibliothèque de puces" : "Bibliothèque de numérotation"}</div>
          <div className="grid grid-cols-4 gap-1.5">
            {types.map((t) => (
              <button
                key={t.id}
                type="button"
                title={t.label}
                aria-label={t.label}
                aria-pressed={active === t.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { close(); editor?.commands.setListType(kind, t.id); }}
                className={`flex h-10 items-center justify-center rounded-md border text-[16px] hover:bg-hover ${active === t.id ? "border-accent bg-accent-soft text-accent" : "border-line"}`}
              >
                {t.sample}
              </button>
            ))}
          </div>
        </div>
      )}
    />
  );
}
