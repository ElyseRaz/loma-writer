import { Palette, Paintbrush, Replace, Search, ClipboardPaste, MousePointer2, Scissors, Copy, Rows3, type LucideIcon } from "lucide-react";
import { useApp } from "../../state/store";
import type { StyleId } from "../../editor/docStyles";
import { cn } from "../../lib/cn";
import { useCommand } from "../../editor/commands";
import { useLomaEditor } from "../../editor/EditorProvider";
import { useEditorSnapshot } from "../../editor/useEditorSnapshot";
import { CommandButton, RibbonButton } from "../ui/RibbonButton";
import { BordersPicker, ShadingPicker, FontFamilyPicker, FontSizePicker, HighlightPicker, LineSpacingPicker, ListTypePicker, TextColorPicker } from "./Pickers";
import { RibbonGroup, RibbonRow, RibbonSeparator, RibbonStack } from "./RibbonParts";

const STYLES: Array<{ id: string; styleId: StyleId; label: string; preview: string; previewClass: string }> = [
  { id: "style.normal", styleId: "normal", label: "Normal", preview: "AaBbCc", previewClass: "text-[12px]" },
  { id: "style.h1", styleId: "h1", label: "Titre 1", preview: "AaBb", previewClass: "text-[17px] font-semibold text-accent" },
  { id: "style.h2", styleId: "h2", label: "Titre 2", preview: "AaBbCc", previewClass: "text-[14px] font-semibold" },
  { id: "style.h3", styleId: "h3", label: "Titre 3", preview: "AaBbCc", previewClass: "text-[12px] font-semibold" },
  { id: "style.h4", styleId: "h4", label: "Titre 4", preview: "AaBbCc", previewClass: "text-[12px] font-semibold italic" },
  { id: "style.h5", styleId: "h5", label: "Titre 5", preview: "AaBbCc", previewClass: "text-[11px] font-semibold" },
  { id: "style.h6", styleId: "h6", label: "Titre 6", preview: "AaBbCc", previewClass: "text-[11px] italic" },
  { id: "style.quote", styleId: "quote", label: "Citation", preview: "« AaBb »", previewClass: "text-[12px] italic text-muted" },
  { id: "style.code", styleId: "code", label: "Code", preview: "AaBb", previewClass: "font-mono text-[12px]" },
];

function SmallRow({ id, icon, label }: { id: string; icon: LucideIcon; label: string }) {
  const c = useCommand(id);
  return <RibbonButton size="sm" icon={icon} label={label} title={c ? `${c.label}${c.shortcut ? ` (${c.shortcut})` : ""}` : label} active={c?.active} disabled={c?.disabled} onClick={c?.run} className="w-[96px] justify-start" />;
}

function StyleCard({ id, styleId, label, preview, previewClass }: (typeof STYLES)[number]) {
  const cmd = useCommand(id);
  const { set } = useApp();
  return (
    <button
      type="button"
      title={`${cmd ? cmd.label : label}${cmd?.shortcut ? ` (${cmd.shortcut})` : ""} — clic droit ou double-clic pour modifier ce style`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={cmd?.run}
      onContextMenu={(e) => { e.preventDefault(); set({ styleTarget: styleId, dialog: "styles" }); }}
      onDoubleClick={() => set({ styleTarget: styleId, dialog: "styles" })}
      className={cn(
        "flex h-[58px] w-[66px] shrink-0 flex-col items-center justify-between rounded-md border px-1 py-1.5 transition-colors hover:bg-hover",
        cmd?.active ? "border-accent bg-accent-soft" : "border-line bg-surface",
      )}
    >
      <span className={cn("flex flex-1 items-center", previewClass)}>{preview}</span>
      <span className={cn("text-[10px]", cmd?.active ? "text-accent" : "text-muted")}>{label}</span>
    </button>
  );
}

export function HomeTab() {
  const editor = useLomaEditor();
  const snap = useEditorSnapshot(editor);
  const paste = useCommand("edit.paste");
  const { set } = useApp();

  return (
    <>
      <RibbonGroup label="Presse-papiers">
        {paste && <RibbonButton icon={ClipboardPaste} size="lg" label="Coller" title="Coller (Ctrl+V)" onClick={paste.run} className="h-[62px]" />}
        <RibbonStack>
          <SmallRow id="edit.cut" icon={Scissors} label="Couper" />
          <SmallRow id="edit.copy" icon={Copy} label="Copier" />
          <SmallRow id="edit.painter" icon={Paintbrush} label="Reproduire" />
        </RibbonStack>
      </RibbonGroup>

      <RibbonGroup label="Police">
        <RibbonStack>
          <RibbonRow>
            <FontFamilyPicker editor={editor} snap={snap} />
            <FontSizePicker editor={editor} snap={snap} />
            <CommandButton id="format.grow" />
            <CommandButton id="format.shrink" />
            <CommandButton id="format.clear" />
          </RibbonRow>
          <RibbonRow>
            <CommandButton id="format.bold" />
            <CommandButton id="format.italic" />
            <CommandButton id="format.underline" />
            <CommandButton id="format.strike" />
            <CommandButton id="format.subscript" />
            <CommandButton id="format.superscript" />
            <RibbonSeparator />
            <HighlightPicker editor={editor} snap={snap} />
            <TextColorPicker editor={editor} snap={snap} />
          </RibbonRow>
        </RibbonStack>
      </RibbonGroup>

      <RibbonGroup label="Paragraphe">
        <RibbonStack>
          <RibbonRow>
            <CommandButton id="para.bullet" />
            <ListTypePicker kind="bulletList" editor={editor} snap={snap} />
            <CommandButton id="para.ordered" />
            <ListTypePicker kind="orderedList" editor={editor} snap={snap} />
            <CommandButton id="para.outdent" />
            <CommandButton id="para.indent" />
            <RibbonSeparator />
            <LineSpacingPicker icon={Rows3} editor={editor} snap={snap} />
            <CommandButton id="para.marks" />
          </RibbonRow>
          <RibbonRow>
            <CommandButton id="para.align.left" />
            <CommandButton id="para.align.center" />
            <CommandButton id="para.align.right" />
            <CommandButton id="para.align.justify" />
            <RibbonSeparator />
            <ShadingPicker editor={editor} />
            <BordersPicker editor={editor} />
          </RibbonRow>
        </RibbonStack>
      </RibbonGroup>

      <RibbonGroup label="Styles" className="gap-1.5">
        {STYLES.map((s) => (
          <StyleCard key={s.id} {...s} />
        ))}
        <RibbonButton icon={Palette} size="lg" label="Modifier" title="Modifier les styles (police, couleur, espacement…)" onClick={() => set({ styleTarget: "h1", dialog: "styles" })} className="h-[58px]" />
      </RibbonGroup>

      <RibbonGroup label="Édition">
        <RibbonStack>
          <SmallRow id="edit.find" icon={Search} label="Rechercher" />
          <SmallRow id="edit.replace" icon={Replace} label="Remplacer" />
          <SmallRow id="edit.selectAll" icon={MousePointer2} label="Sélectionner" />
        </RibbonStack>
      </RibbonGroup>

      <RibbonGroup label="Volet" className="ml-auto">
        <CommandButton id="view.nav" size="lg" label="Navigation" />
      </RibbonGroup>
    </>
  );
}
