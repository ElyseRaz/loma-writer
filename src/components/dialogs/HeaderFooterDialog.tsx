import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { AlignCenter, AlignLeft, AlignRight, Bold, FileImage, Hash, Italic, PanelTop, Sigma, Table2, Underline } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import { createHeaderFooterExtensions } from "../../editor/headerFooterExtensions";
import { FONT_SIZES, TEXT_COLORS } from "../../editor/commands";
import { sanitizeHeaderFooter, type HFBlock, type HeaderFooterSet } from "../../pagination/headerFooter";
import { useLomaEditor } from "../../editor/EditorProvider";
import { useSections } from "../../editor/useSections";
import { useApp } from "../../state/store";
import { RibbonButton } from "../ui/RibbonButton";
import { Button, Dialog } from "../ui/Dialog";

type Variant = "default" | "first" | "even";

const EMPTY_DOC = [{ type: "paragraph" }] as HFBlock[];

/** Header or footer editor: formatted text, images, tables and page-number fields, per page variant. */
export function HeaderFooterDialog() {
  const { state, set, notify } = useApp();
  const kind = state.hfKind;
  const noun = kind === "header" ? "l'en-tête" : "le pied de page";
  // The headers and footers being edited are those of the section holding the caret (the first one is stored with the document).
  const docEditor = useLomaEditor();
  const { sections, current } = useSections(docEditor, state.page, state.headerFooter);
  const sec = sections[current];
  const init = sec.hf;
  const [linked, setLinked] = useState(current > 0 && sec.linked);
  const [titlePage, setTitlePage] = useState(init.titlePage);
  const [evenOdd, setEvenOdd] = useState(init.evenOdd);
  const [active, setActive] = useState<Variant>("default");
  const drafts = useRef<Record<Variant, HFBlock[] | null>>({
    default: init[kind].default?.blocks ?? null,
    first: init[kind].first?.blocks ?? null,
    even: init[kind].even?.blocks ?? null,
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const extensions = useMemo(() => createHeaderFooterExtensions(), []);

  const editor = useEditor({
    extensions,
    content: { type: "doc", content: drafts.current.default ?? EMPTY_DOC },
    editorProps: { attributes: { "aria-label": `Contenu de ${noun}`, role: "textbox" } },
  });
  useEffect(() => { editor?.commands.focus("end"); }, [editor]);
  useEffect(() => { editor?.setEditable(!linked); }, [editor, linked]);

  const snap = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: !!e?.isActive("bold"), italic: !!e?.isActive("italic"), underline: !!e?.isActive("underline"),
      align: ((e?.getAttributes("paragraph").textAlign as string | undefined) ?? "left"),
      size: (e?.getAttributes("textStyle").fontSize as string | undefined) ?? "",
    }),
  }) ?? { bold: false, italic: false, underline: false, align: "left", size: "" };

  const store = () => { if (editor) drafts.current[active] = (editor.getJSON().content ?? EMPTY_DOC) as HFBlock[]; };
  const switchTo = (next: Variant) => {
    if (!editor || next === active) return;
    store();
    editor.commands.setContent({ type: "doc", content: drafts.current[next] ?? EMPTY_DOC });
    setActive(next);
    editor.commands.focus("end");
  };
  const close = () => set({ dialog: null });
  const save = () => {
    store();
    const part: HeaderFooterSet = {};
    for (const v of ["default", "first", "even"] as const) if (drafts.current[v]) part[v] = { blocks: drafts.current[v]! };
    // Variants that are switched off are not kept; sanitising also drops empty ones.
    if (!titlePage) delete part.first;
    if (!evenOdd) delete part.even;
    const clean = sanitizeHeaderFooter({ ...init, [kind]: part, titlePage, evenOdd });
    writeSection(linked ? null : clean);
  };
  const remove = () => writeSection(sanitizeHeaderFooter({ ...init, [kind]: {} }));
  /** Section 0 keeps its headers in the document; the others in their break (null = the same as the previous section). */
  const writeSection = (hf: ReturnType<typeof sanitizeHeaderFooter> | null) => {
    if (current === 0 && hf) set((s) => ({ headerFooter: hf, doc: { ...s.doc, dirty: true }, dialog: null }));
    else {
      docEditor?.commands.setSectionHeaderFooter(current, hf);
      set((s) => ({ doc: { ...s.doc, dirty: true }, dialog: null }));
    }
  };

  const onImage = (file: File | undefined) => {
    if (!file || !editor) return;
    if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type)) return notify("Formats d'image acceptés : PNG, JPEG, GIF, WebP.", "error");
    if (file.size > 2 * 1024 * 1024) return notify("Image trop volumineuse pour un en-tête (2 Mo maximum).", "error");
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // A header image is at most 3 cm high by default.
        const h = Math.min(img.naturalHeight, 80);
        editor.chain().focus().insertContent({ type: "image", attrs: { src: String(reader.result), alt: file.name, width: Math.round((img.naturalWidth * h) / img.naturalHeight), height: h } }).run();
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const run = (fn: (c: NonNullable<typeof editor>["chain"] extends () => infer R ? R : never) => unknown) => () => { if (editor) (fn(editor.chain().focus()) as { run: () => void }).run(); };
  const tab = (v: Variant, text: string) => (
    <button key={v} role="tab" aria-selected={active === v} onClick={() => switchTo(v)} className={cn("h-8 rounded-md px-3 text-[13px]", active === v ? "bg-accent-soft font-medium text-accent" : "hover:bg-hover")}>{text}</button>
  );

  return (
    <Dialog title={kind === "header" ? "En-tête" : "Pied de page"} icon={PanelTop} onClose={close} width={680} backdropClose={false}
      footer={<><Button className="mr-auto" onClick={remove}>Supprimer {noun}</Button><Button onClick={close}>Annuler</Button><Button variant="primary" onClick={save}>Enregistrer</Button></>}>
      <div className="space-y-3 p-5">
        {sections.length > 1 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-chrome px-3 py-2 text-[13px]">
            <strong>Section {current + 1} sur {sections.length}</strong>
            {current > 0 && <label className="flex items-center gap-2"><input type="checkbox" checked={linked} onChange={(e) => setLinked(e.target.checked)} /> Identique à la section précédente</label>}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={titlePage} onChange={(e) => { setTitlePage(e.target.checked); if (!e.target.checked && active === "first") switchTo("default"); }} /> Première page différente</label>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={evenOdd} onChange={(e) => { setEvenOdd(e.target.checked); if (!e.target.checked && active === "even") switchTo("default"); }} /> Pages paires et impaires différentes</label>
        </div>
        {(titlePage || evenOdd) && (
          <div role="tablist" className="flex gap-1">
            {tab("default", evenOdd ? "Pages impaires" : "Toutes les pages")}
            {titlePage && tab("first", "Première page")}
            {evenOdd && tab("even", "Pages paires")}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-0.5 rounded-md border border-line bg-chrome px-1.5 py-1" role="toolbar" aria-label="Mise en forme">
          <RibbonButton icon={Bold} title="Gras" active={snap.bold} onClick={run((c) => (c as never as { toggleBold: () => unknown }).toggleBold())} />
          <RibbonButton icon={Italic} title="Italique" active={snap.italic} onClick={run((c) => (c as never as { toggleItalic: () => unknown }).toggleItalic())} />
          <RibbonButton icon={Underline} title="Souligné" active={snap.underline} onClick={run((c) => (c as never as { toggleUnderline: () => unknown }).toggleUnderline())} />
          <select aria-label="Taille" value={snap.size} onChange={(e) => editor?.chain().focus().setFontSize(e.target.value || "11pt").run()} className="h-6 rounded border border-line bg-surface px-1 text-[12px]">
            <option value="">Taille</option>
            {FONT_SIZES.map((n) => <option key={n} value={`${n}pt`}>{n}</option>)}
          </select>
          <div className="mx-1 flex gap-1" role="group" aria-label="Couleur du texte">
            {TEXT_COLORS.slice(0, 6).map((c) => <button key={c} aria-label={`Couleur ${c}`} title={c} onMouseDown={(e) => e.preventDefault()} onClick={() => editor?.chain().focus().setColor(c).run()} style={{ background: c }} className="h-4 w-4 rounded-full border border-black/15" />)}
          </div>
          <span className="mx-1 h-4 w-px bg-line" />
          <RibbonButton icon={AlignLeft} title="À gauche" active={snap.align === "left"} onClick={() => editor?.chain().focus().setTextAlign("left").run()} />
          <RibbonButton icon={AlignCenter} title="Centré" active={snap.align === "center"} onClick={() => editor?.chain().focus().setTextAlign("center").run()} />
          <RibbonButton icon={AlignRight} title="À droite" active={snap.align === "right"} onClick={() => editor?.chain().focus().setTextAlign("right").run()} />
          <span className="mx-1 h-4 w-px bg-line" />
          <RibbonButton icon={Hash} size="sm" label="N° de page" title="Insérer le numéro de page" onClick={() => editor?.chain().focus().insertContent({ type: "pageField", attrs: { kind: "page" } }).run()} />
          <RibbonButton icon={Sigma} size="sm" label="Nb de pages" title="Insérer le nombre de pages" onClick={() => editor?.chain().focus().insertContent({ type: "pageField", attrs: { kind: "pages" } }).run()} />
          <RibbonButton icon={FileImage} size="sm" label="Image" title="Insérer une image" onClick={() => fileInput.current?.click()} />
          <RibbonButton icon={Table2} size="sm" label="Tableau 1×3" title="Insérer un tableau d'une ligne et trois colonnes, sans bordures (gauche, centre, droite)" onClick={() => editor?.chain().focus().insertTable({ rows: 1, cols: 3, withHeaderRow: false }).run()} />
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { onImage(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
        <div className="hf-edit paper rounded-md border border-line bg-white p-3" style={{ ["--doc-font" as string]: state.prefs.fontFamily, ["--doc-size" as string]: `${state.prefs.fontSizePt}pt` }}>
          <EditorContent editor={editor} />
        </div>
        <p className="text-[12px] text-muted">Plusieurs lignes, images et tableaux sont possibles. Les numéros de page s'adaptent à chaque page. Ces éléments sont enregistrés dans les fichiers DOCX, DOC et ODT.</p>
      </div>
    </Dialog>
  );
}
