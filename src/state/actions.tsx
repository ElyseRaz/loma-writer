import { sanitizePage } from "../services/documents/sanitize";
import { cleanStyles } from "../editor/docStyles";
import { cleanWatermark } from "../editor/watermark";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { useLomaEditor } from "../editor/EditorProvider";
import { loadContent } from "../editor/loadContent";
import type { DocumentTemplate } from "../editor/templates";
import { paperWarning } from "../services/printSections";
import { baseName, FILTERS, nativeFileIO, pickFileToOpen, pickSavePath, printPage, writeTextFile } from "../services/files";
import { exportHtml, exportText } from "../services/documentFormat";
import {
  DEFAULT_FORMAT, formatFromPath, loadDocument, saveDocument, withExtension, type DocFormat, type DocumentModel,
} from "../services/documents";
import { forgetRecent, rememberRecent } from "../services/recent";
import { destroyWindow, onCloseRequested, setNativeTitle } from "../services/window";
import { UNTITLED, useApp } from "./store";
import { DEFAULT_PAGE, type PageSetup } from "./types";
import { emptyHeaderFooter, sanitizeHeaderFooter, type HeaderFooterSettings } from "../pagination/headerFooter";

const DRAFT_KEY = "loma:draft";

/** Drops the recovery draft: the user explicitly discarded or saved the changes. */
export const clearDraft = () => localStorage.removeItem(DRAFT_KEY);

export interface DocumentActions {
  newDocument: (template?: DocumentTemplate) => void;
  openDocument: (path?: string) => void;
  /** `force` skips the "elements will be lost" confirmation (already answered by the user). */
  save: (force?: boolean) => Promise<boolean>;
  saveAs: () => Promise<boolean>;
  exportAs: (kind: "html" | "txt") => Promise<void>;
  print: () => void;
  quit: () => void;
  /** Runs `next` immediately, or after the user resolved the unsaved-changes dialog. */
  guard: (next: () => void) => void;
}

const ActionsContext = createContext<DocumentActions | null>(null);

const stripExt = (name: string) => name.replace(/\.[^.]+$/, "");
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** Notes that describe the conversion rather than a loss of content. */
const isInformational = (w: string) => w.startsWith("Ce fichier .doc a été converti") || w.startsWith("L'extension .");

/** Order of the formats offered by "Enregistrer sous". */
const SAVE_ORDER: DocFormat[] = ["docx", "odt", "doc", "loma"];

export function DocumentActionsProvider({ children }: { children: ReactNode }) {
  const editor = useLomaEditor();
  const { state, set, notify } = useApp();
  const stateRef = useRef(state);
  stateRef.current = state;

  const markLoaded = useCallback(
    (title: string, path: string | null, format: DocFormat, lossy: string[] = []) => {
      set((s) => ({ doc: { title, path, dirty: false, format, lossy }, view: "editor", docRevision: s.docRevision + 1 }));
      clearDraft();
    },
    [set],
  );

  const guard = useCallback(
    (next: () => void) => {
      if (stateRef.current.doc.dirty) set({ dialog: "unsaved", pendingAction: next });
      else next();
    },
    [set],
  );

  const snapshot = useCallback((ed: Editor): DocumentModel => {
    const { page, prefs, headerFooter, docStyles, watermark } = stateRef.current;
    return { content: ed.getJSON(), page, headerFooter, styles: docStyles, watermark, defaults: { fontFamily: prefs.fontFamily, fontSizePt: prefs.fontSizePt } };
  }, []);

  const newDocument = useCallback(
    (template?: DocumentTemplate) => {
      if (!editor) return;
      guard(() => {
        loadContent(editor, template?.html ?? "<p></p>");
        set({ page: DEFAULT_PAGE, headerFooter: emptyHeaderFooter(), docStyles: {}, watermark: null });
        markLoaded(UNTITLED, null, DEFAULT_FORMAT);
        queueMicrotask(() => editor.commands.focus("start"));
      });
    },
    [editor, guard, markLoaded, set],
  );

  const openDocument = useCallback(
    (knownPath?: string) => {
      if (!editor) return;
      guard(async () => {
        try {
          const path = knownPath ?? (await pickFileToOpen());
          if (!path) return;
          const opened = await loadDocument(nativeFileIO, path);
          const name = baseName(path);
          const mismatch = opened.warnings.some((w) => w.startsWith("L'extension ."));
          const lossy = opened.warnings.filter((w) => !isInformational(w));

          if (opened.html !== undefined) {
            // HTML / text are imports: saving asks for a real document format and path.
            loadContent(editor, opened.html);
            set({ page: DEFAULT_PAGE, headerFooter: emptyHeaderFooter(), docStyles: {}, watermark: null });
            markLoaded(stripExt(name), null, DEFAULT_FORMAT);
          } else {
            loadContent(editor, opened.model.content);
            set({ page: opened.model.page, headerFooter: sanitizeHeaderFooter(opened.model.headerFooter), docStyles: cleanStyles(opened.model.styles), watermark: cleanWatermark(opened.model.watermark) });
            const format = opened.format as DocFormat;
            // A wrong extension must not make "Enregistrer" silently rewrite the file in another format.
            markLoaded(stripExt(name), mismatch ? null : path, format, lossy);
            rememberRecent(path, name, format);
          }
          if (opened.warnings.length) set({ importReport: { name, warnings: opened.warnings }, dialog: "importReport" });
          queueMicrotask(() => editor.commands.focus("start"));
        } catch (e) {
          if (knownPath) forgetRecent(knownPath); // moved or deleted: stop offering it
          notify(`Ouverture impossible : ${errorMessage(e)}`, "error");
        }
      });
    },
    [editor, guard, markLoaded, notify, set],
  );

  const writeDocument = useCallback(
    async (ed: Editor, path: string, format: DocFormat) => {
      const saved = ed.state.doc;
      const warnings = await saveDocument(nativeFileIO, path, format, snapshot(ed));
      const name = baseName(path);
      // Keep the dirty flag (and the draft) if the user kept typing while the file was written.
      const unchanged = ed.state.doc.eq(saved);
      set((s) => ({ doc: { ...s.doc, title: stripExt(name), path, format, dirty: !unchanged, lossy: [] } }));
      if (unchanged) clearDraft();
      rememberRecent(path, name, format);
      notify(warnings.length ? `Enregistré (.${format}) avec avertissement : ${warnings[0]}` : `Document enregistré (.${format}).`);
    },
    [notify, set, snapshot],
  );

  const saveAs = useCallback(async (): Promise<boolean> => {
    if (!editor) return false;
    try {
      const { doc } = stateRef.current;
      // The current format comes first so it is the dialog's default filter.
      const order = [doc.format, ...SAVE_ORDER.filter((f) => f !== doc.format)];
      const chosen = await pickSavePath(`${doc.title}.${doc.format}`, order.map((f) => FILTERS[f]));
      if (!chosen) return false;
      // The extension typed by the user decides the format; with none, the default format is used.
      const format = formatFromPath(chosen) ?? DEFAULT_FORMAT;
      await writeDocument(editor, withExtension(chosen, format), format);
      return true;
    } catch (e) {
      notify(`Enregistrement impossible : ${errorMessage(e)}`, "error");
      return false;
    }
  }, [editor, notify, writeDocument]);

  const save = useCallback(async (force = false): Promise<boolean> => {
    if (!editor) return false;
    const { path, format, lossy } = stateRef.current.doc;
    if (!path) return saveAs();
    if (lossy.length && !force) {
      // Overwriting the source would permanently drop what could not be imported: ask first.
      set({ dialog: "lossySave" });
      return false;
    }
    try {
      await writeDocument(editor, path, format);
      return true;
    } catch (e) {
      notify(`Enregistrement impossible : ${errorMessage(e)}`, "error");
      return false;
    }
  }, [editor, notify, saveAs, set, writeDocument]);

  const exportAs = useCallback(
    async (kind: "html" | "txt") => {
      if (!editor) return;
      try {
        const { title } = stateRef.current.doc;
        const path = await pickSavePath(`${title}.${kind}`, [kind === "html" ? FILTERS.html : FILTERS.text]);
        if (!path) return;
        const target = new RegExp(`\\.${kind === "html" ? "html?" : "(txt|md)"}$`, "i").test(path) ? path : `${path}.${kind}`;
        await writeTextFile(target, kind === "html" ? exportHtml(editor, title) : exportText(editor));
        notify(`Exporté vers ${baseName(target)}.`);
      } catch (e) {
        notify(`Export impossible : ${errorMessage(e)}`, "error");
      }
    },
    [editor, notify],
  );

  const print = useCallback(() => {
    set({ view: "editor" });
    // Let the editor view mount before the print dialog snapshots the page.
    setTimeout(() => { const warning = paperWarning(); if (warning) notify(warning); void printPage().catch((e) => notify(`Impression impossible : ${errorMessage(e)}`, "error")); }, 150);
  }, [set, notify]);

  const quit = useCallback(
    () =>
      guard(() => {
        clearDraft(); // the user either saved or chose to discard
        destroyWindow();
      }),
    [guard],
  );

  // Native close request (Alt+F4, window manager) goes through the same unsaved-changes guard.
  useEffect(() => onCloseRequested(quit), [quit]);

  // Native window title mirrors the document, with its real extension and the unsaved marker.
  useEffect(() => {
    setNativeTitle(`${state.doc.dirty ? "• " : ""}${state.doc.title}.${state.doc.format} — Loma Writer`);
  }, [state.doc.title, state.doc.format, state.doc.dirty]);

  // Local draft recovery: debounced on every edit, so it also covers long typing sessions.
  const { autosave } = state.prefs;
  useEffect(() => {
    if (!editor || !autosave) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const write = () => {
      const { doc, page } = stateRef.current;
      if (!doc.dirty) return; // saved in the meantime
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ title: doc.title, path: doc.path, format: doc.format, lossy: doc.lossy, page, headerFooter: stateRef.current.headerFooter, docStyles: stateRef.current.docStyles, watermark: stateRef.current.watermark, content: editor.getJSON() }));
      } catch {
        /* draft too large or storage unavailable */
      }
    };
    const onUpdate = () => {
      clearTimeout(timer);
      timer = setTimeout(write, 1500);
    };
    editor.on("update", onUpdate);
    return () => {
      clearTimeout(timer);
      editor.off("update", onUpdate);
    };
  }, [editor, autosave]);

  useEffect(() => {
    if (!editor) return;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as { title: string; path: string | null; format?: string; lossy?: string[]; page?: Partial<PageSetup>; headerFooter?: HeaderFooterSettings; docStyles?: unknown; watermark?: unknown; content: object };
      loadContent(editor, draft.content);
      const format = (draft.format as DocFormat | undefined) ?? (draft.path ? formatFromPath(draft.path) : null) ?? DEFAULT_FORMAT;
      set({ doc: { title: draft.title, path: draft.path, dirty: true, format, lossy: draft.lossy ?? [] }, page: sanitizePage(draft.page), headerFooter: sanitizeHeaderFooter(draft.headerFooter), docStyles: cleanStyles(draft.docStyles), watermark: cleanWatermark(draft.watermark), view: "editor" });
      notify("Brouillon non enregistré restauré.");
    } catch {
      localStorage.removeItem(DRAFT_KEY);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const value = useMemo<DocumentActions>(
    () => ({ newDocument, openDocument, save, saveAs, exportAs, print, quit, guard }),
    [newDocument, openDocument, save, saveAs, exportAs, print, quit, guard],
  );
  return <ActionsContext.Provider value={value}>{children}</ActionsContext.Provider>;
}

export function useActions(): DocumentActions {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error("useActions must be used inside DocumentActionsProvider");
  return ctx;
}
