import { Move } from "lucide-react";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { cleanPlace } from "../../editor/TableLook";
import { sectionIndexAt } from "../../editor/Sections";

const OUT = 26; // px around the table where its move handle is offered

/** Offset in the document of the top-level table whose DOM is `el`, or null (nested tables cannot be moved). */
function topLevelTable(editor: Editor, el: HTMLTableElement): number | null {
  let found: number | null = null;
  editor.state.doc.forEach((node, offset) => {
    if (found === null && node.type.name === "table") {
      const dom = editor.view.nodeDOM(offset);
      if (dom instanceof HTMLElement && (dom === el || dom.contains(el))) found = offset;
    }
  });
  return found;
}

/** Where a dragged table would land: the document offset of the block boundary nearest to `y`, and the screen y of that boundary. */
function dropTarget(editor: Editor, y: number): { pos: number; y: number } {
  let target = { pos: editor.state.doc.content.size, y: editor.view.dom.getBoundingClientRect().bottom };
  let done = false;
  let lastBottom = editor.view.dom.getBoundingClientRect().top;
  editor.state.doc.forEach((node, offset) => {
    if (done) return;
    const dom = editor.view.nodeDOM(offset);
    if (!(dom instanceof HTMLElement)) return;
    const r = dom.getBoundingClientRect();
    if (r.height === 0) return; // floating shapes take no room
    if (y < (r.top + r.bottom) / 2) { target = { pos: offset, y: Math.min(r.top, Math.max(lastBottom, r.top - 4)) }; done = true; }
    lastBottom = r.bottom;
    if (!done) target = { pos: offset + node.nodeSize, y: r.bottom };
  });
  return target;
}

/**
 * Like Word's table handle: a small cross at the top-left corner of the table, to drag the whole table to another place
 * in the document (a line shows where it will land).
 */
export function TableMoveHandle({ editor }: { editor: Editor }) {
  const [table, setTable] = useState<HTMLTableElement | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [drop, setDrop] = useState<{ pos: number; y: number } | null>(null);
  const dragging = useRef(false);
  const frame = useRef(0);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (dragging.current) return;
      if ((e.target as HTMLElement | null)?.closest?.("[data-table-move]")) return;
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        if (editor.isDestroyed || !editor.isEditable) return setTable(null);
        let hit: HTMLTableElement | null = null;
        for (const t of Array.from(editor.view.dom.querySelectorAll<HTMLTableElement>("table"))) {
          const r = t.getBoundingClientRect();
          if (e.clientX >= r.left - OUT && e.clientX <= r.right && e.clientY >= r.top - OUT && e.clientY <= r.bottom) { hit = t; break; }
        }
        setTable(hit);
        setRect(hit ? hit.getBoundingClientRect() : null);
      });
    };
    const hide = () => { if (!dragging.current) setTable(null); };
    document.addEventListener("mousemove", move);
    document.addEventListener("scroll", hide, true);
    return () => { document.removeEventListener("mousemove", move); document.removeEventListener("scroll", hide, true); cancelAnimationFrame(frame.current); };
  }, [editor]);

  if (!table || !rect) return null;

  const start = (e: React.PointerEvent<HTMLButtonElement>) => {
    const from = topLevelTable(editor, table);
    if (from === null) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    dragging.current = true;
    // Horizontally the table follows the pointer anywhere on the page, margins included; vertically it lands between blocks.
    const stack = editor.view.dom.closest<HTMLElement>(".page-stack");
    const scale = stack ? stack.getBoundingClientRect().width / stack.offsetWidth || 1 : 1;
    const pag = (editor.storage as unknown as { pagination?: { geometry: { width: number; insetLeft: number; insetRight: number } | null; geometries?: Array<{ width: number; insetLeft: number; insetRight: number }> } }).pagination;
    // The text area of the table's own section.
    const geom = pag?.geometries?.[Math.min(sectionIndexAt(editor.state.doc, from), (pag.geometries.length || 1) - 1)] ?? pag?.geometry;
    const wrapper = table.closest<HTMLElement>(".tableWrapper") ?? table;
    const startNode = editor.state.doc.nodeAt(from);
    const base = cleanPlace(startNode?.attrs.place)?.x ?? 0;
    const width = table.getBoundingClientRect().width / scale;
    const textWidth = geom ? geom.width - geom.insetLeft - geom.insetRight : width;
    const minX = geom ? -(geom.insetLeft - 8) : -Infinity;
    const maxX = geom ? geom.width - geom.insetLeft - width - 8 : Infinity;
    const startX = e.clientX;
    let x = base;
    let last = dropTarget(editor, e.clientY);
    setDrop(last);
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      moved = moved || Math.abs(ev.clientX - startX) > 3 || Math.abs(ev.clientY - e.clientY) > 3;
      x = Math.round(Math.min(maxX, Math.max(minX, base + (ev.clientX - startX) / scale)));
      wrapper.style.transform = `translateX(${x - base}px)`;
      last = dropTarget(editor, ev.clientY);
      setDrop(last);
    };
    const end = (ev: PointerEvent) => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      dragging.current = false;
      wrapper.style.transform = "";
      setDrop(null);
      if (ev.type === "pointercancel") return;
      if (!moved) { // a plain click selects the whole table (and keeps the handle for a double-click)
        editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, from)));
        editor.view.focus();
        return;
      }
      setTable(null);
      const found = editor.state.doc.nodeAt(from);
      if (!found || found.type.name !== "table") return;
      // Back in the text column (same left edge and width as the text) means "not placed".
      const snapped = Math.abs(x) < 12 && Math.abs(width - textWidth) < 12;
      const node = found.type.create({ ...found.attrs, place: snapped ? null : { x, w: Math.round(width) } }, found.content, found.marks);
      const size = found.nodeSize;
      let pos = last.pos;
      const stays = pos >= from && pos <= from + size; // dropped on itself: only the horizontal position changes
      if (stays) pos = from;
      else if (pos > from) pos -= size;
      const tr = editor.state.tr;
      if (stays) tr.replaceWith(from, from + size, node);
      else tr.delete(from, from + size).insert(pos, node);
      tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos + 3, tr.doc.content.size)), 1));
      editor.view.dispatch(tr.scrollIntoView());
      editor.commands.focus();
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };

  const reset = () => {
    const from = topLevelTable(editor, table);
    const node = from === null ? null : editor.state.doc.nodeAt(from);
    if (from === null || !node?.attrs.place) return;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(from, undefined, { ...node.attrs, place: null }));
  };
  const view = editor.view.dom.getBoundingClientRect();
  return (
    <div className="pointer-events-none fixed inset-0 z-30">
      <button
        type="button"
        data-table-move
        title="Sélectionner le tableau (clic) ou le déplacer : glisser n'importe où, marges comprises (double-clic : le remettre dans le texte)"
        aria-label="Déplacer le tableau"
        onMouseDown={(e) => e.preventDefault()}
        onPointerDown={start}
        onDoubleClick={reset}
        className="pointer-events-auto absolute flex h-[18px] w-[18px] cursor-grab touch-none items-center justify-center rounded-sm border border-line bg-surface text-fg shadow active:cursor-grabbing"
        style={{ left: rect.left - 22, top: rect.top - 22 }}
      >
        <Move size={12} />
      </button>
      {drop && <div className="absolute h-[3px] rounded bg-accent" style={{ left: view.left, width: view.width, top: drop.y - 1 }} data-table-drop />}
    </div>
  );
}
