import { EditorContent } from "@tiptap/react";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import { useEffect, useMemo, useRef, useState } from "react";
import { applyFormat } from "../../editor/formatPainter";
import { useCommandMap } from "../../editor/commands";
import { useLomaEditor } from "../../editor/EditorProvider";
import { useEditorSnapshot } from "../../editor/useEditorSnapshot";
import { hasContent, reserveFor, sectionFor } from "../../pagination/headerFooter";
import { pageGeometry } from "../../pagination/model";
import { requestPagination, setPaginationInputs } from "../../pagination/extension";
import { usePageInfo } from "../../pagination/usePagination";
import { stylesCss } from "../../editor/docStyles";
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

  // Pagination works on logical page geometry; zoom only scales the rendering.
  const section = useMemo(() => sectionFor(state.page, state.headerFooter), [state.page, state.headerFooter]);
  // The room reserved for a header/footer follows its measured height (one line until measured).
  const [hf, setHf] = useState<HeaderFooterHeights>({ header: 20, footer: 20 });
  const geometry = useMemo(
    () => pageGeometry(state.page, hasContent(state.headerFooter.header) ? reserveFor(hf.header) : 0, hasContent(state.headerFooter.footer) ? reserveFor(hf.footer) : 0),
    [state.page, state.headerFooter, hf.header, hf.footer],
  );
  const scale = state.zoom / 100;
  const { total } = usePageInfo(editor, geometry.pitch);

  useEffect(() => {
    if (editor) setPaginationInputs(editor, geometry, scale);
  }, [editor, geometry, scale]);

  // The editor is hidden behind the backstage: measure again as soon as it is visible.
  useEffect(() => {
    if (editor && state.view === "editor") requestAnimationFrame(() => requestPagination(editor));
  }, [editor, state.view, state.docRevision]);

  // Print uses the same page size as the document.
  useEffect(() => {
    let style = document.getElementById("loma-print-page") as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = "loma-print-page";
      document.head.appendChild(style);
    }
    style.textContent = `@page { size: ${geometry.width}px ${geometry.height}px; margin: 0; }`;
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

  const stackHeight = total * geometry.pitch - geometry.gap;

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
      {state.ruler && <Ruler pageWidth={geometry.width} marginLeft={geometry.insetLeft} marginRight={geometry.insetRight} zoom={state.zoom} />}
      {editor && snap.inTable && <TableToolbar editor={editor} />}
      {editor && <TableInsertHandles editor={editor} />}
      {editor && <TableMoveHandle editor={editor} />}
      {editor && <ImageToolbar editor={editor} />}
      <DocStylesCss />
      {editor && <ShapeToolbar editor={editor} />}
      <div className="flex w-max min-w-full justify-center px-8 py-6">
        <div className="page-wrap relative shrink-0" style={{ width: geometry.width * scale, height: Math.max(stackHeight, contentHeight) * scale }}>
        <div ref={stackRef} className="page-stack absolute left-0 top-0 origin-top-left" style={{ width: geometry.width, minHeight: stackHeight, transform: `scale(${scale})`, ["--doc-font" as string]: state.prefs.fontFamily, ["--doc-size" as string]: `${state.prefs.fontSizePt}pt` }} data-pages={total} data-pitch={geometry.pitch} data-inset-left={geometry.insetLeft} data-inset-top={geometry.insetTop}>
          <PageSheets bounds={state.textBounds} pages={total} geometry={geometry} section={section} onHeights={(h) => setHf((cur) => (cur.header === h.header && cur.footer === h.footer ? cur : h))} />
          <div
            className={`paper relative${state.marks ? " show-marks" : ""}${state.bookmarks ? "" : " hide-bookmarks"}${painter ? " painter-armed" : ""}`}
            onMouseUp={onMouseUp}
            style={
              {
                width: geometry.width,
                minHeight: stackHeight,
                padding: `${geometry.insetTop}px ${geometry.insetRight}px ${geometry.insetBottom}px ${geometry.insetLeft}px`,
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
