import type { Atom, Band, Fragment, Placement, PageBreak, PageGeometry, PaginationResult, Sheet } from "./model";

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
export function paginate(atoms: Atom[], geometry: PageGeometry | PageGeometry[], options: EngineOptions = {}): PaginationResult {
  const orphans = options.orphans ?? 2;
  const widows = options.widows ?? 2;
  const geoms = Array.isArray(geometry) ? geometry : [geometry];

  // A section has its own page size and margins. Within a section the pages are `pitch` apart; a section break starts a new
  // section on a new page, whose position follows from the height of the previous page. Coordinates: 0 = top of the text area of page 0.
  let cur = { g: geoms[0], startPage: 0, startContent: 0, firstContent: 0, idx: 0 };
  const sections = [cur]; // the sections that start a page (continuous ones share the page of the previous one)
  let secIdx = 0; // index of the section the atoms being laid out belong to
  const contentTop = (p: number) => cur.startContent + (p - cur.startPage) * cur.g.pitch;
  const pageOf = (y: number) => cur.startPage + Math.max(0, Math.floor((y - cur.startContent + EPS) / cur.g.pitch));
  let H = cur.g.contentHeight;
  const breaks: PageBreak[] = [];
  const startPage: number[] = [];
  const oversize: number[] = [];
  const placements: Array<Placement | null> = atoms.map(() => null);
  const bands: Band[] = [];

  let offset = 0;
  let startOffset = 0; // offset applied to the first part of the current atom
  let forcePage = -1; // next atom must start on or after this page (manual page break)
  let lastBottom = 0;
  let endsWithBreak = false;
  let endsWithSection = false;
  let lastRegionPage = 0;

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


  /** Height the lines of `a` from index `from` need, relative to the top of line `from`. */
  const linesBottom = (lines: Array<{ top: number; bottom: number }>, from: number, to: number) => lines[to - 1].bottom - lines[from].top;

  /**
   * Columns. The atoms of a section with N columns are top-level blocks measured at the width of one column. They are placed in
   * column slots (page, column, y): a block goes under the previous one, in the next column when it does not fit, on the next page
   * after the last column. A paragraph may be split across the columns of one page (the view draws it as a small multi-column
   * box); anything else moves whole. Before a continuous section break the columns of the last page are balanced.
   */
  const placeRegion = (i0: number, i1: number) => {
    const g = cur.g;
    const cols = g.columns!;
    const N = cols.count;
    const textW = g.width - g.insetLeft - g.insetRight;
    const cw = (textW - (N - 1) * cols.gap) / N;
    const colX = (c: number) => c * (cw + cols.gap);

    let y0 = atoms[i0].top + offset;
    const realStart = y0;
    let p0 = pageOf(y0);
    if (y0 - contentTop(p0) > H - EPS) { p0 += 1; y0 = contentTop(p0); }
    if (forcePage >= 0 && y0 < contentTop(forcePage) - EPS) { p0 = forcePage; y0 = contentTop(p0); }
    forcePage = -1;
    if (atoms[i0].breakBefore && y0 - contentTop(p0) > EPS) { p0 += 1; y0 = contentTop(p0); }

    interface Flow { pl: Array<Placement | null>; endPage: number; endY: number; overflow: boolean; lastPageFrom: number; lastPageLine: number; used: number }

    /**
     * One pass over atoms k0..k1: `fixed` (balancing) gives every column of the first page that height; `line0` starts the first
     * atom at that line (its earlier lines are already placed on a previous page).
     */
    const flow = (k0: number, k1: number, pStart: number, yStart: number, fixed: number | null, line0 = 0): Flow => {
      const pl: Array<Placement | null> = [];
      let p = pStart;
      let c = 0;
      let y = 0; // used height in the current column
      let firstInCol = true;
      let overflow = false;
      let lastPageFrom = k0;
      let lastPageLine = line0;
      let maxUsed = 0; // lowest point used by any column of the current page
      const colTop = (page: number) => (page === pStart ? yStart : contentTop(page));
      const cap = (page: number) => (page === pStart && fixed !== null ? fixed : contentTop(page) + H - colTop(page));
      const newPage = (k: number, line: number) => { p += 1; c = 0; y = 0; firstInCol = true; maxUsed = 0; lastPageFrom = k; lastPageLine = line; };
      const next = (k: number, line: number) => { c += 1; if (c >= N) newPage(k, line); else { y = 0; firstInCol = true; } };
      for (let k = k0; k < k1; k++) {
        const a = atoms[k];
        const startLine = k === k0 ? line0 : 0;
        if (lastPageFrom === -1) { lastPageFrom = k; lastPageLine = 0; }
        if (a.kind === "break") { pl.push({ page: p, x: colX(c), y: colTop(p) + y, width: cw }); if (!(c === 0 && y === 0 && firstInCol)) newPage(k + 1, 0); continue; }
        if (a.kind === "colbreak") { pl.push({ page: p, x: colX(c), y: colTop(p) + y, width: cw }); if (!(c === 0 && firstInCol)) next(k + 1, 0); continue; }
        if (a.breakBefore && !(c === 0 && firstInCol) && startLine === 0) newPage(k, 0);
        // Text is shared between slots line by line; so is a table row taller than a whole column (it could not fit anywhere).
        const splittable = a.kind === "text" || (a.kind === "row" && a.bottom - a.top > H);
        const lines = splittable && a.lines && (!a.keepLines || startLine > 0) ? a.lines() : null;
        const h = lines && startLine > 0 ? linesBottom(lines, startLine, lines.length) : a.bottom - a.top;
        let placed: Placement | null = null;
        for (let guard = 0; guard < 4 * N + 6 && !placed; guard++) {
          const gap = firstInCol || k === k0 ? 0 : Math.max(0, a.top - atoms[k - 1].bottom);
          const room = cap(p) - y;
          // A table that goes on at the top of a column repeats its header rows there: room is kept above the row.
          const head = firstInCol && startLine === 0 && (a.repeat ?? 0) > 0 && a.repeat! <= 0.4 * H && k > 0 && atoms[k - 1].kind === "row" && atoms[k - 1].tableId === a.tableId ? a.repeat! : 0;
          let need = gap + h + head;
          // A heading must keep the start of what follows with it.
          if (a.keepWithNext && k + 1 < k1 && !firstInCol) {
            const n = atoms[k + 1];
            let follow = n.bottom - n.top;
            if (n.kind === "text" && n.lines) { const ls = n.lines(); if (ls.length > orphans) follow = ls[orphans - 1].bottom - n.top; }
            need = gap + h + head + Math.max(0, n.top - a.bottom) + follow;
          }
          if (need <= room + EPS) {
            placed = startLine > 0
              ? { page: p, x: colX(c), y: colTop(p) + y, width: cw, frags: [{ from: startLine, to: lines!.length, page: p, x: colX(c), y: colTop(p) + y }] }
              : { page: p, x: colX(c), y: colTop(p) + y + gap + head, width: cw, ...(head ? { header: head } : {}) };
            y += gap + h + head;
            firstInCol = false;
            break;
          }
          // Lines that do not all fit go on, column after column and page after page (orphans and widows respected).
          if (lines && lines.length - startLine >= 2) {
            const total = lines.length;
            const frags: Fragment[] = [];
            const used: number[] = []; // bottom of each fragment, from the top of its column
            const base = y + gap;
            let idx = startLine;
            let sp = p;
            let sc = c;
            let ok = true;
            while (idx < total) {
              const first = frags.length === 0;
              const top = first ? base : 0;
              const capacity = cap(sp) - top;
              let n = 0;
              while (idx + n < total && linesBottom(lines, idx, idx + n + 1) <= capacity + EPS) n++;
              const at = { page: sp, x: colX(sc), y: first ? colTop(sp) + base : colTop(sp) };
              if (idx + n >= total) { frags.push({ from: idx, to: total, ...at }); used.push(top + linesBottom(lines, idx, total)); break; }
              if (total - (idx + n) < widows) n = total - idx - widows;
              const minHere = idx === 0 ? orphans : 1;
              if (n < minHere) {
                if (first && !firstInCol) { ok = false; break; } // not here: try the next column
                n = Math.max(1, Math.min(minHere, total - idx - 1)); // a fresh column too short: take what is required anyway
                overflow = true;
              }
              frags.push({ from: idx, to: idx + n, ...at });
              used.push(top + linesBottom(lines, idx, idx + n));
              idx += n;
              sc += 1;
              if (sc >= N) { sc = 0; sp += 1; }
            }
            if (ok) {
              const last = frags[frags.length - 1];
              placed = { page: frags[0].page, x: frags[0].x, y: frags[0].y, width: cw, frags };
              if (last.page !== p) {
                maxUsed = 0;
                lastPageFrom = k;
                lastPageLine = frags.find((f) => f.page === last.page)!.from;
              }
              frags.forEach((f, i) => { if (f.page === last.page) maxUsed = Math.max(maxUsed, used[i]); });
              p = last.page;
              c = Math.round(last.x / (cw + cols.gap));
              y = used[used.length - 1];
              firstInCol = false;
              break;
            }
          }
          if (firstInCol) { // taller than a whole column and alone in it: let it overflow
            placed = { page: p, x: colX(c), y: colTop(p) + y, width: cw };
            overflow = true;
            y += h;
            firstInCol = false;
          } else next(k, startLine);
        }
        if (!placed) { placed = { page: p, x: colX(c), y: colTop(p), width: cw }; overflow = true; }
        pl.push(placed);
        maxUsed = Math.max(maxUsed, y);
      }
      return { pl, endPage: p, endY: colTop(p) + maxUsed, overflow, lastPageFrom, lastPageLine, used: maxUsed };
    };

    let res = flow(i0, i1, p0, y0, null);
    // Before a continuous section break, and at the end of the document, the columns of the last page are balanced (the shortest
    // height that still fits).
    const balance = i1 >= atoms.length || (atoms[i1].kind === "section" && !!atoms[i1].continuous);
    if (balance && !res.overflow && res.lastPageFrom >= 0) {
      const pLast = res.endPage;
      const kFrom = res.lastPageFrom;
      const lineFrom = res.lastPageLine;
      const topLast = pLast === p0 ? y0 : contentTop(pLast);
      let hi = contentTop(pLast) + H - topLast;
      let lo = Math.max(1, (res.endY - topLast) / N);
      let best: Flow | null = null;
      for (let it = 0; it < 14 && hi - lo > 1; it++) {
        const mid = (lo + hi) / 2;
        const trial = flow(kFrom, i1, pLast, topLast, mid, lineFrom);
        if (!trial.overflow && trial.endPage === pLast) { best = trial; hi = mid; } else lo = mid;
      }
      if (best) {
        // An atom that began on an earlier page keeps its first fragments; the balanced ones replace the rest.
        const before = res.pl[kFrom - i0];
        const head = lineFrom > 0 && before?.frags ? { ...before, frags: [...before.frags.filter((f) => f.from < lineFrom), ...(best.pl[0]?.frags ?? [])] } : best.pl[0];
        res = { ...res, pl: [...res.pl.slice(0, kFrom - i0), head, ...best.pl.slice(1)], endY: best.endY, endPage: pLast, used: best.used };
      }
    }

    res.pl.forEach((pl, k) => { placements[i0 + k] = pl; startPage[i0 + k] = pl ? pl.page : p0; });
    atoms.slice(i0, i1).forEach((a, k) => { if (res.pl[k] && a.bottom - a.top > H) oversize.push(i0 + k); });
    const yEnd = res.endY;
    lastRegionPage = Math.max(lastRegionPage, res.endPage);
    // The blocks of the region are drawn out of the flow: a spacer takes their place, as tall as the region really is.
    const naturalEnd = atoms[i1 - 1].bottom;
    const nextGap = i1 < atoms.length ? Math.max(0, atoms[i1].top - naturalEnd) : 0;
    const spacerHeight = Math.max(0, yEnd - realStart);
    const offsetBefore = offset;
    offset = yEnd - naturalEnd;
    breaks.push({ atom: i0, line: null, spacer: spacerHeight, net: offset - offsetBefore, region: { margin: nextGap, pages: res.endPage - p0 } });
    lastBottom = Math.max(lastBottom, yEnd);
    // Column separators
    if (cols.line) {
      for (let pg = p0; pg <= res.endPage; pg++) {
        const topY = pg === p0 ? y0 : contentTop(pg);
        const bottomY = pg === res.endPage ? res.endY : contentTop(pg) + H;
        if (bottomY - topY > 4) bands.push({ page: pg, top: topY, height: bottomY - topY, count: N, gap: cols.gap, width: cw, left: g.insetLeft });
      }
    }
  };

  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i];
    // A run of atoms in a section with several columns is laid out by `placeRegion` (column slots instead of pages).
    if (a.kind !== "section" && (geoms[Math.min(secIdx, geoms.length - 1)].columns?.count ?? 1) > 1) {
      let j = i;
      while (j < atoms.length && atoms[j].kind !== "section") j++;
      placeRegion(i, j);
      i = j - 1;
      continue;
    }
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

    // "Page break before": the atom starts the next page, unless it already is at the top of one.
    if (a.breakBefore) {
      const p0 = pageOf(top);
      if (top - contentTop(p0) > EPS) forcePage = Math.max(forcePage, p0 + 1);
    }
    if (forcePage >= 0 && top < contentTop(forcePage) - EPS) move(contentTop(forcePage) - top, null);
    forcePage = -1;

    const page0 = () => pageOf(top);
    // An atom that starts inside the gap/margin zone after a page's content belongs to the next page.
    if (top - contentTop(page0()) > H - EPS && a.kind !== "break") move(contentTop(page0() + 1) - top, null);
    let linesDone = 0; // lines of this atom already placed (after a split)
    let guard = 0;
    for (;;) {
      if (++guard > 10000) break; // safety net against a degenerate geometry

      // Where does the part of the atom that is still to place start and end?
      let lines = a.kind === "text" && a.lines ? a.lines() : null;
      if (lines && lines.length <= linesDone) lines = null;
      const bottom = (lines ? lines[lines.length - 1].bottom : a.bottom) + offset;
      const remainingTop = lines ? lines[linesDone].top + offset : top;
      const p = pageOf(remainingTop);
      const limit = contentTop(p) + H;
      const pageTop = contentTop(p);

      if (bottom <= limit + EPS) {
        // Fits. A heading still has to stay with the beginning of what follows.
        if (linesDone === 0 && a.keepWithNext && remainingTop > pageTop + EPS && remainingTop + keepExtent(i) > limit + EPS) {
          move(contentTop(p + 1) - top, null);
          continue;
        }
        break;
      }

      // Does not fit. Split a paragraph by lines when both sides keep enough lines.
      if (lines && !a.keepLines && remainingTop < limit - EPS) {
        const total = lines.length;
        let fit = 0;
        for (let k = linesDone; k < total && lines[k].bottom + offset <= limit + EPS; k++) fit = k + 1;
        let first = fit; // first line that moves to the next page
        if (total - first < widows) first = total - widows;
        if (first - linesDone >= orphans && first < total) {
          const spacer = contentTop(p + 1) - (lines[first].top + offset);
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
          breaks.push({ atom: i, line: linesDone, spacer: contentTop(p + 1) - remainingTop });
          offset += contentTop(p + 1) - remainingTop;
        } else move(contentTop(p + 1) - top, null);
        continue;
      }
      oversize.push(i); // taller than a page and already at its top: let it overflow
      break;
    }

    startPage.push(pageOf(a.top + startOffset));
    lastBottom = Math.max(lastBottom, a.bottom + offset);
    if (a.kind === "break") {
      forcePage = startPage[i] + 1;
      endsWithBreak = i === atoms.length - 1;
    }
    if (a.kind === "section") {
      const idx = Math.min(geoms.length - 1, Math.max(0, a.section ?? 0));
      const g = geoms[idx];
      secIdx = idx;
      if (a.continuous) {
        // Same page, same paper: only the columns (and the text width) may change.
        cur = { ...cur, g: { ...g, width: cur.g.width, height: cur.g.height, insetTop: cur.g.insetTop, insetBottom: cur.g.insetBottom, contentHeight: cur.g.contentHeight, pitch: cur.g.pitch }, idx };
      } else {
        // The next atoms belong to a new section, which starts on a new page of its own size.
        const p = pageOf(a.bottom + offset - EPS);
        const pageTop = contentTop(p) - cur.g.insetTop;
        const newTop = pageTop + cur.g.height + cur.g.gap;
        cur = { g, startPage: p + 1, startContent: newTop + g.insetTop, firstContent: newTop + g.insetTop, idx };
        sections.push(cur);
        H = g.contentHeight;
        forcePage = p + 1;
        endsWithSection = i === atoms.length - 1;
      }
    }
  }

  let pages = Math.max(1, pageOf(lastBottom - EPS) + 1, lastRegionPage + 1);
  if (endsWithBreak) pages = Math.max(pages, pageOf(lastBottom) + 2);
  if (endsWithSection) pages = Math.max(pages, cur.startPage + 1);

  // The sheets: where each page is, and how big (engine coordinates: 0 = top of the text area of page 0).
  const sheets: Sheet[] = [];
  const maxWidth = Math.max(...geoms.map((g) => g.width));
  sections.forEach((sec, si) => {
    const end = si + 1 < sections.length ? sections[si + 1].startPage : pages;
    for (let k = sec.startPage; k < end; k++) {
      const top = sec.startContent + (k - sec.startPage) * sec.g.pitch - sec.g.insetTop;
      sheets.push({ top, left: (maxWidth - sec.g.width) / 2, width: sec.g.width, height: sec.g.height, insetTop: sec.g.insetTop, insetBottom: sec.g.insetBottom, insetLeft: sec.g.insetLeft, insetRight: sec.g.insetRight, section: sec.idx, indexInSection: k - sec.startPage });
    }
  });
  return { breaks, pages, startPage, oversize, sheets, placements, bands };
}

/**
 * Final vertical position of an atom's top after applying the breaks (used by tests and by the verification
 * pass to know where each page's content must start).
 */
export function appliedOffset(breaks: PageBreak[], atomIndex: number, beforeLine = false): number {
  let offset = 0;
  for (const b of breaks) {
    const d = b.net ?? b.spacer;
    if (b.atom < atomIndex || (b.atom === atomIndex && b.line === null)) offset += d;
    else if (b.atom === atomIndex && b.line !== null && beforeLine) offset += d;
  }
  return offset;
}
