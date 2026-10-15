import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";

interface Handle {
  kind: "column" | "row";
  /** Screen position of the blue line (x for a column, y for a row) and its extent. */
  at: number;
  from: number;
  to: number;
  /** Index of the border (0 = before the first column / row). */
  index: number;
  table: HTMLTableElement;
}

const NEAR = 10; // px from a border
const OUT = 18; // px outside the table where the handle is offered

const rowsOf = (t: HTMLTableElement) => Array.from(t.rows).filter((r) => !r.classList.contains("pg-spacer"));

/** The border of `t` under the pointer, if the pointer is in the strip above (columns) or left (rows) of the table. */
function find(t: HTMLTableElement, x: number, y: number): Handle | null {
  const r = t.getBoundingClientRect();
  const rows = rowsOf(t);
  if (!rows.length) return null;
  if (y >= r.top - OUT && y <= r.top + 8 && x >= r.left - NEAR && x <= r.right + NEAR) {
    const cells = Array.from(rows[0].cells);
    const edges = [cells[0]?.getBoundingClientRect().left ?? r.left, ...cells.map((c) => c.getBoundingClientRect().right)];
    const index = edges.findIndex((e) => Math.abs(e - x) <= NEAR);
    if (index >= 0) return { kind: "column", at: edges[index], from: r.top, to: r.bottom, index, table: t };
  }
  if (x >= r.left - OUT && x <= r.left + 8 && y >= r.top - NEAR && y <= r.bottom + NEAR) {
    const edges = [rows[0].getBoundingClientRect().top, ...rows.map((row) => row.getBoundingClientRect().bottom)];
    const index = edges.findIndex((e) => Math.abs(e - y) <= NEAR);
    if (index >= 0) return { kind: "row", at: edges[index], from: r.left, to: r.right, index, table: t };
  }
  return null;
}

/**
 * Like Word: pointing at a column border (above the table) or a row border (left of it) shows a blue line with a "+";
 * clicking it inserts a column or a row there.
 */
export function TableInsertHandles({ editor }: { editor: Editor }) {
  const [handle, setHandle] = useState<Handle | null>(null);
  const frame = useRef(0);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("[data-table-insert]")) return; // keep it while the pointer is on it
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        if (editor.isDestroyed || !editor.isEditable) return setHandle(null);
        let found: Handle | null = null;
        for (const t of Array.from(editor.view.dom.querySelectorAll<HTMLTableElement>("table"))) {
          found = find(t, e.clientX, e.clientY);
          if (found) break;
        }
        setHandle((prev) => (prev && found && prev.kind === found.kind && prev.index === found.index && prev.table === found.table && Math.abs(prev.at - found.at) < 1 ? prev : found));
      });
    };
    const hide = () => setHandle(null);
    document.addEventListener("mousemove", move);
    document.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
      cancelAnimationFrame(frame.current);
    };
  }, [editor]);

  if (!handle) return null;
  const insert = () => {
    const rows = rowsOf(handle.table);
    const cellAt = (i: number) => (handle.kind === "column" ? rows[0].cells[Math.max(0, i)] : rows[Math.max(0, i)].cells[0]);
    const before = handle.index === 0;
    const cell = cellAt(before ? 0 : handle.index - 1);
    if (!cell) return;
    const pos = editor.view.posAtDOM(cell, 0);
    const chain = editor.chain().focus().setTextSelection(pos);
    (handle.kind === "column" ? (before ? chain.addColumnBefore() : chain.addColumnAfter()) : before ? chain.addRowBefore() : chain.addRowAfter()).run();
    setHandle(null);
  };
  const col = handle.kind === "column";
  const label = col ? "Insérer une colonne ici" : "Insérer une ligne ici";
  return (
    <div data-table-insert aria-hidden={false} className="pointer-events-none fixed inset-0 z-30">
      <div className="absolute bg-accent" style={col ? { left: handle.at - 1, top: handle.from, width: 2, height: handle.to - handle.from } : { left: handle.from, top: handle.at - 1, height: 2, width: handle.to - handle.from }} />
      <button
        type="button"
        data-table-insert
        title={label}
        aria-label={label}
        onMouseDown={(e) => e.preventDefault()}
        onClick={insert}
        className="pointer-events-auto absolute flex h-[18px] w-[18px] items-center justify-center rounded-full bg-accent text-white shadow hover:scale-110"
        style={col ? { left: handle.at - 9, top: handle.from - 22 } : { left: handle.from - 22, top: handle.at - 9 }}
      >
        <Plus size={12} strokeWidth={3} />
      </button>
    </div>
  );
}
