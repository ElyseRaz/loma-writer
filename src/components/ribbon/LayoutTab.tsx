import { Hash, Columns2, FileDown, Ruler, RectangleHorizontal, RectangleVertical, Rows3, ScissorsLineDashed, Square, StretchHorizontal } from "lucide-react";
import { type Orientation, type PageSetup, type PageSize } from "../../state/types";
import { DEFAULT_COLUMN_GAP_CM, MARGIN_PRESETS, PAPER_SIZES, baseMarginsCm, fitMargins, formatCm, formatSize, isMirrored } from "../../state/page";
import { useApp } from "../../state/store";
import { useSections } from "../../editor/useSections";
import { useLomaEditor } from "../../editor/EditorProvider";
import { useEditorSnapshot } from "../../editor/useEditorSnapshot";
import { DEFAULT_WATERMARK, WATERMARK_PRESETS, type Watermark } from "../../editor/watermark";
import { NumberField } from "../ui/NumberField";
import { MAX_INDENT_CM, MAX_SPACE_PT, type ParagraphLayout } from "../../editor/ParagraphFormat";
import { RibbonButton } from "../ui/RibbonButton";
import { DropdownButton } from "../ui/Dropdown";
import { RibbonGroup } from "./RibbonParts";
import { LineSpacingPicker } from "./Pickers";

/** "2,54 cm" when the four margins are equal, otherwise "H/B 2,54 · G/D 1,91". */
function marginSummary(m: { top: number; bottom: number; left: number; right: number }, mirrored: boolean) {
  if (m.top === m.bottom && m.top === m.left && m.top === m.right) return `${formatCm(m.top)} cm`;
  const sides = mirrored ? "Int./Ext." : "G/D";
  const lr = m.left === m.right ? formatCm(m.left) : `${formatCm(m.left)}/${formatCm(m.right)}`;
  return `H/B ${m.top === m.bottom ? formatCm(m.top) : `${formatCm(m.top)}/${formatCm(m.bottom)}`} · ${sides} ${lr}`;
}

export function LayoutTab() {
  const { state, set } = useApp();
  const editor = useLomaEditor();
  const snap = useEditorSnapshot(editor);
  const { sections, current, section } = useSections(editor, state.page, state.headerFooter);
  const page = section.page; // the paper and margins of the section holding the caret
  const continuous = section.kind === "continuous";
  // A new paper or orientation keeps the margins whenever the text area stays usable; otherwise they shrink to fit.
  // Changes apply to the section holding the caret (the first section is stored with the document, the others in their break).
  const writePage = (next: PageSetup) => {
    if (current === 0) set((s) => ({ page: next, doc: { ...s.doc, dirty: true } }));
    else editor?.commands.setSectionPage(current, next);
  };
  const update = (patch: Partial<PageSetup>) => writePage(fitMargins({ ...page, ...patch }));
  const setPreset = (m: (typeof MARGIN_PRESETS)[number]["id"]) => {
    const { customMarginsCm: _c, mirrored: _m, ...rest } = page;
    writePage(fitMargins({ ...rest, margins: m }));
  };
  const activePaper = page.size;
  /** Columns of the section holding the caret (the gap and the rule are kept from its previous setting). */
  const setColumns = (n: number) => {
    const { columns, ...rest } = page;
    writePage(n < 2 ? rest : { ...rest, columns: { count: n, gapCm: columns?.gapCm ?? DEFAULT_COLUMN_GAP_CM, line: columns?.line ?? false } });
  };
  const setWatermark = (w: Watermark | null) => set((s) => ({ watermark: w, doc: { ...s.doc, dirty: true } }));
  const layout = (patch: Partial<ParagraphLayout>) => { editor?.chain().focus().setParagraphLayout(patch).run(); set((s) => ({ doc: { ...s.doc, dirty: true } })); };

  return (
    <>
      <RibbonGroup label={sections.length > 1 ? `Mise en page · section ${current + 1}/${sections.length}` : "Mise en page"}>
        <DropdownButton
          icon={Ruler}
          size="lg"
          disabled={continuous}
          title={continuous ? "Une section continue garde le papier et les marges de la section précédente" : undefined}
          label="Marges"
          items={[
            ...MARGIN_PRESETS.map((m) => ({ label: m.label, shortcut: marginSummary(m.cm, m.id === "mirrored"), checked: page.margins === m.id, onSelect: () => setPreset(m.id) })),
            { separator: true as const },
            { label: page.margins === "custom" ? "Marges personnalisées… (actives)" : "Marges personnalisées…", shortcut: page.margins === "custom" ? marginSummary(baseMarginsCm(page), isMirrored(page)) : undefined, checked: page.margins === "custom", onSelect: () => set({ dialog: "margins" }) },
            { label: "Marge de reliure…", checked: !!page.gutterCm, onSelect: () => set({ dialog: "margins" }) },
          ]}
        />
        <RibbonButton icon={Hash} size="lg" label="N° de page" title="Format des numéros de page (chiffres romains, lettres) et redémarrage de la numérotation dans cette section" onClick={() => set({ dialog: "pageNumber" })} />
        <DropdownButton
          icon={page.orientation === "portrait" ? RectangleVertical : RectangleHorizontal}
          size="lg"
          disabled={continuous}
          title={continuous ? "Une section continue garde le papier et les marges de la section précédente" : undefined}
          label="Orientation"
          items={(["portrait", "landscape"] as Orientation[]).map((o) => ({
            label: o === "portrait" ? "Portrait" : "Paysage",
            icon: o === "portrait" ? RectangleVertical : RectangleHorizontal,
            checked: page.orientation === o,
            onSelect: () => update({ orientation: o }),
          }))}
        />
        <DropdownButton
          icon={Square}
          size="lg"
          disabled={continuous}
          title={continuous ? "Une section continue garde le papier et les marges de la section précédente" : undefined}
          label="Taille"
          items={[
            ...PAPER_SIZES.map((p) => ({ label: p.label, shortcut: formatSize(p.width, p.height), checked: activePaper === p.id, onSelect: () => update({ size: p.id as PageSize, customSizeCm: undefined }) })),
            { separator: true as const },
            { label: "Autres formats de papier…", checked: activePaper === "Custom", shortcut: activePaper === "Custom" && page.customSizeCm ? formatSize(page.customSizeCm.width, page.customSizeCm.height) : undefined, onSelect: () => set({ dialog: "paper" }) },
          ]}
        />
        <DropdownButton
          icon={Columns2}
          size="lg"
          label="Colonnes"
          items={[
            ...[1, 2, 3].map((n) => ({ label: n === 1 ? "Une" : n === 2 ? "Deux" : "Trois", checked: (page.columns?.count ?? 1) === n, onSelect: () => setColumns(n) })),
            { separator: true as const },
            { label: "Autres colonnes…", checked: (page.columns?.count ?? 1) > 3, onSelect: () => set({ dialog: "columns" }) },
          ]}
        />
        <DropdownButton
          icon={ScissorsLineDashed}
          size="lg"
          label="Sauts"
          items={[
            { label: "Saut de page", shortcut: "Ctrl+Entrée", onSelect: () => editor?.chain().focus().insertPageBreak().run() },
            { label: "Saut de colonne", shortcut: "Ctrl+Maj+Entrée", onSelect: () => editor?.chain().focus().insertColumnBreak().run() },
            { label: "Saut de section (page suivante)", onSelect: () => editor?.chain().focus().insertSectionBreak().run() },
            { label: "Saut de section (continu)", onSelect: () => editor?.chain().focus().insertSectionBreak({ kind: "continuous" }).run() },
            { separator: true as const },
            { label: "Saut de page avant ce paragraphe", checked: snap.layout.pageBreakBefore, onSelect: () => editor?.chain().focus().setParagraphLayout({ pageBreakBefore: !snap.layout.pageBreakBefore }).run() },
            { label: "Garder avec le paragraphe suivant", checked: snap.layout.keepWithNext, onSelect: () => editor?.chain().focus().setParagraphLayout({ keepWithNext: !snap.layout.keepWithNext }).run() },
            { label: "Garder les lignes ensemble", checked: snap.layout.keepLines, onSelect: () => editor?.chain().focus().setParagraphLayout({ keepLines: !snap.layout.keepLines }).run() },
          ]}
        />
      </RibbonGroup>
      <RibbonGroup label="Paragraphe">
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          <NumberField label="Gauche" unit="cm" value={snap.layout.indentLeft} min={0} max={MAX_INDENT_CM} step={0.25} title="Retrait à gauche" onCommit={(v) => layout({ indentLeft: v })} />
          <NumberField label="Avant" unit="pt" value={snap.layout.spaceBefore} placeholder="auto" min={0} max={MAX_SPACE_PT} step={6} title="Espacement avant le paragraphe" onCommit={(v) => layout({ spaceBefore: v })} />
          <NumberField label="Droite" unit="cm" value={snap.layout.indentRight} min={0} max={MAX_INDENT_CM} step={0.25} title="Retrait à droite" onCommit={(v) => layout({ indentRight: v })} />
          <NumberField label="Après" unit="pt" value={snap.layout.spaceAfter} placeholder="auto" min={0} max={MAX_SPACE_PT} step={6} title="Espacement après le paragraphe" onCommit={(v) => layout({ spaceAfter: v })} />
        </div>
        <div className="flex flex-col items-center">
          <LineSpacingPicker icon={Rows3} editor={editor} snap={snap} />
          <span className="text-[11px]">Interligne</span>
        </div>
        <RibbonButton icon={StretchHorizontal} size="lg" label="Paragraphe…" title="Retraits, espacement et enchaînements (première ligne, suspendu…)" onClick={() => set({ dialog: "paragraph" })} />
      </RibbonGroup>
      <RibbonGroup label="Arrière-plan">
        <DropdownButton
          icon={FileDown}
          size="lg"
          label="Filigrane"
          items={[
            ...WATERMARK_PRESETS.map((t) => ({ label: t, checked: state.watermark?.text === t, onSelect: () => setWatermark({ ...(state.watermark ?? DEFAULT_WATERMARK), text: t }) })),
            { separator: true as const },
            { label: "Filigrane personnalisé…", onSelect: () => set({ dialog: "watermark" }) },
            { label: "Supprimer le filigrane", disabled: !state.watermark, onSelect: () => setWatermark(null) },
          ]}
        />
      </RibbonGroup>
    </>
  );
}
