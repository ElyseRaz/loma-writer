import { BookMarked, BookText, LibraryBig, ListTree, ListOrdered, Palette, Quote, Tags, TextQuote } from "lucide-react";
import { sourcesOf, styleOf } from "../../editor/references/Citations";
import { CITATION_STYLES } from "../../editor/references/sources";
import { collectCaptions } from "../../editor/references/Captions";
import { useEditorState } from "@tiptap/react";
import { useApp } from "../../state/store";
import { useLomaEditor } from "../../editor/EditorProvider";
import { DropdownButton } from "../ui/Dropdown";
import { RibbonButton } from "../ui/RibbonButton";
import { RibbonGroup } from "./RibbonParts";

export function ReferencesTab() {
  const editor = useLomaEditor();
  const { set } = useApp();
  // The labels the document has captions for (their lists of figures can be inserted).
  const labels = useEditorState({ editor, selector: ({ editor: e }) => (e ? [...new Set(collectCaptions(e.state.doc).map((c) => c.label))].join("|") : "") }) ?? "";
  const labelList = labels ? labels.split("|") : [];
  // The sources and the style of the citations (they live in the document).
  const refs = useEditorState({ editor, selector: ({ editor: e }) => (e ? JSON.stringify({ s: sourcesOf(e.state.doc).map((x) => [x.tag, x.authors[0]?.last ?? "", x.year, x.title]), st: styleOf(e.state.doc), b: (() => { let f = false; e.state.doc.descendants((n) => { if (n.type.name === "bibliography") f = true; return !f; }); return f; })() }) : "{}") }) ?? "{}";
  const { s: sourceList = [], st: citationStyle = "apa", b: hasBibliography = false } = JSON.parse(refs) as { s?: Array<[string, string, string, string]>; st?: string; b?: boolean };
  const insertToc = (levels: number) => editor?.chain().focus().insertTableOfContents({ levels }).run();
  return (
    <>
      <RibbonGroup label="Table des matières">
        <DropdownButton
          icon={ListTree}
          size="lg"
          label="Table des matières"
          items={[
            { label: "Table automatique : 3 niveaux", title: "Titres 1, 2 et 3, avec leur page", onSelect: () => insertToc(3) },
            { label: "Table automatique : 2 niveaux", title: "Titres 1 et 2, avec leur page", onSelect: () => insertToc(2) },
            { label: "Table automatique : 1 niveau", title: "Titres 1 uniquement, avec leur page", onSelect: () => insertToc(1) },
            { separator: true as const },
            { label: "Supprimer la table des matières", onSelect: () => editor?.chain().focus().removeTableOfContents().run() },
          ]}
        />
        <RibbonButton icon={BookText} size="lg" label="Mettre à jour" title="Met à jour les tables des matières (titres et pages)" onClick={() => editor?.chain().focus().updateTableOfContents().run()} />
      </RibbonGroup>
      <RibbonGroup label="Notes">
        <RibbonButton icon={TextQuote} size="lg" label="Note de bas de page" title="Insère une note en bas de la page (Ctrl+Alt+F)" onClick={() => set({ notePos: null, noteKind: "foot", dialog: "note" })} />
        <RibbonButton icon={BookMarked} size="lg" label="Note de fin" title="Insère une note réunie à la fin du document (Ctrl+Alt+D)" onClick={() => set({ notePos: null, noteKind: "end", dialog: "note" })} />
      </RibbonGroup>
      <RibbonGroup label="Citations et bibliographie">
        <DropdownButton
          icon={Quote}
          size="lg"
          label="Insérer une citation"
          items={[
            ...sourceList.map(([tag, last, year, title]) => ({ label: `${last || "(sans auteur)"}${year ? `, ${year}` : ""} — ${title || "(sans titre)"}`, title: "Cite cette source à l'endroit du curseur", onSelect: () => editor?.chain().focus().insertCitation({ tag }).run() })),
            ...(sourceList.length ? [{ separator: true as const }] : []),
            { label: "Ajouter une nouvelle source…", onSelect: () => set({ sourceEdit: "__new", dialog: "sources" }) },
            { label: "Gérer les sources…", onSelect: () => set({ sourceEdit: null, dialog: "sources" }) },
          ]}
        />
        <DropdownButton
          icon={Palette}
          size="lg"
          label={`Style : ${CITATION_STYLES.find((c) => c.id === citationStyle)?.label.split(" ")[0] ?? "APA"}`}
          items={CITATION_STYLES.map((c) => ({ label: c.label, shortcut: c.sample, checked: c.id === citationStyle, onSelect: () => editor?.chain().focus().setCitationStyle(c.id).run() }))}
        />
        <DropdownButton
          icon={LibraryBig}
          size="lg"
          label="Bibliographie"
          items={[
            { label: "Bibliographie : sources citées", title: "Liste des sources citées dans le texte, dans le style choisi", onSelect: () => editor?.chain().focus().insertBibliography({ mode: "cited" }).run() },
            { label: "Bibliographie : toutes les sources", title: "Liste de toutes les sources du document", onSelect: () => editor?.chain().focus().insertBibliography({ mode: "all" }).run() },
            { separator: true as const },
            { label: "Supprimer la bibliographie", disabled: !hasBibliography, onSelect: () => editor?.chain().focus().removeBibliography().run() },
          ]}
        />
      </RibbonGroup>
      <RibbonGroup label="Légendes">
        <RibbonButton icon={Tags} size="lg" label="Insérer une légende" title="Numérote une figure, un tableau ou une équation (Figure 1, Tableau 2…)" onClick={() => set({ dialog: "caption" })} />
        <DropdownButton
          icon={ListOrdered}
          size="lg"
          label="Table des illustrations"
          items={labelList.length
            ? labelList.map((l) => ({ label: l, title: `Liste des légendes « ${l} » avec leur page`, onSelect: () => editor?.chain().focus().insertTableOfContents({ kind: "captions", label: l }).run() }))
            : [{ label: "Aucune légende dans le document", disabled: true }]}
        />
      </RibbonGroup>
    </>
  );
}
