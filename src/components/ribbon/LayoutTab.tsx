import { Columns2, FileDown, Ruler, RectangleHorizontal, RectangleVertical, Rows3, ScissorsLineDashed, Square, StretchHorizontal } from "lucide-react";
import { MARGIN_PX, type MarginPreset, type Orientation, type PageSetup, type PageSize } from "../../state/types";
import { useApp } from "../../state/store";
import { useLomaEditor } from "../../editor/EditorProvider";
import { useEditorSnapshot } from "../../editor/useEditorSnapshot";
import { RibbonButton } from "../ui/RibbonButton";
import { DropdownButton } from "../ui/Dropdown";
import { RibbonGroup } from "./RibbonParts";
import { LineSpacingPicker } from "./Pickers";

const MARGIN_LABELS: Record<MarginPreset, string> = { normal: "Normales (2,54 cm)", narrow: "Étroites (1,27 cm)", wide: "Larges (3,81 cm)" };
const SIZE_LABELS: Record<PageSize, string> = { A4: "A4 (21 × 29,7 cm)", A5: "A5 (14,8 × 21 cm)", Letter: "Lettre (21,6 × 27,9 cm)" };

export function LayoutTab() {
  const { state, set } = useApp();
  const editor = useLomaEditor();
  const snap = useEditorSnapshot(editor);
  const { page } = state;
  const update = (patch: Partial<PageSetup>) => set((s) => ({ page: { ...s.page, ...patch }, doc: { ...s.doc, dirty: true } }));

  return (
    <>
      <RibbonGroup label="Mise en page">
        <DropdownButton
          icon={Ruler}
          size="lg"
          label="Marges"
          items={[
            ...(Object.keys(MARGIN_PX) as MarginPreset[]).map((m) => ({ label: MARGIN_LABELS[m], checked: page.margins === m, onSelect: () => update({ margins: m }) })),
            { separator: true as const },
            { label: page.margins === "custom" ? "Personnalisées… (actives)" : "Personnalisées…", checked: page.margins === "custom", onSelect: () => set({ dialog: "margins" }) },
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
          items={(Object.keys(SIZE_LABELS) as PageSize[]).map((s) => ({ label: SIZE_LABELS[s], checked: page.size === s, onSelect: () => update({ size: s }) }))}
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
