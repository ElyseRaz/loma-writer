import { copySelection, isObjectSelection, pasteInternal } from "./InternalClipboard";
import { TextGrow, TextShrink } from "../components/ui/TextSizeIcons";
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, ClipboardPaste, Code, Copy, Eye, FilePlus2, Paintbrush, Replace, FolderOpen,
  Highlighter, IndentDecrease, Search, IndentIncrease, Italic, Keyboard, Link, List, ListOrdered, Minus, Moon, MousePointer2,
  PanelLeft, Pilcrow, Printer, Quote, Redo2, RemoveFormatting, Ruler, Save, SaveAll, Scissors, Settings, SpellCheck,
  Strikethrough, Subscript, Sun, Superscript, Table, Underline, Undo2, ZoomIn, ZoomOut, Info, Hash, FileText,
  FileCode, SeparatorHorizontal, BookOpen, Smile, BarChart3, Bookmark, CornerDownRight, Sigma, PanelTop, PanelBottom, TextCursorInput, Heading1, Heading2, Heading3, Heading4, Heading5, Heading6, Power, type LucideIcon,
} from "lucide-react";
import { useLomaEditor } from "./EditorProvider";
import { captureFormat } from "./formatPainter";
import { useEditorSnapshot } from "./useEditorSnapshot";
import { useActions } from "../state/actions";
import { useApp } from "../state/store";

export interface Command {
  id: string;
  label: string;
  icon?: LucideIcon;
  /** Display string, e.g. "Ctrl+Shift+S". */
  shortcut?: string;
  /** True when the app (not TipTap) must listen for this shortcut. */
  global?: boolean;
  group: string;
  run: () => void;
  active?: boolean;
  disabled?: boolean;
}

const CommandsContext = createContext<Record<string, Command>>({});
export const useCommandMap = () => useContext(CommandsContext);

export function useCommand(id: string): Command | undefined {
  return useContext(CommandsContext)[id];
}

export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72, 80, 96, 120, 150, 200, 300, 400];
/** Like Word: any size from 1 to 1638 pt can be typed. */
export const MIN_FONT_PT = 1;
export const MAX_FONT_PT = 1638;
export const FONT_FAMILIES = ["Inter", "Ubuntu", "DejaVu Sans", "Liberation Serif", "Liberation Mono"];

/** The next size of the font-size list above (or below) `pt`, like Word's "Agrandir/Réduire la police". */
export function nextSize(pt: number, dir: 1 | -1): number {
  const next = dir > 0 ? FONT_SIZES.find((s) => s > pt) : [...FONT_SIZES].reverse().find((s) => s < pt);
  // Beyond the list (or below it) the size moves by a tenth.
  const step = Math.max(1, Math.round(pt / 10));
  return Math.min(MAX_FONT_PT, Math.max(dir > 0 ? MIN_FONT_PT : 6, next ?? (dir > 0 ? pt + step : pt - 1)));
}
export const TEXT_COLORS = ["#242424", "#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#2563eb", "#7c3aed", "#6b7280"];
export const HIGHLIGHT_COLORS = ["#fef08a", "#bbf7d0", "#bfdbfe", "#fbcfe8", "#fed7aa", "#e9d5ff"];
export const LINE_HEIGHTS = ["1", "1.15", "1.5", "2", "2.5", "3"];

const MIN_ZOOM = 25;
const MAX_ZOOM = 300;
const ZOOM_STEPS = [25, 50, 75, 90, 100, 110, 125, 150, 175, 200, 250, 300];

export function parsePt(size: string | null): number | null {
  if (!size) return null;
  const n = parseFloat(size);
  return Number.isFinite(n) ? n : null;
}

export function CommandsProvider({ children }: { children: ReactNode }) {
  const editor = useLomaEditor();
  const snap = useEditorSnapshot(editor);
  const { state, set, notify } = useApp();
  const actions = useActions();

  const commands = useMemo(() => {
    const list: Command[] = [];
    const add = (c: Command) => list.push(c);
    const chain = () => editor!.chain().focus();
    const setZoom = (z: number) => set({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)) });
    const stepZoom = (dir: 1 | -1) => {
      const next = dir > 0 ? ZOOM_STEPS.find((z) => z > state.zoom) : [...ZOOM_STEPS].reverse().find((z) => z < state.zoom);
      setZoom(next ?? state.zoom);
    };
    const currentPt = parsePt(snap.fontSize) ?? state.prefs.fontSizePt;

    // ----- Fichier -----
    add({ id: "file.new", label: "Nouveau document", icon: FilePlus2, shortcut: "Ctrl+N", global: true, group: "Fichier", run: () => actions.newDocument() });
    add({ id: "file.open", label: "Ouvrir…", icon: FolderOpen, shortcut: "Ctrl+O", global: true, group: "Fichier", run: () => actions.openDocument() });
    add({ id: "file.save", label: "Enregistrer", icon: Save, shortcut: "Ctrl+S", global: true, group: "Fichier", run: () => void actions.save() });
    add({ id: "file.saveAs", label: "Enregistrer sous…", icon: SaveAll, shortcut: "Ctrl+Shift+S", global: true, group: "Fichier", run: () => void actions.saveAs() });
    add({ id: "file.exportHtml", label: "Exporter en HTML…", icon: FileCode, group: "Fichier", run: () => void actions.exportAs("html") });
    add({ id: "file.exportTxt", label: "Exporter en texte brut…", icon: FileText, group: "Fichier", run: () => void actions.exportAs("txt") });
    add({ id: "file.print", label: "Imprimer / Exporter en PDF…", icon: Printer, shortcut: "Ctrl+P", global: true, group: "Fichier", run: actions.print });
    add({ id: "file.quit", label: "Quitter", icon: Power, shortcut: "Ctrl+Q", global: true, group: "Fichier", run: actions.quit });
    add({ id: "app.preferences", label: "Préférences", icon: Settings, shortcut: "Ctrl+Shift+P", global: true, group: "Application", run: () => set({ dialog: "preferences" }) });
    add({ id: "app.about", label: "À propos de Loma Writer", icon: Info, group: "Application", run: () => set({ dialog: "about" }) });
    add({ id: "app.palette", label: "Rechercher une commande", shortcut: "Ctrl+K", global: true, group: "Application", run: () => set({ dialog: "palette" }) });
    add({ id: "app.shortcuts", label: "Raccourcis clavier", icon: Keyboard, group: "Application", run: () => set({ dialog: "preferences" }) });

    if (!editor) return Object.fromEntries(list.map((c) => [c.id, c]));

    // ----- Édition -----
    add({ id: "edit.undo", label: "Annuler", icon: Undo2, shortcut: "Ctrl+Z", global: true, group: "Édition", disabled: !snap.canUndo, run: () => chain().undo().run() });
    add({ id: "edit.redo", label: "Rétablir", icon: Redo2, shortcut: "Ctrl+Y", global: true, group: "Édition", disabled: !snap.canRedo, run: () => chain().redo().run() });
    add({ id: "edit.cut", label: "Couper", icon: Scissors, shortcut: "Ctrl+X", group: "Édition", disabled: !snap.hasSelection, run: () => { editor.commands.focus(); if (isObjectSelection(editor.view)) copySelection(editor.view, true); else document.execCommand("cut"); } });
    add({ id: "edit.copy", label: "Copier", icon: Copy, shortcut: "Ctrl+C", group: "Édition", disabled: !snap.hasSelection, run: () => { editor.commands.focus(); if (isObjectSelection(editor.view)) copySelection(editor.view); else document.execCommand("copy"); } });
    add({
      id: "edit.paste", label: "Coller", icon: ClipboardPaste, shortcut: "Ctrl+V", group: "Édition",
      run: () => {
        const pasteText = (text: string) => chain().insertContent(text.split(/\r?\n/).map((l) => ({ type: "paragraph", content: l ? [{ type: "text", text: l }] : [] }))).run();
        const clip = navigator.clipboard?.readText ? navigator.clipboard.readText() : Promise.reject(new Error("no clipboard"));
        clip.then(
          (text) => { if (!pasteInternal(editor.view, text)) pasteText(text); },
          // The system clipboard cannot be read (or is empty of text, as after copying a picture): use the editor's own copy.
          () => { if (!pasteInternal(editor.view, null)) notify("Le presse-papiers n'est pas accessible : utilisez Ctrl+V.", "error"); },
        );
      },
    });
    const openFind = (replace: boolean) => set((s) => ({ find: { open: true, replace: replace || (s.find.open && s.find.replace), nonce: s.find.nonce + 1 } }));
    add({ id: "edit.find", label: "Rechercher", icon: Search, shortcut: "Ctrl+F", global: true, group: "Édition", run: () => openFind(false) });
    add({ id: "edit.replace", label: "Remplacer", icon: Replace, shortcut: "Ctrl+H", global: true, group: "Édition", run: () => openFind(true) });
    add({
      id: "edit.painter", label: "Reproduire la mise en forme", icon: Paintbrush, group: "Édition", active: state.painter !== null,
      run: () => {
        if (state.painter) return set({ painter: null });
        set({ painter: captureFormat(editor) });
        notify("Sélectionnez le texte à mettre en forme (Échap pour annuler).");
      },
    });
    add({ id: "edit.selectAll", label: "Sélectionner tout", icon: MousePointer2, shortcut: "Ctrl+A", group: "Édition", run: () => chain().selectAll().run() });

    // ----- Police -----
    add({ id: "format.bold", label: "Gras", icon: Bold, shortcut: "Ctrl+B", group: "Police", active: snap.bold, run: () => chain().toggleBold().run() });
    add({ id: "format.italic", label: "Italique", icon: Italic, shortcut: "Ctrl+I", group: "Police", active: snap.italic, run: () => chain().toggleItalic().run() });
    add({ id: "format.underline", label: "Souligné", icon: Underline, shortcut: "Ctrl+U", group: "Police", active: snap.underline, run: () => chain().toggleUnderline().run() });
    add({ id: "format.strike", label: "Barré", icon: Strikethrough, shortcut: "Ctrl+Shift+X", group: "Police", active: snap.strike, run: () => chain().toggleStrike().run() });
    add({ id: "format.subscript", label: "Indice", icon: Subscript, shortcut: "Ctrl+,", group: "Police", active: snap.subscript, run: () => chain().toggleSubscript().run() });
    add({ id: "format.superscript", label: "Exposant", icon: Superscript, shortcut: "Ctrl+.", group: "Police", active: snap.superscript, run: () => chain().toggleSuperscript().run() });
    add({ id: "format.highlight", label: "Surlignage", icon: Highlighter, group: "Police", active: snap.highlight, run: () => chain().toggleHighlight({ color: HIGHLIGHT_COLORS[0] }).run() });
    add({ id: "format.clear", label: "Effacer la mise en forme", icon: RemoveFormatting, group: "Police", run: () => chain().unsetAllMarks().clearNodes().run() });
    add({ id: "format.grow", label: "Agrandir la police", icon: TextGrow, group: "Police", run: () => chain().setFontSize(`${nextSize(currentPt, 1)}pt`).run() });
    add({ id: "format.shrink", label: "Réduire la police", icon: TextShrink, group: "Police", run: () => chain().setFontSize(`${nextSize(currentPt, -1)}pt`).run() });

    // ----- Paragraphe -----
    add({ id: "para.bullet", label: "Liste à puces", icon: List, shortcut: "Ctrl+Shift+8", group: "Paragraphe", active: snap.bulletList, run: () => chain().toggleBulletList().run() });
    add({ id: "para.ordered", label: "Liste numérotée", icon: ListOrdered, shortcut: "Ctrl+Shift+7", group: "Paragraphe", active: snap.orderedList, run: () => chain().toggleOrderedList().run() });
    add({ id: "para.indent", label: "Augmenter le retrait (listes)", icon: IndentIncrease, shortcut: "Tab", group: "Paragraphe", disabled: !(snap.bulletList || snap.orderedList), run: () => chain().sinkListItem("listItem").run() });
    add({ id: "para.outdent", label: "Diminuer le retrait (listes)", icon: IndentDecrease, shortcut: "Shift+Tab", group: "Paragraphe", disabled: !(snap.bulletList || snap.orderedList), run: () => chain().liftListItem("listItem").run() });
    const align = (id: "left" | "center" | "right" | "justify", label: string, icon: LucideIcon, key: string) =>
      add({ id: `para.align.${id}`, label, icon, shortcut: `Ctrl+Shift+${key}`, group: "Paragraphe", active: snap.align === id, run: () => chain().setTextAlign(id).run() });
    align("left", "Aligner à gauche", AlignLeft, "L");
    align("center", "Centrer", AlignCenter, "E");
    align("right", "Aligner à droite", AlignRight, "R");
    align("justify", "Justifier", AlignJustify, "J");
    add({ id: "para.marks", label: "Afficher les marques de paragraphe", icon: Pilcrow, group: "Paragraphe", active: state.marks, run: () => set((s) => ({ marks: !s.marks })) });

    // ----- Styles -----
    add({ id: "style.normal", label: "Style Normal", icon: Pilcrow, shortcut: "Ctrl+Alt+0", group: "Styles", active: snap.heading === 0 && !snap.blockquote && !snap.codeBlock, run: () => (snap.blockquote ? chain().unsetBlockquote().setParagraph().run() : chain().setParagraph().run()) });
    add({ id: "style.h1", label: "Titre 1", icon: Heading1, shortcut: "Ctrl+Alt+1", group: "Styles", active: snap.heading === 1, run: () => chain().setHeading({ level: 1 }).run() });
    add({ id: "style.h2", label: "Titre 2", icon: Heading2, shortcut: "Ctrl+Alt+2", group: "Styles", active: snap.heading === 2, run: () => chain().setHeading({ level: 2 }).run() });
    add({ id: "style.h4", label: "Titre 4", icon: Heading4, shortcut: "Ctrl+Alt+4", group: "Styles", active: snap.heading === 4, run: () => chain().setHeading({ level: 4 }).run() });
    add({ id: "style.h5", label: "Titre 5", icon: Heading5, shortcut: "Ctrl+Alt+5", group: "Styles", active: snap.heading === 5, run: () => chain().setHeading({ level: 5 }).run() });
    add({ id: "style.h6", label: "Titre 6", icon: Heading6, shortcut: "Ctrl+Alt+6", group: "Styles", active: snap.heading === 6, run: () => chain().setHeading({ level: 6 }).run() });
    add({ id: "style.h3", label: "Titre 3", icon: Heading3, shortcut: "Ctrl+Alt+3", group: "Styles", active: snap.heading === 3, run: () => chain().setHeading({ level: 3 }).run() });
    add({ id: "style.quote", label: "Citation", icon: Quote, shortcut: "Ctrl+Shift+B", group: "Styles", active: snap.blockquote, run: () => chain().toggleBlockquote().run() });
    add({ id: "style.code", label: "Bloc de code", icon: Code, shortcut: "Ctrl+Alt+C", group: "Styles", active: snap.codeBlock, run: () => chain().toggleCodeBlock().run() });

    // ----- Insertion -----
    add({ id: "insert.link", label: "Lien hypertexte…", icon: Link, shortcut: "Ctrl+Shift+K", global: true, group: "Insertion", active: snap.link, run: () => set({ dialog: "link" }) });
    add({ id: "insert.pageBreak", label: "Saut de page", icon: SeparatorHorizontal, shortcut: "Ctrl+Enter", group: "Insertion", run: () => chain().insertPageBreak().run() });
    add({ id: "insert.columnBreak", label: "Saut de colonne", icon: SeparatorHorizontal, shortcut: "Ctrl+Maj+Entrée", group: "Insertion", run: () => chain().insertColumnBreak().run() });
    add({ id: "insert.blankPage", label: "Page vierge", icon: FileText, group: "Insertion", run: () => chain().insertContent([{ type: "pageBreak" }, { type: "paragraph" }, { type: "pageBreak" }, { type: "paragraph" }]).run() });
    add({ id: "insert.textBox", label: "Zone de texte", icon: TextCursorInput, group: "Insertion", run: () => chain().insertShape("textbox").run() });
    add({ id: "insert.coverPage", label: "Page de garde…", icon: BookOpen, group: "Insertion", run: () => set({ dialog: "coverPage" }) });
    add({ id: "insert.icons", label: "Icônes…", icon: Smile, group: "Insertion", run: () => set({ dialog: "icons" }) });
    add({ id: "insert.chart", label: "Graphique…", icon: BarChart3, group: "Insertion", run: () => set({ dialog: "chart" }) });
    add({ id: "insert.bookmark", label: "Signet…", icon: Bookmark, group: "Insertion", run: () => set({ dialog: "bookmark" }) });
    add({ id: "insert.crossRef", label: "Renvoi…", icon: CornerDownRight, group: "Insertion", run: () => set({ dialog: "crossRef" }) });
    add({ id: "insert.equation", label: "Équation…", icon: Sigma, group: "Insertion", run: () => set({ equationPos: null, dialog: "equation" }) });
    add({ id: "insert.header", label: "En-tête…", icon: PanelTop, group: "Insertion", run: () => set({ hfKind: "header", dialog: "headerFooter" }) });
    add({ id: "insert.footer", label: "Pied de page…", icon: PanelBottom, group: "Insertion", run: () => set({ hfKind: "footer", dialog: "headerFooter" }) });
    add({ id: "insert.hr", label: "Ligne horizontale", icon: Minus, group: "Insertion", run: () => chain().setHorizontalRule().run() });
    add({ id: "insert.table", label: "Insérer un tableau 3 × 3", icon: Table, group: "Insertion", run: () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() });
    add({ id: "insert.datetime", label: "Insérer la date du jour", icon: Hash, group: "Insertion", run: () => chain().insertContent(new Date().toLocaleDateString("fr-FR", { dateStyle: "long" })).run() });

    // ----- Affichage -----
    add({ id: "view.zoomIn", label: "Zoom avant", icon: ZoomIn, shortcut: "Ctrl+=", global: true, group: "Affichage", run: () => stepZoom(1) });
    add({ id: "view.zoomOut", label: "Zoom arrière", icon: ZoomOut, shortcut: "Ctrl+-", global: true, group: "Affichage", run: () => stepZoom(-1) });
    add({ id: "view.zoom100", label: "Zoom 100 %", icon: Eye, shortcut: "Ctrl+0", global: true, group: "Affichage", run: () => setZoom(100) });
    add({ id: "view.nav", label: "Volet de navigation", icon: PanelLeft, group: "Affichage", active: state.navPane, run: () => set((s) => ({ navPane: !s.navPane })) });
    add({ id: "view.bookmarks", label: "Signets", icon: Bookmark, group: "Affichage", active: state.bookmarks, run: () => set((s) => ({ bookmarks: !s.bookmarks })) });
    add({ id: "view.bounds", label: "Limites du texte", icon: Ruler, group: "Affichage", active: state.textBounds, run: () => set((s) => ({ textBounds: !s.textBounds })) });
    add({ id: "view.ruler", label: "Règle", icon: Ruler, group: "Affichage", active: state.ruler, run: () => set((s) => ({ ruler: !s.ruler })) });
    add({ id: "view.themeLight", label: "Thème clair", icon: Sun, group: "Affichage", active: state.theme === "light", run: () => set({ theme: "light" }) });
    add({ id: "view.themeDark", label: "Thème sombre", icon: Moon, group: "Affichage", active: state.theme === "dark", run: () => set({ theme: "dark" }) });
    add({ id: "view.themeToggle", label: "Basculer clair / sombre", icon: Moon, shortcut: "Ctrl+Shift+D", global: true, group: "Affichage", run: () => set({ theme: document.documentElement.dataset.theme === "dark" ? "light" : "dark" }) });

    // ----- Révision -----
    add({ id: "review.spell", label: "Vérification orthographique du système", icon: SpellCheck, group: "Révision", active: state.spellcheck, run: () => set((s) => ({ spellcheck: !s.spellcheck })) });
    add({ id: "review.wordCount", label: "Statistiques du document", icon: Hash, group: "Révision", run: () => set({ dialog: "wordCount" }) });

    return Object.fromEntries(list.map((c) => [c.id, c]));
  }, [editor, snap, state.painter, state.zoom, state.marks, state.navPane, state.ruler, state.textBounds, state.bookmarks, state.theme, state.spellcheck, state.prefs.fontSizePt, actions, set, notify]);

  // Global keyboard shortcuts (the ones TipTap does not already own).
  const commandsRef = useRef(commands);
  const dialogRef = useRef(state.dialog);
  commandsRef.current = commands;
  dialogRef.current = state.dialog;
  useEffect(() => {
    // Layout-independent keys: on AZERTY, digits need Shift and "=" lives elsewhere.
    const CODES: Record<string, string[]> = { "0": ["Digit0", "Numpad0"], "=": ["Equal", "NumpadAdd"], "-": ["Minus", "NumpadSubtract"] };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || dialogRef.current) return;
      if (e.defaultPrevented) return; // the editor already handled it (its own undo/redo keymap)
      const key = e.key === "+" ? "=" : e.key.toLowerCase();
      // Undo / redo of the document work from anywhere (ribbon, handles, canvas), except inside a text field that has its own history.
      if (key === "z" || key === "y") {
        const t = e.target as HTMLElement | null;
        if (t?.closest?.("input, textarea, select, [contenteditable=true]") && !t.closest?.(".ProseMirror")) return;
        e.preventDefault();
        const id = key === "y" || e.shiftKey ? "edit.redo" : "edit.undo";
        const c = commandsRef.current[id];
        if (c && !c.disabled) c.run();
        return;
      }
      if (e.repeat) return;
      for (const c of Object.values(commandsRef.current)) {
        if (!c.global || !c.shortcut) continue;
        const parts = c.shortcut.toLowerCase().split("+");
        const want = parts[parts.length - 1];
        const byCode = CODES[want];
        const keyMatches = byCode ? byCode.includes(e.code) || want === key : want === key;
        if (keyMatches && (byCode || parts.includes("shift") === e.shiftKey) && !e.altKey) {
          e.preventDefault();
          if (!c.disabled) c.run();
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return <CommandsContext.Provider value={commands}>{children}</CommandsContext.Provider>;
}
