import { marginsPx, pageDimensions, type PageSetup } from "../state/types";

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
}

export function pageGeometry(page: PageSetup, header = 0, footer = 0, gap = PAGE_GAP): PageGeometry {
  const { w, h } = pageDimensions(page);
  const m = marginsPx(page);
  const insetTop = Math.max(m.top, header);
  const insetBottom = Math.max(m.bottom, footer);
  const contentHeight = Math.max(48, h - insetTop - insetBottom);
  return { width: w, height: h, insetTop, insetBottom, insetLeft: m.left, insetRight: m.right, gap, contentHeight, pitch: h + gap };
}

/** One unit the engine lays out: a text block, a table row, a rule or a manual page break. */
export type AtomKind = "text" | "row" | "block" | "break" | "section";

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
  /** Section breaks: index of the section that starts after this atom. */
  section?: number;
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

export interface PaginationResult {
  breaks: PageBreak[];
  pages: number;
  /** Page index (0-based) where each atom starts. */
  startPage: number[];
  /** Atoms taller than a whole page: they overflow instead of being cut. */
  oversize: number[];
  sheets: Sheet[];
}
