import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

export const MIN_ROW_PX = 18;
export const MAX_ROW_PX = 1500;
const NEAR = 4; // px from the bottom border of a row
const COLUMN_EDGE = 7; // near a column border the column handle wins

export const cleanRowHeight = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= MIN_ROW_PX && v <= MAX_ROW_PX ? Math.round(v) : null);

/** The row (and its offset in the document) whose bottom border is under the pointer. */
function rowBorderAt(view: EditorView, e: MouseEvent): { tr: HTMLTableRowElement; pos: number; bottom: number; table: HTMLTableElement } | null {
  const cell = (e.target as HTMLElement | null)?.closest?.("td, th") as HTMLTableCellElement | null;
  if (!cell || !view.dom.contains(cell)) return null;
  const r = cell.getBoundingClientRect();
  if (Math.abs(e.clientY - r.bottom) > NEAR || Math.abs(e.clientX - r.right) < COLUMN_EDGE || Math.abs(e.clientX - r.left) < COLUMN_EDGE) return null;
  const tr = cell.parentElement as HTMLTableRowElement | null;
  const table = cell.closest("table");
  if (!tr || !table) return null;
  try {
    const $pos = view.state.doc.resolve(view.posAtDOM(cell, 0));
    for (let d = $pos.depth; d > 0; d--) if ($pos.node(d).type.name === "tableRow") return { tr, pos: $pos.before(d), bottom: r.bottom, table };
  } catch {
    /* not in the document */
  }
  return null;
}

/**
 * Row height: the bottom border of a row can be dragged (the row never gets smaller than its content), double-click gives the
 * automatic height back. Stored as the `rowHeight` attribute of the row (a minimum height, written to DOCX/ODT).
 */
export const TableRowResize = Extension.create({
  name: "tableRowResize",

  addGlobalAttributes() {
    return [
      {
        types: ["tableRow"],
        attributes: {
          rowHeight: {
            default: null,
            parseHTML: (el: HTMLElement) => cleanRowHeight(parseFloat(el.getAttribute("data-row-height") ?? "")),
            renderHTML: (a: Record<string, unknown>) => {
              const h = cleanRowHeight(a.rowHeight);
              return h ? { "data-row-height": String(h), style: `height:${h}px` } : {};
            },
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("loma-row-resize"),
        view(view) {
          // The blue line showing which border is going to move lives outside the editor DOM.
          const line = document.createElement("div");
          line.setAttribute("data-row-resize-line", "");
          line.style.cssText = "position:fixed;height:3px;background:#2563eb;pointer-events:none;z-index:40;display:none;border-radius:2px";
          document.body.appendChild(line);
          (view as unknown as { _rowLine: HTMLElement })._rowLine = line;
          // Capture phase: the table plugin must not see a press on a row border.
          const onDbl = (e: MouseEvent) => {
              const hit = rowBorderAt(view, e);
              if (!hit) return;
              const node = view.state.doc.nodeAt(hit.pos);
              e.stopPropagation();
              if (!node?.attrs.rowHeight) return;
              view.dispatch(view.state.tr.setNodeMarkup(hit.pos, undefined, { ...node.attrs, rowHeight: null }));
            };
          const onDown = (e: MouseEvent) => {
              if (e.button !== 0) return;
              const hit = rowBorderAt(view, e);
              if (!hit) return;
              e.preventDefault();
              e.stopPropagation();
              const dom = view.dom as HTMLElement & { _rowDrag?: boolean };
              dom._rowDrag = true;
              const line = (view as unknown as { _rowLine: HTMLElement })._rowLine;
              const stack = view.dom.closest<HTMLElement>(".page-stack");
              const scale = stack ? stack.getBoundingClientRect().width / stack.offsetWidth || 1 : 1;
              const startY = e.clientY;
              const startH = hit.tr.getBoundingClientRect().height / scale;
              // ProseMirror reverts DOM edits it did not make, so the preview is the real attribute, updated on every move
              // (the steps are grouped in one undo event by the history plugin).
              const apply = (h: number | null) => {
                const node = view.state.doc.nodeAt(hit.pos);
                if (node?.type.name === "tableRow") view.dispatch(view.state.tr.setNodeMarkup(hit.pos, undefined, { ...node.attrs, rowHeight: h }));
              };
              const rowEl = () => (view.nodeDOM(hit.pos) as HTMLTableRowElement | null) ?? hit.tr;
              const showLine = () => {
                const t = hit.table.getBoundingClientRect();
                Object.assign(line.style, { display: "block", left: `${t.left}px`, width: `${t.width}px`, top: `${rowEl().getBoundingClientRect().bottom - 1.5}px` });
              };
              const move = (ev: MouseEvent) => {
                apply(cleanRowHeight(Math.round(Math.min(MAX_ROW_PX, Math.max(MIN_ROW_PX, startH + (ev.clientY - startY) / scale)))));
                showLine();
              };
              const up = () => {
                window.removeEventListener("mousemove", move);
                window.removeEventListener("mouseup", up);
                dom._rowDrag = false;
                line.style.display = "none";
                // The row cannot be shorter than its content: keep the height it really has.
                const actual = rowEl().getBoundingClientRect().height / scale;
                const node = view.state.doc.nodeAt(hit.pos);
                if (node?.attrs.rowHeight && Math.abs(actual - Number(node.attrs.rowHeight)) > 1) apply(cleanRowHeight(Math.round(actual)));
                else if (Math.abs(actual - startH) <= 1) apply(null);
              };
              window.addEventListener("mousemove", move);
              window.addEventListener("mouseup", up);
              return;
            };
          view.dom.addEventListener("dblclick", onDbl, true);
          view.dom.addEventListener("mousedown", onDown, true);
          return { destroy: () => { line.remove(); view.dom.removeEventListener("dblclick", onDbl, true); view.dom.removeEventListener("mousedown", onDown, true); } };
        },
        props: {
          handleDOMEvents: {
            mousemove(view, e) {
              const line = (view as unknown as { _rowLine?: HTMLElement })._rowLine;
              if (!line || (view.dom as HTMLElement & { _rowDrag?: boolean })._rowDrag) return false;
              const hit = rowBorderAt(view, e);
              view.dom.classList.toggle("row-resize-cursor", !!hit);
              if (hit) {
                const t = hit.table.getBoundingClientRect();
                Object.assign(line.style, { display: "block", left: `${t.left}px`, width: `${t.width}px`, top: `${hit.bottom - 1.5}px` });
              } else line.style.display = "none";
              return false;
            },
            mouseleave(view) {
              const line = (view as unknown as { _rowLine?: HTMLElement })._rowLine;
              if (line) line.style.display = "none";
              view.dom.classList.remove("row-resize-cursor");
              return false;
            },
          },
        },
      }),
    ];
  },
});
