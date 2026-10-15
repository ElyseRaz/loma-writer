import type { EditorView } from "@tiptap/pm/view";
import type { Atom, AtomKind, LineBox } from "./model";

/** Link between an engine atom and the editor, needed to place the spacer decorations. */
export interface AtomRef {
  kind: AtomKind;
  /** Document position just before the node. */
  pos: number;
  el: HTMLElement;
  /** Table rows: number of grid columns, for the spacer row. */
  columns: number;
  /** Table rows below header rows: the header rows to repeat after a page break. */
  headers: HTMLTableRowElement[];
  /** Column sections: extra left offset (px) of a list item inside its list, to keep its bullet where it was. */
  indent?: number;
  /** Column sections: the unit is a child of a list or a quote (those containers are laid out by their items). */
  inContainer?: "list" | "quote";
  /** Filled by `lines()` for text atoms: document position of the first character of each line. */
  lineStarts: number[];
}

const TEXT_BLOCKS = new Set(["paragraph", "heading", "codeBlock"]);

export interface Measured {
  atoms: Atom[];
  refs: AtomRef[];
}

/**
 * Measures the natural layout (page-break spacers hidden by the caller) as atoms.
 * `origin` is the top of the content flow in client px and `scale` the current zoom.
 */
export function collectAtoms(view: EditorView, origin: number, scale: number, columnSections: boolean[] = []): Measured {
  const atoms: Atom[] = [];
  const refs: AtomRef[] = [];

  let sectionCounter = 0;
  const doc = view.state.doc;
  view.state.doc.descendants((node, pos, parent) => {
    const name = node.type.name;
    let kind: AtomKind | null = null;
    // In a section with several columns the atoms are the top-level blocks (lists, tables… are placed whole).
    const columnsHere = !!columnSections[sectionCounter];
    const inColumns = parent === doc && name !== "sectionBreak" && columnsHere;
    // Lists and quotes of a column section are cut into their items / paragraphs, each placed on its own.
    const container: "list" | "quote" | null = parent === doc && columnsHere ? (name === "bulletList" || name === "orderedList" ? "list" : name === "blockquote" ? "quote" : null) : null;
    if (container) return true;
    const outer = parent && parent !== doc && columnsHere && doc.resolve(pos).depth === 1 ? (parent.type.name === "blockquote" ? "quote" : parent.type.name === "bulletList" || parent.type.name === "orderedList" ? "list" : null) : null;
    if (name === "sectionBreak") kind = "section";
    if (outer) kind = outer === "list" ? "block" : TEXT_BLOCKS.has(name) ? "text" : "block";
    else if (inColumns) kind = TEXT_BLOCKS.has(name) ? "text" : name === "pageBreak" ? "break" : name === "columnBreak" ? "colbreak" : "block";
    else if (TEXT_BLOCKS.has(name)) kind = "text";
    else if (name === "tableRow") kind = "row";
    else if (name === "horizontalRule") kind = "block";
    else if (name === "pageBreak" || name === "columnBreak") kind = "break";
    else if (name === "shape" || name === "shapeGroup") kind = "block"; // drawn as a whole, never split across pages
    if (!kind) return true; // containers: lists, quotes, tables
    let el = view.nodeDOM(pos);
    // Shapes: the anchor sits in the text flow, the box is what takes room (wrapped shapes use display:contents).
    if (el instanceof HTMLElement && el.classList.contains("shape-anchor") && el.dataset.wrap !== "front" && el.dataset.wrap !== "behind") el = el.querySelector<HTMLElement>(":scope > .shape-box") ?? el;
    if (el instanceof HTMLElement) {
      const r = el.getBoundingClientRect();
      const ref: AtomRef = { kind, pos, el, columns: 1, headers: [], lineStarts: [] };
      if (outer) {
        ref.inContainer = outer;
        // A list item keeps the indent of its list (the list itself is not drawn any more): measured while the list is in the flow.
        if (outer === "list" && el.parentElement) ref.indent = parseFloat(getComputedStyle(el.parentElement).paddingLeft) || 0;
      }
      const atom: Atom = { kind, ...(kind === "section" ? { section: ++sectionCounter, ...(node.attrs.kind === "continuous" ? { continuous: true } : {}) } : {}), top: (r.top - origin) / scale, bottom: (r.bottom - origin) / scale, keepWithNext: name === "heading" || (kind === "text" && !!node.attrs.keepWithNext), ...(kind === "text" && node.attrs.pageBreakBefore ? { breakBefore: true } : {}), ...(kind === "text" && node.attrs.keepLines ? { keepLines: true } : {}) };
      if (kind === "row") ref.columns = Array.from((el as HTMLTableRowElement).cells ?? []).reduce((s, c) => s + (c.colSpan || 1), 0) || 1;
      if (kind === "row") {
        const headers = headerRowsAbove(el as HTMLTableRowElement);
        if (headers.length) {
          const height = headers.reduce((s, h) => s + h.getBoundingClientRect().height, 0) / scale;
          if (height > 0 && height < 300) { atom.repeat = height; ref.headers = headers; }
        }
      }
      if (kind === "text") {
        let cache: LineBox[] | null = null;
        atom.lines = () => (cache ??= measureLines(view, ref, origin, scale));
      }
      atoms.push(atom);
      refs.push(ref);
    }
    return false;
  });
  return { atoms, refs };
}

/** Leading rows made only of header cells, when `row` is not one of them. */
function headerRowsAbove(row: HTMLTableRowElement): HTMLTableRowElement[] {
  const table = row.closest("table");
  if (!table || Array.from(row.cells).every((c) => c.tagName === "TH")) return [];
  const headers: HTMLTableRowElement[] = [];
  for (const r of Array.from(table.rows)) {
    if (r.classList.contains("pg-spacer")) continue; // earlier page breaks (hidden while measuring)
    if (r === row || !r.cells.length || !Array.from(r.cells).every((c) => c.tagName === "TH")) break;
    headers.push(r);
  }
  return headers;
}

/**
 * Line boxes of a text block, from the rectangles of its characters. Also records where each line starts
 * in the document so a page break can be inserted there.
 */
function measureLines(view: EditorView, ref: AtomRef, origin: number, scale: number): LineBox[] {
  const centers: number[] = [];
  const heights: number[] = [];
  ref.lineStarts = [];
  const range = document.createRange();
  let last: { center: number; height: number } | null = null;

  const note = (rect: DOMRect, pos: number) => {
    const center = (rect.top + rect.bottom) / 2;
    if (!last || center - last.center > Math.min(rect.height, last.height) * 0.6) {
      centers.push(center);
      heights.push(rect.height);
      ref.lineStarts.push(pos);
    }
    last = { center, height: rect.height };
  };

  /** First character of `text` (from `from`) whose rectangle is at or below `center`; binary search, the centres never decrease. */
  const firstCharAtOrBelow = (text: Text, from: number, center: number): number => {
    let lo = from;
    let hi = text.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      range.setStart(text, mid);
      range.setEnd(text, mid + 1);
      const r = range.getClientRects()[0];
      if (!r || r.width === 0 || (r.top + r.bottom) / 2 >= center - 1) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  };

  const walk = (parent: Node) => {
    parent.childNodes.forEach((n, index) => {
      if (n.nodeType === 3) {
        const text = n as Text;
        if (!text.length) return;
        // One rectangle per line fragment of this text node: only the lines need locating, not every character.
        range.selectNodeContents(text);
        let from = 0;
        for (const r of Array.from(range.getClientRects())) {
          if (r.width === 0 || r.height === 0) continue;
          const center = (r.top + r.bottom) / 2;
          if (last && center - last.center <= Math.min(r.height, last.height) * 0.6) { last = { center, height: r.height }; continue; } // same line
          const offset = firstCharAtOrBelow(text, from, center);
          from = offset;
          note(r, view.posAtDOM(text, offset));
        }
      } else if (n instanceof HTMLElement && n.tagName === "IMG") note(n.getBoundingClientRect(), view.posAtDOM(parent, index));
      else if (n instanceof HTMLElement && !n.classList.contains("pg-spacer")) walk(n);
    });
  };
  walk(ref.el);

  const el = ref.el.getBoundingClientRect();
  if (centers.length === 0) return [{ top: (el.top - origin) / scale, bottom: (el.bottom - origin) / scale }];
  const lh = centers.length > 1 ? (centers[centers.length - 1] - centers[0]) / (centers.length - 1) : Math.max(heights[0], el.height);
  return centers.map((c, k) => ({
    top: k === 0 ? Math.min((el.top - origin) / scale, (c - lh / 2 - origin) / scale) : (c - lh / 2 - origin) / scale,
    bottom: k === centers.length - 1 ? Math.max((el.bottom - origin) / scale, (c + lh / 2 - origin) / scale) : (c + lh / 2 - origin) / scale,
  }));
}
