import { FileImage, Hash, PanelBottom, PanelTop, Table, Omega } from "lucide-react";
import { useRef } from "react";
import { useCommandMap } from "../../editor/commands";
import { useLomaEditor } from "../../editor/EditorProvider";
import { contentFromTemplate, templateOf } from "../../pagination/headerFooter";
import { useApp } from "../../state/store";
import { CommandButton, RibbonButton } from "../ui/RibbonButton";
import { DropdownButton } from "../ui/Dropdown";
import { RibbonGroup, RibbonStack } from "./RibbonParts";
import { ShapesPicker, TableGridPanel } from "./Pickers";

const SYMBOLS = ["©", "®", "™", "°", "±", "×", "÷", "≠", "≤", "≥", "€", "£", "¥", "§", "¶", "→", "←", "↑", "↓", "•", "…", "«", "»"];

const PAGE_NUMBER_FORMATS: Array<{ label: string; text: string }> = [
  { label: "1", text: "{PAGE}" },
  { label: "Page 1", text: "Page {PAGE}" },
  { label: "Page 1 sur N", text: "Page {PAGE} sur {PAGES}" },
];

export function InsertTab() {
  const editor = useLomaEditor();
  const cmds = useCommandMap();
  const { state, set, notify } = useApp();
  const fileInput = useRef<HTMLInputElement>(null);

  const onImage = (file: File | undefined) => {
    if (!file || !editor) return;
    if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type)) return notify("Formats d'image acceptés : PNG, JPEG, GIF, WebP.", "error");
    if (file.size > 10 * 1024 * 1024) return notify("Image trop volumineuse (10 Mo maximum).", "error");
    const reader = new FileReader();
    reader.onload = () => editor.chain().focus().setImage({ src: String(reader.result), alt: file.name }).run();
    reader.onerror = () => notify("Impossible de lire l'image.", "error");
    reader.readAsDataURL(file);
  };

  /** Puts a page number in the header or footer, replacing the main content of that part. */
  const setPageNumber = (where: "header" | "footer", align: "left" | "center" | "right", text: string) =>
    set((s) => ({ headerFooter: { ...s.headerFooter, [where]: { ...s.headerFooter[where], default: contentFromTemplate(text, align) } }, doc: { ...s.doc, dirty: true } }));
  /** Removes page numbers wherever they are, keeping the rest of the header/footer. */
  const clearPageNumbers = () =>
    set((s) => {
      const strip = (set_: typeof s.headerFooter.header) =>
        Object.fromEntries(Object.entries(set_).filter(([, c]) => !/\{PAGES?\}/.test(templateOf((c as { blocks: never[] }).blocks))));
      return { headerFooter: { ...s.headerFooter, header: strip(s.headerFooter.header), footer: strip(s.headerFooter.footer) }, doc: { ...s.doc, dirty: true } };
    });

  const numberItems = [
    ...(["footer", "header"] as const).flatMap((where) =>
      (["center", "right", "left"] as const).flatMap((align) =>
        align === "center" || where === "footer"
          ? [{ label: `${where === "footer" ? "Bas de page" : "Haut de page"}, ${{ center: "centré", right: "à droite", left: "à gauche" }[align]} — Page 1 sur N`, onSelect: () => setPageNumber(where, align, "Page {PAGE} sur {PAGES}") }]
          : [],
      ),
    ),
    { separator: true as const },
    ...PAGE_NUMBER_FORMATS.map((f) => ({ label: `Format : ${f.label} (bas de page, centré)`, onSelect: () => setPageNumber("footer", "center", f.text) })),
    { separator: true as const },
    { label: "Supprimer les numéros de page", onSelect: clearPageNumbers },
  ];

  const headerFooterItems = (where: "header" | "footer", noun: string) => [
    { label: `Modifier ${noun}…`, onSelect: cmds[`insert.${where}`]?.run },
    { label: `Supprimer ${noun}`, disabled: !Object.keys(state.headerFooter[where]).length, onSelect: () => set((s) => ({ headerFooter: { ...s.headerFooter, [where]: {} }, doc: { ...s.doc, dirty: true } })) },
  ];

  return (
    <>
      <RibbonGroup label="Pages">
        <CommandButton id="insert.coverPage" size="lg" label="Page de garde" />
        <RibbonStack>
          <CommandButton id="insert.blankPage" size="sm" label="Page vierge" className="w-[112px] justify-start" />
          <CommandButton id="insert.pageBreak" size="sm" label="Saut de page" className="w-[112px] justify-start" />
        </RibbonStack>
      </RibbonGroup>

      <RibbonGroup label="Tableau">
        <DropdownButton
          icon={Table}
          size="lg"
          label="Tableau"
          panel={(close) => (
            <TableGridPanel onPick={(rows, cols) => { close(); editor?.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run(); }} onCustom={() => { close(); set({ dialog: "tableSize" }); }} />
          )}
        />
      </RibbonGroup>

      <RibbonGroup label="Illustrations">
        <RibbonButton icon={FileImage} size="lg" label="Image" title="Insérer une image" onClick={() => fileInput.current?.click()} />
        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { onImage(e.target.files?.[0]); e.target.value = ""; }} />
        <ShapesPicker editor={editor} />
        <CommandButton id="insert.icons" size="lg" label="Icônes" />
        <CommandButton id="insert.chart" size="lg" label="Graphique" />
      </RibbonGroup>

      <RibbonGroup label="Liens">
        <CommandButton id="insert.link" size="lg" label="Lien" />
        <RibbonStack>
          <CommandButton id="insert.bookmark" size="sm" label="Signet" className="w-[88px] justify-start" />
          <CommandButton id="insert.crossRef" size="sm" label="Renvoi" className="w-[88px] justify-start" />
        </RibbonStack>
      </RibbonGroup>

      <RibbonGroup label="En-tête & pied">
        <DropdownButton icon={PanelTop} size="lg" label="En-tête" items={headerFooterItems("header", "l'en-tête")} />
        <DropdownButton icon={PanelBottom} size="lg" label="Pied de page" items={headerFooterItems("footer", "le pied de page")} />
        <DropdownButton icon={Hash} size="lg" label="Numéro" items={numberItems} />
      </RibbonGroup>

      <RibbonGroup label="Texte">
        <CommandButton id="insert.textBox" size="lg" label="Zone de texte" />
        <RibbonStack>
          <CommandButton id="insert.datetime" size="sm" label="Date du jour" className="w-[104px] justify-start" />
          <CommandButton id="insert.hr" size="sm" label="Ligne" className="w-[104px] justify-start" />
          <CommandButton id="style.code" size="sm" label="Bloc de code" className="w-[104px] justify-start" />
        </RibbonStack>
      </RibbonGroup>

      <RibbonGroup label="Symboles">
        <CommandButton id="insert.equation" size="lg" label="Équation" />
        <DropdownButton
          icon={Omega}
          size="lg"
          label="Symbole"
          panel={(close) => (
            <div className="grid w-[200px] grid-cols-6 gap-0.5 p-1">
              {SYMBOLS.map((s) => (
                <button key={s} className="h-8 rounded text-[15px] hover:bg-hover" onClick={() => { close(); editor?.chain().focus().insertContent(s).run(); }}>
                  {s}
                </button>
              ))}
            </div>
          )}
        />
      </RibbonGroup>
    </>
  );
}

