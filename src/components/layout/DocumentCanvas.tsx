import { EditorContent, useEditorState } from "@tiptap/react";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import { useEffect, useMemo, useRef, useState } from "react";
import { applyFormat } from "../../editor/formatPainter";
import { useCommandMap } from "../../editor/commands";
import { useLomaEditor } from "../../editor/EditorProvider";
import { useEditorSnapshot } from "../../editor/useEditorSnapshot";
import { hasContent, reserveFor } from "../../pagination/headerFooter";
import { pageGeometry } from "../../pagination/model";
import { requestPagination, setPaginationInputs } from "../../pagination/extension";
import { installSectionPrint } from "../../services/printSections";
import { usePageInfo, usePageNotes, usePaginationBands, usePaginationSheets } from "../../pagination/usePagination";
import type { Sheet } from "../../pagination/model";
import { buildSections, readSectionBreaks, readSections, sectionIndexAt, type SectionInfo } from "../../editor/Sections";
import { stylesCss } from "../../editor/docStyles";
import { makePageLabeler } from "../../editor/references/pageLabels";
import type { ReferencesStorage } from "../../editor/references/Toc";
import { useApp } from "../../state/store";
import { ContextMenu, type MenuEntry } from "../ui/Menu";
import type { Anchor } from "../ui/Popover";
import { PageSheets, type HeaderFooterHeights } from "./PageSheets";
import { Ruler } from "./Ruler";
import { ShapeToolbar } from "./ShapeToolbar";
import { ImageToolbar } from "./ImageToolbar";
import { TableMoveHandle } from "./TableMoveHandle";
import { TableInsertHandles } from "./TableInsertHandles";
import { TableToolbar } from "./TableToolbar";

/** Draws the user's style overrides, and re-paginates since they change line and paragraph heights. */
function DocStylesCss() {
  const { state } = useApp();
  const editor = useLomaEditor();
  const css = useMemo(() => stylesCss(state.docStyles), [state.docStyles]);
  useEffect(() => { if (editor) requestPagination(editor); }, [css, editor, state.prefs.fontFamily, state.prefs.fontSizePt]);
  return <style data-loma-styles>{css}</style>;
}

export function DocumentCanvas() {
  const editor = useLomaEditor();
  const snap = useEditorSnapshot(editor);
  const cmds = useCommandMap();
  const { state, set } = useApp();
  const [menu, setMenu] = useState<Anchor | null>(null);

  // Pagination works on logical page geometry; zoom only scales the rendering. A document has one or more sections, each with
  // its own paper, margins, headers and footers: the document's own setup is the first section, every section break the next one.
  const breaks = useEditorState({ editor, selector: ({ editor: e }) => (e ? readSectionBreaks(e.state.doc) : []) }) ?? [];
  const sections = useMemo(() => buildSections(breaks, state.page, state.headerFooter), [breaks, state.page, state.headerFooter]);
  // The room reserved for a header/footer follows its measured height (one line until measured), per section.
  const [hfs, setHfs] = useState<HeaderFooterHeights[]>([]);
  const geometries = useMemo(
    () => sections.map((s, i) => pageGeometry(s.page, hasContent(s.hf.header) ? reserveFor(hfs[i]?.header ?? 20) : 0, hasContent(s.hf.footer) ? reserveFor(hfs[i]?.footer ?? 20) : 0)),
    [sections, hfs],
  );
  const geometry = geometries[0];
  const scale = state.zoom / 100;
  const { total } = usePageInfo(editor, geometry.pitch);
  const engineSheets = usePaginationSheets(editor);
  const bands = usePaginationBands(editor);
  const pageNotes = usePageNotes(editor);
  // Sheets in stack coordinates. Before the first layout there is one geometry and `total` pages.
  const sheets: Sheet[] = useMemo(() => {
    if (engineSheets.length) return engineSheets;
    const g = geometry;
    return Array.from({ length: total }, (_, i) => ({ top: i * g.pitch - g.insetTop, left: 0, width: g.width, height: g.height, insetTop: g.insetTop, insetBottom: g.insetBottom, insetLeft: g.insetLeft, insetRight: g.insetRight, section: 0, indexInSection: i }));
  }, [engineSheets, geometry, total]);
  const maxWidth = Math.max(...geometries.map((g) => g.width));
  const sheetTops = useMemo(() => { let y = 0; return sheets.map((s) => { const top = y; y += s.height + geometry.gap; return top; }); }, [sheets, geometry.gap]);
  const current = useEditorState({ editor, selector: ({ editor: e }) => (e ? sectionIndexAt(e.state.doc, e.state.selection.from) : 0) }) ?? 0;
  const here = geometries[Math.min(current, geometries.length - 1)];

  useEffect(() => {
    if (editor) setPaginationInputs(editor, geometries, scale);
  }, [editor, geometries, scale]);
  // The commands (insert a section break…) need the document-level setup to resolve sections.
  useEffect(() => {
    if (!editor) return;
    (editor.storage as unknown as { sectionBreak: { current: () => SectionInfo[] } }).sectionBreak.current = () => readSections(editor.state.doc, state.page, state.headerFooter);
  }, [editor, state.page, state.headerFooter]);

  // Tables of contents read the page label of a position (numbering of the sections included) from the last layout.
  useEffect(() => {
    if (!editor) return;
    (editor.storage as unknown as { references: ReferencesStorage }).references.labelAt = makePageLabeler(editor, () => readSections(editor.state.doc, state.page, state.headerFooter));
  }, [editor, state.page, state.headerFooter]);

  // The editor is hidden behind the backstage: measure again as soon as it is visible.
  useEffect(() => {
    if (editor && state.view === "editor") requestAnimationFrame(() => requestPagination(editor));
  }, [editor, state.view, state.docRevision]);

  // Documents whose sections have different paper sizes print through per-size copies (see printSections).
  useEffect(() => installSectionPrint(), []);

  // Print uses the same page size as the document.
  useEffect(() => {
    let style = document.getElementById("loma-print-page") as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = "loma-print-page";
      document.head.appendChild(style);
    }
    style.textContent = `@page { size: ${geometry.width}px ${geometry.height}px; margin: 0; }`; // one size for the whole print job
  }, [geometry.width, geometry.height]);

  // A click on the sheet (margins, between pages, the grey around them) or on text releases the selected picture, shape or table.
  useEffect(() => {
    if (!editor) return;
    const keep = "img-box, .shape-box, .img-anchor, .shape-anchor, table, [role=toolbar], [role=menu], [role=dialog], button, input, select, textarea, [data-table-move], [data-table-insert], [data-row-resize-line]";
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.button !== 0 || !t?.closest?.("[data-canvas]") || t.closest(`.${keep}`) || t.closest(".ProseMirror")) return;
      const sel = editor.state.selection;
      const object = sel instanceof NodeSelection ? ["image", "shape", "shapeGroup"].includes(sel.node.type.name) : sel instanceof CellSelection;
      if (!object) return;
      const box = editor.view.dom.getBoundingClientRect();
      const at = editor.view.posAtCoords({ left: Math.min(Math.max(e.clientX, box.left + 1), box.right - 1), top: Math.min(Math.max(e.clientY, box.top + 1), box.bottom - 1) });
      const pos = at ? at.pos : sel.to;
      const tr = editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(Math.min(pos, editor.state.doc.content.size)), 1));
      editor.view.dispatch(tr);
      editor.view.focus();
    };
    // Double-click on the sheet (a margin, the blank below the text) puts the caret there, adding empty paragraphs when the click is
    // below the end of the text (Word's "click and type"). Double-clicks on text keep selecting a word.
    const onDouble = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.button !== 0 || !t?.closest?.("[data-canvas]") || t.closest(`.${keep}`)) return;
      if (t.closest(".ProseMirror") && t !== editor.view.dom) return;
      e.preventDefault();
      const view = editor.view;
      const box = view.dom.getBoundingClientRect();
      const doc = view.state.doc;
      const stack = view.dom.closest<HTMLElement>(".page-stack");
      const scale = stack ? stack.getBoundingClientRect().width / stack.offsetWidth || 1 : 1;
      let lastBottom = box.top;
      let lastOff = -1;
      doc.forEach((_n, off) => {
        const dom = view.nodeDOM(off);
        if (dom instanceof HTMLElement && dom.getBoundingClientRect().height > 0) { lastBottom = dom.getBoundingClientRect().bottom; lastOff = off; }
      });
      const lastNode = lastOff >= 0 ? doc.nodeAt(lastOff) : null;
      if (lastNode && e.clientY > lastBottom + 12) {
        // Below the end of the text: empty paragraphs down to the click (one per line of the last paragraph, at most 60).
        const lastDom = view.nodeDOM(lastOff) as HTMLElement;
        const style = getComputedStyle(lastNode.type.name === "paragraph" ? lastDom : view.dom);
        const step = Math.max(12, ((parseFloat(style.lineHeight) || 24) + (parseFloat(style.marginBottom) || 0)) * scale);
        const lines = Math.min(60, Math.max(1, Math.floor((e.clientY - lastBottom) / step)));
        const emptyLast = lastNode.type.name === "paragraph" && lastNode.content.size === 0;
        const add = emptyLast ? lines - 1 : lines;
        const tr = view.state.tr;
        if (add > 0) tr.insert(doc.content.size, Array.from({ length: add }, () => view.state.schema.nodes.paragraph.create()));
        tr.setSelection(TextSelection.near(tr.doc.resolve(tr.doc.content.size - 1), -1));
        view.dispatch(tr.scrollIntoView());
      } else {
        const at = view.posAtCoords({ left: Math.min(Math.max(e.clientX, box.left + 1), box.right - 1), top: Math.min(Math.max(e.clientY, box.top + 1), box.bottom - 1) });
        if (at) view.dispatch(view.state.tr.setSelection(TextSelection.near(doc.resolve(at.pos), 1)));
      }
      view.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("dblclick", onDouble);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("dblclick", onDouble); };
  }, [editor]);

  // Double-click on an equation edits it.
  useEffect(() => {
    const edit = (e: Event) => set({ equationPos: (e as CustomEvent<{ pos: number }>).detail.pos, dialog: "equation" });
    window.addEventListener("loma:edit-equation", edit);
    return () => window.removeEventListener("loma:edit-equation", edit);
  }, [set]);

  // Double-click on the number of a note edits its text.
  useEffect(() => {
    const edit = (e: Event) => set({ notePos: (e as CustomEvent<{ pos: number }>).detail.pos, dialog: "note" });
    const insert = (e: Event) => set({ notePos: null, noteKind: (e as CustomEvent<{ kind: "foot" | "end" }>).detail.kind, dialog: "note" });
    const source = (e: Event) => set({ sourceEdit: (e as CustomEvent<{ tag: string }>).detail.tag || null, dialog: "sources" });
    window.addEventListener("loma:edit-note", edit);
    window.addEventListener("loma:insert-note", insert);
    window.addEventListener("loma:edit-source", source);
    return () => { window.removeEventListener("loma:edit-note", edit); window.removeEventListener("loma:insert-note", insert); window.removeEventListener("loma:edit-source", source); };
  }, [set]);

  // Format painter: the next selection made with the mouse receives the captured formatting.
  const painter = state.painter;
  useEffect(() => {
    if (!painter) return;
    const cancel = (e: KeyboardEvent) => e.key === "Escape" && set({ painter: null });
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [painter, set]);
  const onMouseUp = () => {
    if (!painter || !editor) return;
    // Let ProseMirror update the selection from the mouse first.
    setTimeout(() => {
      if (applyFormat(editor, painter)) set({ painter: null });
    }, 0);
  };

  const item = (id: string, extra?: Partial<MenuEntry>): MenuEntry => {
    const c = cmds[id];
    return { label: c?.label ?? id, icon: c?.icon, shortcut: c?.shortcut, disabled: c?.disabled, checked: undefined, onSelect: c?.run, ...extra } as MenuEntry;
  };
  const menuItems: MenuEntry[] = [
    item("edit.cut"), item("edit.copy"), item("edit.paste"),
    { separator: true },
    item("format.bold"), item("format.italic"), item("format.underline"),
    item("insert.link"),
    { separator: true },
    item("style.h1"), item("style.h2"), item("style.normal"),
    { separator: true },
    item("insert.pageBreak"),
    item("edit.selectAll"),
  ];

  const stackHeight = sheets.length ? sheetTops[sheetTops.length - 1] + sheets[sheets.length - 1].height : geometry.height;

  // Zoom is a paint-only transform: the layout (and so the pagination) stays at 100 %, whatever the zoom.
  // The wrapper reserves the scaled size so scrolling and centering work.
  const stackRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(stackHeight);
  useEffect(() => {
    const el = stackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContentHeight(el.offsetHeight));
    ro.observe(el);
    setContentHeight(el.offsetHeight);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="relative min-w-0 flex-1 overflow-auto bg-canvas [scrollbar-gutter:stable]" data-canvas>
      {state.ruler && <Ruler pageWidth={here.width} marginLeft={here.insetLeft} marginRight={here.insetRight} zoom={state.zoom} />}
      {editor && snap.inTable && <TableToolbar editor={editor} />}
      {editor && <TableInsertHandles editor={editor} />}
      {editor && <TableMoveHandle editor={editor} />}
      {editor && <ImageToolbar editor={editor} />}
      <DocStylesCss />
      {editor && <ShapeToolbar editor={editor} />}
      <div className="flex w-max min-w-full justify-center px-8 py-6">
        <div className="page-wrap relative shrink-0" style={{ width: maxWidth * scale, height: Math.max(stackHeight, contentHeight) * scale }}>
        <div ref={stackRef} className="page-stack absolute left-0 top-0 origin-top-left" style={{ width: maxWidth, minHeight: stackHeight, transform: `scale(${scale})`, ["--doc-font" as string]: state.prefs.fontFamily, ["--doc-size" as string]: `${state.prefs.fontSizePt}pt` }} data-pages={sheets.length} data-pitch={geometry.pitch} data-inset-left={geometry.insetLeft} data-inset-top={geometry.insetTop} data-sheets={JSON.stringify(sheets.map((s, i) => [Math.round(sheetTops[i] * 100) / 100, s.left, s.width, s.height]))}>
          <PageSheets bands={bands} notes={pageNotes} bounds={state.textBounds} watermark={state.watermark} sheets={sheets} sections={sections} geometries={geometries} onHeights={(i, h) => setHfs((cur) => (cur[i] && cur[i].header === h.header && cur[i].footer === h.footer ? cur : Object.assign([...cur], { [i]: h })))} />
          <div
            className={`paper relative${state.marks ? " show-marks" : ""}${state.bookmarks ? "" : " hide-bookmarks"}${painter ? " painter-armed" : ""}`}
            onMouseUp={onMouseUp}
            style={
              {
                width: maxWidth,
                minHeight: stackHeight,
                // Left and right margins are per block (their section's), see sectionMargins in the pagination.
                padding: `${geometry.insetTop}px 0 ${geometries[geometries.length - 1].insetBottom}px 0`,
                "--doc-font": state.prefs.fontFamily,
                "--doc-size": `${state.prefs.fontSizePt}pt`,
              } as React.CSSProperties
            }
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY });
            }}
          >
            <EditorContent editor={editor} />
          </div>
        </div>
        </div>
      </div>
      {menu && <ContextMenu at={menu} items={menuItems} onClose={() => setMenu(null)} />}
    </div>
  );
}
