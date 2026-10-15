import { Extension } from "@tiptap/core";
import { placeInSheets, sheetIndexAt, stackSheets, type StackSheet } from "../pagination/pageLayout";
import { internalPasteWanted, markedCopyOnClipboard, pasteInternal } from "./InternalClipboard";
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, Plugin, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

const OBJECTS = new Set(["image", "shape", "shapeGroup"]);
const NUDGE = { normal: 5, big: 25, fine: 1 }; // px: arrow, Maj+arrow, Ctrl/Alt+arrow

/** Where the pointer last was over the pages, in client px (a paste goes there). */
let pointer: { x: number; y: number } | null = null;

interface Metrics {
  stack: HTMLElement;
  s: DOMRect;
  scale: number;
  sheets: StackSheet[];
}

function metrics(view: EditorView): Metrics | null {
  const stack = view.dom.closest<HTMLElement>(".page-stack");
  if (!stack || !(Number(stack.dataset.pitch) > 0)) return null;
  const s = stack.getBoundingClientRect();
  return { stack, s, scale: s.width / stack.offsetWidth || 1, sheets: stackSheets(stack) };
}

const boxOf = (view: EditorView, pos: number): HTMLElement | null => {
  const dom = view.nodeDOM(pos);
  return dom instanceof HTMLElement ? dom.querySelector<HTMLElement>(":scope > .img-box, :scope > .shape-box") ?? (dom.matches(".img-box, .shape-box") ? dom : null) : null;
};

const num = (v: unknown, d = 0) => { const n = typeof v === "string" ? parseFloat(v) : (v as number); return Number.isFinite(n) ? n : d; };
const dimsOf = (node: PMNode, box: HTMLElement | null) => ({
  w: num(node.attrs.width) || (box?.offsetWidth ?? 200),
  h: Math.max(num(node.attrs.height) || 0, box?.offsetHeight ?? 0) || 150,
});

/** The highest z of the free objects on the page + 1, so what was just placed is on top. */
function nextZ(state: EditorState): number {
  let z = -1;
  state.doc.descendants((n) => { if (OBJECTS.has(n.type.name) && n.attrs.wrap === "front") z = Math.max(z, num(n.attrs.z)); });
  return Math.min(49, z + 1);
}

/** Moves the selected picture / shape by `dx`, `dy` px; an object that is in the text becomes free where it is. */
function nudge(view: EditorView, dx: number, dy: number): boolean {
  const sel = view.state.selection;
  if (!(sel instanceof NodeSelection) || !OBJECTS.has(sel.node.type.name)) return false;
  if (view.state.doc.resolve(sel.from).parent.type.name === "shapeGroup") return false; // group children are moved inside their group
  const m = metrics(view);
  const box = boxOf(view, sel.from);
  if (!m || !box) return false;
  const a = sel.node.attrs;
  const { w, h } = dimsOf(sel.node, box);
  const free = a.wrap === "front" || a.wrap === "behind";
  const anchorRect = (view.nodeDOM(sel.from) as HTMLElement).getBoundingClientRect();
  const anchorSheet = m.sheets[sheetIndexAt(m.sheets, (anchorRect.top - m.s.top) / m.scale)];
  // Position in stack coordinates after the step, then back to the sheet it ends on.
  let ax: number, ay: number;
  if (free && a.anchor === "page") {
    ax = anchorSheet.left + num(a.x) + dx;
    ay = anchorSheet.top + num(a.y) + dy;
  } else {
    const r = box.getBoundingClientRect();
    ax = (r.left + r.width / 2 - m.s.left) / m.scale - w / 2 + dx;
    ay = (r.top + r.height / 2 - m.s.top) / m.scale - h / 2 + dy;
  }
  const placed = placeInSheets(m.sheets, ax, ay, w, h);
  const tr = view.state.tr.setNodeMarkup(sel.from, undefined, { ...a, wrap: a.wrap === "behind" ? "behind" : "front", anchor: "page", x: placed.x, y: placed.y });
  tr.setSelection(NodeSelection.create(tr.doc, sel.from));
  view.dispatch(tr);
  return true;
}

/** The only picture, shape, group or table of a pasted slice (ignoring empty paragraphs), if that is all it holds. */
export function singleObject(slice: Slice): PMNode | null {
  const found: PMNode[] = [];
  let other = false;
  slice.content.descendants((n) => {
    if (OBJECTS.has(n.type.name) || n.type.name === "table") { found.push(n); return false; }
    if (n.isText && n.text?.trim()) other = true;
    return true;
  });
  return found.length === 1 && !other ? found[0] : null;
}

/**
 * Pastes a picture, shape, group or table where the pointer is, not on the source: pictures and shapes become free (in front of the
 * text, on the page), so they stay in place whatever is pasted next; a table lands between the blocks nearest to the pointer.
 * Returns false when this is not such a paste (the editor pastes normally).
 */
export function pasteObjectAtPointer(view: EditorView, slice: Slice): boolean {
  const node = singleObject(slice);
  const m = metrics(view);
  if (!node || !m) return false;
  const p = pointer && pointer.x >= m.s.left && pointer.x <= m.s.right && pointer.y >= m.s.top && pointer.y <= m.s.bottom ? pointer : null;
  if (!p) return false;
  const px = (p.x - m.s.left) / m.scale;
  const py = (p.y - m.s.top) / m.scale;
  const doc = view.state.doc;

  if (node.type.name === "table") {
    let at = doc.content.size;
    let found = false;
    doc.forEach((n, off) => {
      if (found) return;
      const dom = view.nodeDOM(off);
      if (!(dom instanceof HTMLElement)) return;
      const r = dom.getBoundingClientRect();
      if (r.height === 0) return;
      if (p.y < (r.top + r.bottom) / 2) { at = off; found = true; }
      else at = off + n.nodeSize;
    });
    const gx = parseFloat(view.dom.style.paddingLeft) || 0;
    void gx;
    const tr = view.state.tr.insert(at, node);
    view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, at)).scrollIntoView());
    return true;
  }

  const { w, h } = dimsOf(node, null);
  const placed = placeInSheets(m.sheets, px - w / 2, Math.max(0, py - h / 2), w, h);
  const page = placed.page;
  const sheet = m.sheets[page];
  let { x, y } = placed;
  // Pasting again at the same spot must not hide the previous copy: shift until the place is free.
  const taken = (xx: number, yy: number) => {
    let hit = false;
    doc.descendants((n) => { if (OBJECTS.has(n.type.name) && n.attrs.wrap === "front" && Math.abs(num(n.attrs.x) - xx) < 4 && Math.abs(num(n.attrs.y) - yy) < 4) hit = true; });
    return hit;
  };
  for (let i = 0; i < 20 && taken(x, y); i++) { x = Math.min(x + 14, Math.max(0, sheet.width - w)); y = Math.min(y + 14, Math.max(0, sheet.height - h)); }
  const attrs = { ...node.attrs, wrap: "front", anchor: "page", x, y, z: nextZ(view.state) };
  const pasted = node.type.create(attrs, node.content, node.marks);

  // Anchor: a paragraph of the page the object lands on.
  let anchorOff = -1;
  let lastText = -1;
  doc.forEach((n, off) => {
    if (!n.isTextblock) return;
    lastText = off;
    if (anchorOff >= 0) return;
    const dom = view.nodeDOM(off);
    if (dom instanceof HTMLElement && (dom.getBoundingClientRect().top - m.s.top) / m.scale >= sheet.top - 2) anchorOff = off;
  });
  if (anchorOff < 0) anchorOff = lastText;
  const tr = view.state.tr;
  if (node.type.name === "image") {
    if (anchorOff < 0) return false;
    tr.insert(anchorOff + 1, pasted);
    anchorOff += 1;
  } else {
    const at = anchorOff >= 0 ? anchorOff : doc.content.size;
    tr.insert(at, pasted);
    anchorOff = at;
  }
  view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, anchorOff)).scrollIntoView());
  view.focus();
  return true;
}

/** Arrow keys move a selected picture or shape; the paste of an object goes where the pointer is. */
export const ObjectPlacement = Extension.create({
  name: "objectPlacement",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        view() {
          const onMove = (e: MouseEvent) => { if ((e.target as HTMLElement | null)?.closest?.(".page-stack")) pointer = { x: e.clientX, y: e.clientY }; };
          document.addEventListener("mousemove", onMove);
          return { destroy: () => document.removeEventListener("mousemove", onMove) };
        },
        props: {
          handleKeyDown(view, e) {
            if (e.ctrlKey && !e.altKey) { /* Ctrl+arrow = fine step */ }
            const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
            if (!d || e.metaKey) return false;
            const step = e.shiftKey ? NUDGE.big : e.ctrlKey || e.altKey ? NUDGE.fine : NUDGE.normal;
            if (!nudge(view, d[0] * step, d[1] * step)) return false;
            e.preventDefault();
            return true;
          },
          handlePaste(view, e, slice) { return internalPasteWanted() || markedCopyOnClipboard(e) ? pasteInternal(view, null) : pasteObjectAtPointer(view, slice); },
        },
      }),
    ];
  },
});

void Fragment;
