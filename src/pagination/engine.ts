import type { Atom, PageBreak, PageGeometry, PaginationResult } from "./model";

export interface EngineOptions {
  /** Minimum lines of a paragraph left at the bottom of a page. */
  orphans?: number;
  /** Minimum lines of a paragraph carried to the top of the next page. */
  widows?: number;
}

const EPS = 0.5;

/**
 * Greedy page layout over measured atoms. Pure: no DOM, no editor.
 *
 * Coordinates are "natural" (as laid out without any page break). Each decision adds a spacer that shifts
 * everything below it, tracked in `offset`. Page k owns the vertical range
 * [k * pitch, k * pitch + contentHeight] of the content flow; the rest is the margin/gap between pages.
 */
export function paginate(atoms: Atom[], geom: PageGeometry, options: EngineOptions = {}): PaginationResult {
  const orphans = options.orphans ?? 2;
  const widows = options.widows ?? 2;
  const { pitch, contentHeight: H } = geom;
  const breaks: PageBreak[] = [];
  const startPage: number[] = [];
  const oversize: number[] = [];

  let offset = 0;
  let startOffset = 0; // offset applied to the first part of the current atom
  let forcePage = -1; // next atom must start on or after this page (manual page break)
  let lastBottom = 0;
  let endsWithBreak = false;

  /** Height the atom after `i` needs to be kept with it (heading + first lines of what follows). */
  const keepExtent = (i: number): number => {
    const a = atoms[i];
    if (!a.keepWithNext || i + 1 >= atoms.length) return a.bottom - a.top;
    const n = atoms[i + 1];
    let follow = n.bottom - n.top;
    if (n.keepWithNext) follow = keepExtent(i + 1);
    else if (n.kind === "text" && n.lines) {
      const lines = n.lines();
      if (lines.length > orphans) follow = lines[orphans - 1].bottom - n.top;
    }
    return n.top - a.top + follow;
  };

  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i];
    let top = a.top + offset;
    startOffset = offset;
    const move = (delta: number, line: number | null) => {
      const repeat = a.kind === "row" && line === null ? a.repeat ?? 0 : 0; // table header rows come back on the new page
      delta += repeat;
      breaks.push({ atom: i, line, spacer: delta, ...(repeat ? { repeat } : {}) });
      offset += delta;
      startOffset += delta;
      top += delta;
    };

    if (forcePage >= 0 && top < forcePage * pitch - EPS) move(forcePage * pitch - top, null);
    forcePage = -1;

    const page0 = () => Math.max(0, Math.floor((top + EPS) / pitch));
    // An atom that starts inside the gap/margin zone after a page's content belongs to the next page.
    if (top - page0() * pitch > H - EPS && a.kind !== "break") move((page0() + 1) * pitch - top, null);
    let linesDone = 0; // lines of this atom already placed (after a split)
    let guard = 0;
    for (;;) {
      if (++guard > 10000) break; // safety net against a degenerate geometry

      // Where does the part of the atom that is still to place start and end?
      let lines = a.kind === "text" && a.lines ? a.lines() : null;
      if (lines && lines.length <= linesDone) lines = null;
      const bottom = (lines ? lines[lines.length - 1].bottom : a.bottom) + offset;
      const remainingTop = lines ? lines[linesDone].top + offset : top;
      const p = Math.max(0, Math.floor((remainingTop + EPS) / pitch));
      const limit = p * pitch + H;
      const pageTop = p * pitch;

      if (bottom <= limit + EPS) {
        // Fits. A heading still has to stay with the beginning of what follows.
        if (linesDone === 0 && a.keepWithNext && remainingTop > pageTop + EPS && remainingTop + keepExtent(i) > limit + EPS) {
          move((p + 1) * pitch - top, null);
          continue;
        }
        break;
      }

      // Does not fit. Split a paragraph by lines when both sides keep enough lines.
      if (lines && remainingTop < limit - EPS) {
        const total = lines.length;
        let fit = 0;
        for (let k = linesDone; k < total && lines[k].bottom + offset <= limit + EPS; k++) fit = k + 1;
        let first = fit; // first line that moves to the next page
        if (total - first < widows) first = total - widows;
        if (first - linesDone >= orphans && first < total) {
          const spacer = (p + 1) * pitch - (lines[first].top + offset);
          breaks.push({ atom: i, line: first, spacer });
          offset += spacer;
          linesDone = first;
          continue;
        }
      }
      // Move the whole remaining part to the next page, unless it already starts at the top of a page.
      if (remainingTop > pageTop + (a.kind === "row" ? a.repeat ?? 0 : 0) + EPS) {
        if (linesDone > 0) {
          // Cannot happen after a split (the remainder starts at a page top); keep the invariant anyway.
          breaks.push({ atom: i, line: linesDone, spacer: (p + 1) * pitch - remainingTop });
          offset += (p + 1) * pitch - remainingTop;
        } else move((p + 1) * pitch - top, null);
        continue;
      }
      oversize.push(i); // taller than a page and already at its top: let it overflow
      break;
    }

    startPage.push(Math.max(0, Math.floor((a.top + startOffset + EPS) / pitch)));
    lastBottom = Math.max(lastBottom, a.bottom + offset);
    if (a.kind === "break") {
      forcePage = startPage[i] + 1;
      endsWithBreak = i === atoms.length - 1;
    }
  }

  let pages = Math.max(1, Math.floor((lastBottom - EPS) / pitch) + 1);
  if (endsWithBreak) pages = Math.max(pages, Math.floor(lastBottom / pitch) + 2);
  return { breaks, pages, startPage, oversize };
}

/**
 * Final vertical position of an atom's top after applying the breaks (used by tests and by the verification
 * pass to know where each page's content must start).
 */
export function appliedOffset(breaks: PageBreak[], atomIndex: number, beforeLine = false): number {
  let offset = 0;
  for (const b of breaks) {
    if (b.atom < atomIndex || (b.atom === atomIndex && b.line === null)) offset += b.spacer;
    else if (b.atom === atomIndex && b.line !== null && beforeLine) offset += b.spacer;
  }
  return offset;
}
