import { cmToPx, marginsPx, pageDimensions } from "../state/page";
import type { PageSetup } from "../state/types";

/** Logical gap between two pages on screen (CSS px). It is removed when printing. */
export const PAGE_GAP = 24;

/**
 * Logical geometry of a page, in CSS px at 96 dpi. Everything the pagination needs, independent of
 * zoom and of the DOM.
 */
export interface PageGeometry {
  width: number;
  height: number;
  /** Space above the content area, including any header that is taller than the top margin. */
  insetTop: number;
  insetBottom: number;
  insetLeft: number;
  insetRight: number;
  gap: number;
  /** Height of the content area of one page. */
  contentHeight: number;
  /** Distance between the tops of two consecutive pages. */
  pitch: number;
  /** Equal-width text columns (px), when the section has more than one. */
  columns?: { count: number; gap: number; line: boolean };
}

export function pageGeometry(page: PageSetup, header = 0, footer = 0, gap = PAGE_GAP): PageGeometry {
  const { w, h } = pageDimensions(page);
  const m = marginsPx(page);
  const insetTop = Math.max(m.top, header);
  const insetBottom = Math.max(m.bottom, footer);
  const contentHeight = Math.max(48, h - insetTop - insetBottom);
  const c = page.columns && page.columns.count >= 2 ? { count: page.columns.count, gap: cmToPx(page.columns.gapCm), line: page.columns.line } : undefined;
  return { width: w, height: h, insetTop, insetBottom, insetLeft: m.left, insetRight: m.right, gap, contentHeight, pitch: h + gap, ...(c ? { columns: c } : {}) };
}

/** One unit the engine lays out: a text block, a table row, a rule or a manual page break. */
export type AtomKind = "text" | "row" | "block" | "break" | "colbreak" | "section";

export interface LineBox {
  top: number;
  bottom: number;
}

export interface Atom {
  kind: AtomKind;
  /** Natural (unpaginated) vertical extent, relative to the top of the content area of page 1. */
  top: number;
  bottom: number;
  /** Headings and paragraphs set to "keep with next": must not be the last thing on a page. */
  keepWithNext?: boolean;
  /** Starts a new page (paragraph option "Saut de page avant"). */
  breakBefore?: boolean;
  /** Never split across two pages (paragraph option "Lignes solidaires"). */
  keepLines?: boolean;
  /** Table rows below a header row: height of the header rows repeated on top of a page this row starts. */
  repeat?: number;
  /** Column sections: the table (position of its node) a row belongs to. */
  tableId?: number;
  /** Section breaks: index of the section that starts after this atom. */
  section?: number;
  /** Section breaks: the next section continues on the same page (it can only change the columns). */
  continuous?: boolean;
  /** Text only: the height of the footnotes anchored in each line (aligned with `lines()`); they take room at the bottom of the page. */
  noteHeights?: () => number[];
  /** Other atoms (table rows, blocks): the height of all the footnotes anchored in them. */
  noteTotal?: number;
  /** Text only: measures the line boxes (natural coordinates). Called lazily, only for atoms crossing a page end. */
  lines?: () => LineBox[];
}

/** A vertical space inserted before an atom, or before one of its lines, to start a new page. */
export interface PageBreak {
  atom: number;
  /** Index of the first line moved to the new page; null when the whole atom moves. */
  line: number | null;
  /** Height of the space, from the current position to the top of the next page's content area. */
  spacer: number;
  /** Part of `spacer` taken by repeated table header rows (the rest is the gap). */
  repeat?: number;
  /** What this break really adds to the layout below it, when that differs from the height of the spacer (columns). */
  net?: number;
  /** A column region: the spacer stands in for the blocks of the region, which are drawn out of the flow. */
  region?: { margin: number; pages: number };
}

/** A run of lines of a text block placed in one column slot. */
export interface Fragment {
  /** First line and line after the last one (indices into the atom's lines). */
  from: number;
  to: number;
  page: number;
  x: number;
  /** First fragment: top of the block. The others: where the top of their first line goes. */
  y: number;
}

/** Where a block of a column region goes (engine coordinates; `x` is from the left of the text area). */
export interface Placement {
  page: number;
  x: number;
  y: number;
  width: number;
  /** The lines of the block are shared between several slots (columns, pages): the view moves each run of lines where it belongs. */
  frags?: Fragment[];
  /** Table row that continues a table at the top of a column: height kept above it for the repeated header rows. */
  header?: number;
}

/** A vertical rule between the columns of one page. */
export interface Band {
  page: number;
  top: number;
  height: number;
  count: number;
  gap: number;
  width: number;
  left: number;
}

/** One page sheet, in engine coordinates (0 = top of the text area of page 0). */
export interface Sheet {
  top: number;
  /** Offset from the left of the stack (sheets narrower than the widest one are centred). */
  left: number;
  width: number;
  height: number;
  insetTop: number;
  insetBottom: number;
  insetLeft: number;
  insetRight: number;
  /** Section the page belongs to, and its index inside it (0 = first page of the section). */
  section: number;
  indexInSection: number;
}

/** Height kept at the bottom of a page, above the first footnote: the separator rule and its spacing. */
export const FOOTNOTE_SEPARATOR = 14;

export interface PaginationResult {
  breaks: PageBreak[];
  /** Height reserved at the bottom of each page for its footnotes (separator included), by page index. */
  reserved: number[];
  pages: number;
  /** Page index (0-based) where each atom starts. */
  startPage: number[];
  /** Atoms taller than a whole page: they overflow instead of being cut. */
  oversize: number[];
  sheets: Sheet[];
  /** One entry per atom: its column slot when it belongs to a multi-column section, else null. */
  placements: Array<Placement | null>;
  /** Rules between columns, per page. */
  bands: Band[];
}
