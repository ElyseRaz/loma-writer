import type { EditorView } from "@tiptap/pm/view";
import type { Atom, AtomKind, LineBox } from "./model";

/** Link between an engine atom and the editor, needed to place the spacer decorations. */
/** Inline style properties that make a block look "framed" (redrawn behind each run of its lines when they are shared between slots). */
export const FRAME_PROPS = ["background", "backgroundColor", "border", "borderTop", "borderRight", "borderBottom", "borderLeft", "borderRadius"] as const;

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
  /** Column sections: the row belongs to this table (position of the table node, top of its box in natural coordinates). */
  table?: { pos: number; top: number; first: boolean; width: number };
  /** Filled by `lines()` for text atoms: document position of the first character of each line. */
  lineStarts: number[];
  /** Units made of several text blocks (list item, table row): where each block starts its lines (index = line of the merged list). */
  flows?: Array<{
    end: number;
    starts: Array<number | undefined>;
    /** Vertical extent (natural coordinates) of the lines of this block, by merged line index. */
    extent: Array<{ top: number; bottom: number } | undefined>;
    /** A block with a background or a border: where it sits in the unit and what it looks like. */
    look?: { left: number; width: number; css: string };
  }>;
  /** Column sections, table rows: each cell's place in the row and its look, to redraw the cell frames when the row is shared over several slots. */
  cells?: Array<{ left: number; width: number; bg: string; border: string }>;
  /** Column sections, a row with a cell spanning several rows: positions of the rows it covers (they move with it, as one block). */
  groupRows?: number[];
  /** Column sections, list items holding a table: its cells (natural place, relative to the item's left edge, and look). */
  tdBoxes?: Array<{ left: number; width: number; top: number; bottom: number; bg: string; border: string }>;
}

const TEXT_BLOCKS = new Set(["paragraph", "heading", "codeBlock", "tocEntry", "endnoteItem", "bibEntry"]);

export interface Measured {
  atoms: Atom[];
  refs: AtomRef[];
}

/**
 * Measures the natural layout (page-break spacers hidden by the caller) as atoms.
 * `origin` is the top of the content flow in client px and `scale` the current zoom.
 */
export function collectAtoms(view: EditorView, origin: number, scale: number, columnSections: boolean[] = [], noteHeight?: (note: Record<string, unknown>, section: number) => number): Measured {
  const atoms: Atom[] = [];
  const refs: AtomRef[] = [];

  let sectionCounter = 0;
  let tableOf: { pos: number; top: number; rows: number; width: number } | null = null;
  let coveredRows = 0; // rows still to skip: a cell with a rowspan holds them to the row that starts it
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
    if (name === "tableRow" && coveredRows > 0 && columnsHere) { coveredRows--; return false; }
    if (name === "table" && parent === doc && columnsHere) { tableOf = { pos, top: NaN, rows: 0, width: 0 }; return true; } // its rows are placed one by one
    const outer = parent && parent !== doc && columnsHere && doc.resolve(pos).depth === 1 ? (parent.type.name === "blockquote" ? "quote" : parent.type.name === "bulletList" || parent.type.name === "orderedList" ? "list" : null) : null;
    if (name === "sectionBreak") kind = "section";
    if (outer) kind = outer === "list" || TEXT_BLOCKS.has(name) ? "text" : "block";
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
      if (name === "tableRow" && columnsHere && tableOf && pos > tableOf.pos) {
        if (Number.isNaN(tableOf.top)) { const t = view.nodeDOM(tableOf.pos); const tr = t instanceof HTMLElement ? t.querySelector("table")?.getBoundingClientRect() ?? t.getBoundingClientRect() : r; tableOf.top = (tr.top - origin) / scale; tableOf.width = tr.width / scale; }
        ref.table = { pos: tableOf.pos, top: tableOf.top, first: tableOf.rows++ === 0, width: tableOf.width };
      }
      if (outer) {
        ref.inContainer = outer;
        // A list item keeps the indent of its list (the list itself is not drawn any more): measured while the list is in the flow.
        if (outer === "list") {
          const li = el.getBoundingClientRect();
          const cellsIn = Array.from(el.querySelectorAll<HTMLElement>("td, th"));
          if (cellsIn.length) ref.tdBoxes = cellsIn.map((c) => { const r = c.getBoundingClientRect(); return { ...cellLook(c, li.left, scale), top: (r.top - origin) / scale, bottom: (r.bottom - origin) / scale }; });
        }
        if (outer === "list" && el.parentElement) ref.indent = parseFloat(getComputedStyle(el.parentElement).paddingLeft) || 0;
      }
      const atom: Atom = { kind, ...(kind === "section" ? { section: ++sectionCounter, ...(node.attrs.kind === "continuous" ? { continuous: true } : {}) } : {}), top: (r.top - origin) / scale, bottom: (r.bottom - origin) / scale, keepWithNext: name === "heading" || (kind === "text" && !!node.attrs.keepWithNext), ...(kind === "text" && node.attrs.pageBreakBefore ? { breakBefore: true } : {}), ...(kind === "text" && node.attrs.keepLines ? { keepLines: true } : {}) };
      if (ref.table) atom.tableId = ref.table.pos;
      if (kind === "row" && columnsHere) {
        const cells = Array.from((el as HTMLTableRowElement).cells ?? []);
        const left0 = cells[0]?.getBoundingClientRect().left ?? 0;
        ref.cells = cells.map((c) => cellLook(c, left0, scale));
      }
      if (kind === "row" && columnsHere) {
        // A cell spanning several rows ties them together: the group is laid out as one block (one atom as tall as all of them).
        const span = Math.max(1, ...Array.from((el as HTMLTableRowElement).cells ?? []).map((c) => c.rowSpan || 1));
        if (span > 1) {
          const covered: HTMLTableRowElement[] = [];
          for (let n = el.nextElementSibling; n && covered.length < span - 1; n = n.nextElementSibling) if (n instanceof HTMLTableRowElement && !n.classList.contains("pg-spacer")) covered.push(n);
          if (covered.length) {
            coveredRows = covered.length;
            ref.groupRows = covered.map((tr) => view.posAtDOM(tr, 0) - 1);
            atom.bottom = Math.max(atom.bottom, (covered[covered.length - 1].getBoundingClientRect().bottom - origin) / scale);
          }
        }
      }
      if (kind === "row") ref.columns = Array.from((el as HTMLTableRowElement).cells ?? []).reduce((s, c) => s + (c.colSpan || 1), 0) || 1;
      if (kind === "row") {
        const headers = headerRowsAbove(el as HTMLTableRowElement);
        if (headers.length) {
          const height = headers.reduce((s, h) => s + h.getBoundingClientRect().height, 0) / scale;
          if (height > 0 && (height < 300 || columnsHere)) { atom.repeat = height; ref.headers = headers; } // in columns the engine caps it by the column height
        }
      }
      // Text: its line boxes (lazy). A list item or a table row of a column section is a unit of several text blocks: lines at the same
      // height, in different blocks, count as one line.
      const multi = outer === "list" || (kind === "row" && columnsHere);
      if (kind === "text" || (kind === "row" && columnsHere && !ref.groupRows)) {
        let cache: LineBox[] | null = null;
        atom.lines = () => (cache ??= multi ? measureFlows(view, ref, origin, scale) : measureLines(view, ref, origin, scale));
      }
      // Footnotes anchored in the atom take room at the bottom of the page its line is on.
      const anchors: Array<{ pos: number; h: number }> = [];
      if (noteHeight && kind !== "section" && kind !== "break") node.descendants((child, off) => {
        if (child.type.name === "footnote" && child.attrs.kind === "foot") anchors.push({ pos: pos + 1 + off, h: noteHeight(child.attrs, sectionCounter) });
        return true;
      });
      if (anchors.length) {
        if (atom.lines) {
          const heights = () => {
            const lines = atom.lines!();
            const starts = ref.lineStarts;
            const out = new Array<number>(lines.length).fill(0);
            for (const a of anchors) {
              let at = 0;
              for (let k = 0; k < starts.length && k < lines.length; k++) if (starts[k] <= a.pos) at = k;
              out[at] += a.h;
            }
            return out;
          };
          atom.noteHeights = heights;
        } else atom.noteTotal = anchors.reduce((s, a) => s + a.h, 0);
      }
      atoms.push(atom);
      refs.push(ref);
    }
    return false;
  });
  return { atoms, refs };
}

/** A table cell's place (from `left0`) and look: background and border, as the browser computed them. */
function cellLook(c: HTMLElement, left0: number, scale: number): { left: number; width: number; bg: string; border: string } {
  const cs = getComputedStyle(c);
  const r = c.getBoundingClientRect();
  const bw = parseFloat(cs.borderRightWidth) || parseFloat(cs.borderBottomWidth) || 0;
  return { left: (r.left - left0) / scale, width: r.width / scale, bg: cs.backgroundColor, border: bw > 0 ? `${bw}px solid ${cs.borderRightWidth !== "0px" ? cs.borderRightColor : cs.borderBottomColor}` : "" };
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

/** Lines of a unit of several text blocks (see `AtomRef.flows`): block by block, then merged by height. */
function measureFlows(view: EditorView, ref: AtomRef, origin: number, scale: number): LineBox[] {
  const els = Array.from(ref.el.querySelectorAll<HTMLElement>("p, h1, h2, h3, pre")).filter((e) => !e.closest(".pg-spacer"));
  const entries: Array<{ top: number; bottom: number; start: number; flow: number }> = [];
  const ends: number[] = [];
  els.forEach((el, flow) => {
    const sub: AtomRef = { ...ref, el, lineStarts: [] };
    const boxes = measureLines(view, sub, origin, scale);
    ends.push(view.posAtDOM(el, el.childNodes.length));
    sub.lineStarts.forEach((start, i) => entries.push({ top: boxes[i].top, bottom: boxes[i].bottom, start, flow }));
  });
  entries.sort((a, b) => a.top - b.top || a.flow - b.flow);
  const groups: Array<{ top: number; bottom: number; members: typeof entries }> = [];
  for (const e of entries) {
    const g = groups[groups.length - 1];
    const h = e.bottom - e.top;
    if (g && (e.top + e.bottom) / 2 - (g.top + g.bottom) / 2 <= Math.min(h, g.bottom - g.top) * 0.6) { g.top = Math.min(g.top, e.top); g.bottom = Math.max(g.bottom, e.bottom); g.members.push(e); }
    else groups.push({ top: e.top, bottom: e.bottom, members: [e] });
  }
  const box = ref.el.getBoundingClientRect();
  const top = (box.top - origin) / scale;
  const bottom = (box.bottom - origin) / scale;
  ref.flows = ends.map((end, f) => {
    const el = els[f];
    const st = el.style;
    const css = FRAME_PROPS.filter((k) => st[k]).map((k) => `${k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}:${st[k]}`).join(";");
    const r = el.getBoundingClientRect();
    return { end, starts: new Array<number | undefined>(groups.length).fill(undefined), extent: new Array<{ top: number; bottom: number } | undefined>(groups.length).fill(undefined), ...(css ? { look: { left: (r.left - box.left) / scale, width: r.width / scale, css } } : {}) };
  });
  groups.forEach((g, i) => g.members.forEach((m) => {
    const fl = ref.flows![m.flow];
    if (fl.starts[i] === undefined) fl.starts[i] = m.start;
    fl.extent[i] = { top: Math.min(fl.extent[i]?.top ?? Infinity, m.top), bottom: Math.max(fl.extent[i]?.bottom ?? -Infinity, m.bottom) };
  }));
  ref.lineStarts = groups.map((g) => g.members[0].start);
  if (!groups.length) return [{ top, bottom }];
  return groups.map((g, i) => ({ top: i === 0 ? Math.min(top, g.top) : g.top, bottom: i === groups.length - 1 ? Math.max(bottom, g.bottom) : groups[i + 1].top }));
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
