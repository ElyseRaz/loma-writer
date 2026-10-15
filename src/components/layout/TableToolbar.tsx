import { Grid2x2, LayoutPanelTop, PenLine, Rows3, BetweenHorizontalEnd, BetweenHorizontalStart, BetweenVerticalEnd, BetweenVerticalStart, Table2, Trash2 } from "lucide-react";
import { useEditorState, type Editor } from "@tiptap/react";
import { RibbonButton } from "../ui/RibbonButton";
import { RibbonSeparator } from "../ribbon/RibbonParts";
import { DropdownButton } from "../ui/Dropdown";
import { ShadingPicker, Swatches, TEXT_COLORS_TABLE } from "../ribbon/Pickers";
import { BORDER_MODES, BORDER_WIDTHS, cleanLook, TABLE_STYLES, styleIdOf, type TableLook } from "../../editor/tableStyles";

/** Miniature of a table style: header row, two body rows (the second one banded when the style has bands). */
function StylePreview({ look }: { look: TableLook }) {
  const line = `${Math.max(1, Math.min(2, look.width))}px solid ${look.color}`;
  const cell = (r: number, c: number): React.CSSProperties => ({
    background: r === 0 ? look.headFill : look.band && r === 2 ? look.band : "#fff",
    borderTop: look.borders === "all" || look.borders === "horizontal" || (look.borders === "outer" && r === 0) ? line : "none",
    borderBottom: look.borders === "all" || look.borders === "horizontal" || (look.borders === "outer" && r === 2) ? line : "none",
    borderLeft: look.borders === "all" || (look.borders === "outer" && c === 0) ? line : "none",
    borderRight: look.borders === "all" || (look.borders === "outer" && c === 2) ? line : "none",
  });
  return (
    <div className="grid h-[34px] w-[52px] grid-cols-3 grid-rows-3 overflow-hidden rounded-sm bg-white" aria-hidden>
      {Array.from({ length: 9 }, (_, i) => <div key={i} style={cell(Math.floor(i / 3), i % 3)} />)}
    </div>
  );
}

/** Contextual tools, shown only while the caret is inside a table. */
export function TableToolbar({ editor }: { editor: Editor }) {
  const look = useEditorState({ editor, selector: ({ editor: e }) => cleanLook((e?.getAttributes("table") as { look?: unknown } | undefined)?.look) }) ?? cleanLook(null);
  const setLook = (patch: Partial<TableLook>) => editor.chain().focus().setTableLook(patch).run();
  const current = styleIdOf(look);
  const run = (fn: (c: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) => () => fn(editor.chain().focus()).run();
  return (
    <div className="sticky top-5 z-10 mx-auto -mb-1 mt-2 flex max-w-full flex-wrap w-fit items-center gap-0.5 rounded-lg border border-line bg-surface px-2 py-1 shadow-pop" role="toolbar" aria-label="Outils de tableau">
      <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-accent">Outils de tableau</span>
      <RibbonButton icon={BetweenHorizontalStart} title="Insérer une ligne au-dessus" onClick={run((c) => c.addRowBefore())} />
      <RibbonButton icon={BetweenHorizontalEnd} title="Insérer une ligne en dessous" onClick={run((c) => c.addRowAfter())} />
      <RibbonButton icon={BetweenVerticalStart} title="Insérer une colonne à gauche" onClick={run((c) => c.addColumnBefore())} />
      <RibbonButton icon={BetweenVerticalEnd} title="Insérer une colonne à droite" onClick={run((c) => c.addColumnAfter())} />
      <RibbonSeparator />
      <DropdownButton
        icon={LayoutPanelTop}
        title="Styles de tableau"
        panel={(close) => (
          <div className="w-[300px] p-2">
            <div className="px-1 pb-1.5 text-[11px] font-medium text-muted">Styles de tableau</div>
            <div className="grid grid-cols-3 gap-2">
              {TABLE_STYLES.map((t) => (
                <button key={t.id} type="button" title={t.label} aria-label={t.label} aria-pressed={current === t.id} onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { close(); setLook(t.look); }}
                  className={`flex flex-col items-center gap-1 rounded-md border p-1.5 text-[10px] hover:bg-hover ${current === t.id ? "border-accent bg-accent-soft text-accent" : "border-line"}`}>
                  <StylePreview look={t.look} />
                  <span className="max-w-full truncate">{t.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      />
      <DropdownButton
        icon={Grid2x2}
        title="Bordures du tableau"
        items={BORDER_MODES.map((m) => ({ label: m.label, checked: look.borders === m.id, onSelect: () => setLook({ borders: m.id }) }))}
      />
      <DropdownButton
        icon={PenLine}
        title="Couleur des bordures"
        panel={(close) => (
          <Swatches colors={TEXT_COLORS_TABLE} resetLabel="Noir (par défaut)" current={look.color}
            onPick={(c) => { close(); setLook({ color: c }); }} onLive={(c) => setLook({ color: c })} onReset={() => { close(); setLook({ color: "#000000" }); }} />
        )}
      >
        <span className="absolute bottom-0.5 left-1.5 right-1.5 h-[3px] rounded-full" style={{ background: look.color }} />
      </DropdownButton>
      <DropdownButton
        icon={Rows3}
        title="Épaisseur des bordures"
        items={BORDER_WIDTHS.map((w) => ({ label: `${String(w).replace(".", ",")} px`, checked: look.width === w, onSelect: () => setLook({ width: w }) }))}
      />
      <ShadingPicker editor={editor} />
      <RibbonButton icon={Rows3} label="Lignes alternées" size="sm" active={!!look.band} title="Alterner la couleur des lignes" onClick={() => setLook({ band: look.band ? null : "#f3f4f6" })} />
      <RibbonButton icon={Table2} label="1re colonne" size="sm" active={look.firstCol} title="Première colonne en gras" onClick={() => setLook({ firstCol: !look.firstCol })} />
      <RibbonSeparator />
      <RibbonButton icon={Table2} title="Activer/désactiver la ligne d'en-tête" onClick={run((c) => c.toggleHeaderRow())} />
      <RibbonButton icon={Trash2} title="Supprimer la ligne" onClick={run((c) => c.deleteRow())} />
      <RibbonButton icon={Trash2} title="Supprimer la colonne" onClick={run((c) => c.deleteColumn())} iconClassName="rotate-90" />
      <RibbonButton icon={Trash2} title="Supprimer le tableau" onClick={run((c) => c.deleteTable())} className="text-danger" />
    </div>
  );
}
