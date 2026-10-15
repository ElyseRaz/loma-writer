import { Columns2, FileDown, Ruler, RectangleHorizontal, RectangleVertical, Rows3, ScissorsLineDashed, Square, StretchHorizontal } from "lucide-react";
import { type Orientation, type PageSetup, type PageSize } from "../../state/types";
import { MARGIN_PRESETS, PAPER_SIZES, baseMarginsCm, fitMargins, formatCm, formatSize, isMirrored } from "../../state/page";
import { useApp } from "../../state/store";
import { useLomaEditor } from "../../editor/EditorProvider";
import { useEditorSnapshot } from "../../editor/useEditorSnapshot";
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
  const { page } = state;
  // A new paper or orientation keeps the margins whenever the text area stays usable; otherwise they shrink to fit.
  const update = (patch: Partial<PageSetup>) => set((s) => ({ page: fitMargins({ ...s.page, ...patch }), doc: { ...s.doc, dirty: true } }));
  const setPreset = (m: (typeof MARGIN_PRESETS)[number]["id"]) =>
    set((s) => {
      const { customMarginsCm: _c, mirrored: _m, ...rest } = s.page;
      return { page: fitMargins({ ...rest, margins: m }), doc: { ...s.doc, dirty: true } };
    });
  const activePaper = page.size;

  return (
    <>
      <RibbonGroup label="Mise en page">
        <DropdownButton
          icon={Ruler}
          size="lg"
          label="Marges"
          items={[
            ...MARGIN_PRESETS.map((m) => ({ label: m.label, shortcut: marginSummary(m.cm, m.id === "mirrored"), checked: page.margins === m.id, onSelect: () => setPreset(m.id) })),
            { separator: true as const },
            { label: page.margins === "custom" ? "Marges personnalisées… (actives)" : "Marges personnalisées…", shortcut: page.margins === "custom" ? marginSummary(baseMarginsCm(page), isMirrored(page)) : undefined, checked: page.margins === "custom", onSelect: () => set({ dialog: "margins" }) },
            { label: "Marge de reliure…", checked: !!page.gutterCm, onSelect: () => set({ dialog: "margins" }) },
          ]}
        />
        <DropdownButton
          icon={page.orientation === "portrait" ? RectangleVertical : RectangleHorizontal}
          size="lg"
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
          label="Taille"
          items={[
            ...PAPER_SIZES.map((p) => ({ label: p.label, shortcut: formatSize(p.width, p.height), checked: activePaper === p.id, onSelect: () => update({ size: p.id as PageSize, customSizeCm: undefined }) })),
            { separator: true as const },
            { label: "Autres formats de papier…", checked: activePaper === "Custom", shortcut: activePaper === "Custom" && page.customSizeCm ? formatSize(page.customSizeCm.width, page.customSizeCm.height) : undefined, onSelect: () => set({ dialog: "paper" }) },
          ]}
        />
        <RibbonButton icon={Columns2} size="lg" label="Colonnes" soon />
        <RibbonButton icon={ScissorsLineDashed} size="lg" label="Sauts" soon />
      </RibbonGroup>
      <RibbonGroup label="Espacement">
        <div className="flex flex-col items-center">
          <LineSpacingPicker icon={Rows3} editor={editor} snap={snap} />
          <span className="text-[11px]">Interligne</span>
        </div>
        <RibbonButton icon={StretchHorizontal} size="lg" label="Retraits" soon />
      </RibbonGroup>
      <RibbonGroup label="Arrière-plan">
        <RibbonButton icon={FileDown} size="lg" label="Filigrane" soon />
      </RibbonGroup>
    </>
  );
}
