import { describe, expect, it } from "vitest";
import { paginate, appliedOffset } from "../engine";
import { pageGeometry, type Atom, type LineBox, type PageGeometry } from "../model";
import { DEFAULT_PAGE } from "../../state/types";

const A4: PageGeometry = pageGeometry(DEFAULT_PAGE); // 1123 high, 96 margins -> 931 content, pitch 1147
const LH = 24;

/** Natural flow of paragraphs (margin 10px between) from the given line counts. */
function flow(lineCounts: number[], opts: { headings?: number[]; breaks?: number[] } = {}, start = 0): Atom[] {
  let y = start;
  return lineCounts.map((n, i) => {
    const top = y;
    const bottom = y + n * LH;
    y = bottom + 10;
    const lines: LineBox[] = Array.from({ length: n }, (_, k) => ({ top: top + k * LH, bottom: top + (k + 1) * LH }));
    const isBreak = opts.breaks?.includes(i);
    return { kind: isBreak ? "break" : "text", top, bottom, keepWithNext: opts.headings?.includes(i), lines: isBreak ? undefined : () => lines } as Atom;
  });
}

/** Final extents of every line after applying the breaks: nothing may straddle a page end. */
function violations(atoms: Atom[], geom: PageGeometry, res: ReturnType<typeof paginate>): string[] {
  const bad: string[] = [];
  atoms.forEach((a, i) => {
    if (res.oversize.includes(i) || a.kind === "break") return;
    const lines = a.lines?.() ?? [{ top: a.top, bottom: a.bottom }];
    lines.forEach((l, k) => {
      let off = 0;
      for (const b of res.breaks) if (b.atom < i || (b.atom === i && (b.line === null || b.line <= k))) off += b.spacer;
      const page = Math.floor((l.top + off + 0.5) / geom.pitch);
      if (l.top + off < page * geom.pitch - 0.5 || l.bottom + off > page * geom.pitch + geom.contentHeight + 0.5) bad.push(`atom ${i} line ${k}: ${l.top + off}..${l.bottom + off} page ${page}`);
    });
  });
  return bad;
}
const assertLayout = (atoms: Atom[], geom: PageGeometry, res: ReturnType<typeof paginate>) => expect(violations(atoms, geom, res)).toEqual([]);

describe("pagination engine", () => {
  it("keeps a short document on one page", () => {
    const res = paginate(flow([3, 5, 2]), A4);
    expect(res.pages).toBe(1);
    expect(res.breaks).toEqual([]);
  });

  it("spreads a long document over several pages without cutting any line", () => {
    const atoms = flow(Array(60).fill(6)); // 60 paragraphs of 6 lines
    const res = paginate(atoms, A4);
    expect(res.pages).toBeGreaterThan(3);
    assertLayout(atoms, A4, res);
  });

  it("splits a long paragraph by lines, honouring orphans and widows", () => {
    const atoms = flow([30, 80, 30]);
    const res = paginate(atoms, A4);
    const split = res.breaks.filter((b) => b.line !== null);
    expect(split.length).toBeGreaterThan(0);
    assertLayout(atoms, A4, res);
    for (const b of split) {
      expect(b.line!).toBeGreaterThanOrEqual(2);
      expect(atoms[b.atom].lines!().length - b.line!).toBeGreaterThanOrEqual(2);
    }
  });

  it("never leaves a single orphan/widow line", () => {
    // 38 lines of 24px = 912px, content 931: one extra line must pull another one with it.
    const atoms = flow([1, 38, 3]);
    const res = paginate(atoms, A4);
    for (const b of res.breaks.filter((x) => x.line !== null)) {
      const n = atoms[b.atom].lines!().length;
      expect(b.line!).toBeGreaterThanOrEqual(2);
      expect(n - b.line!).toBeGreaterThanOrEqual(2);
    }
  });

  it("does not leave a heading alone at the bottom of a page", () => {
    // fill the page almost entirely, then a heading, then body text.
    const atoms = flow([37, 1, 4], { headings: [1] });
    const res = paginate(atoms, A4);
    const headingMoved = res.breaks.some((b) => b.atom === 1 && b.line === null);
    expect(headingMoved).toBe(true);
    expect(res.startPage[1]).toBe(res.startPage[2]);
  });

  it("chains keep-with-next headings", () => {
    const atoms = flow([36, 1, 1, 4], { headings: [1, 2] });
    const res = paginate(atoms, A4);
    expect(res.startPage[1]).toBe(res.startPage[3]);
    expect(res.startPage[2]).toBe(res.startPage[3]);
  });

  it("respects manual page breaks", () => {
    const atoms = flow([2, 1, 2, 2], { breaks: [1] });
    const res = paginate(atoms, A4);
    expect(res.startPage[2]).toBe(res.startPage[1] + 1);
    expect(res.pages).toBe(2);
    // the text after the break starts exactly at the top of page 2
    expect(atoms[2].top + appliedOffset(res.breaks, 2)).toBe(A4.pitch);
  });

  it("a trailing manual break creates a new empty page", () => {
    const res = paginate(flow([2, 1], { breaks: [1] }), A4);
    expect(res.pages).toBe(2);
  });

  it("consecutive manual breaks each add a page", () => {
    const res = paginate(flow([1, 1, 1, 1], { breaks: [1, 2] }), A4);
    expect(res.startPage).toEqual([0, 0, 1, 2]);
    expect(res.pages).toBe(3);
  });

  it("lets an atom taller than a page overflow instead of looping", () => {
    const tall: Atom = { kind: "block", top: 0, bottom: 2000 };
    const res = paginate([tall, ...flow([2]).map((a) => ({ ...a, top: 2010, bottom: 2058 }))], A4);
    expect(res.oversize).toEqual([0]);
    expect(res.pages).toBeGreaterThanOrEqual(2);
  });

  it("is deterministic and idempotent", () => {
    const atoms = flow(Array.from({ length: 40 }, (_, i) => 3 + (i % 9)), { headings: [5, 15, 25] });
    expect(paginate(atoms, A4)).toEqual(paginate(atoms, A4));
  });

  it("page size, orientation and margins change the pagination", () => {
    const atoms = flow(Array(40).fill(8));
    const portrait = paginate(atoms, A4).pages;
    const landscape = paginate(atoms, pageGeometry({ ...DEFAULT_PAGE, orientation: "landscape" })).pages;
    const narrow = paginate(atoms, pageGeometry({ ...DEFAULT_PAGE, margins: "narrow" })).pages;
    const wide = paginate(atoms, pageGeometry({ ...DEFAULT_PAGE, margins: "wide" })).pages;
    const a5 = paginate(atoms, pageGeometry({ ...DEFAULT_PAGE, size: "A5" })).pages;
    expect(landscape).toBeGreaterThan(portrait);
    expect(narrow).toBeLessThan(portrait);
    expect(wide).toBeGreaterThanOrEqual(portrait); // "Larges" widens the side margins only: the text gets narrower, not shorter
    expect(pageGeometry({ ...DEFAULT_PAGE, margins: "wide" }).insetLeft).toBeGreaterThan(A4.insetLeft);
    expect(a5).toBeGreaterThan(portrait);
    const custom = pageGeometry({ ...DEFAULT_PAGE, margins: "custom", customMarginsCm: { top: 5, right: 2, bottom: 5, left: 2 } });
    expect(paginate(atoms, custom).pages).toBeGreaterThan(portrait);
  });

  it("a taller header or footer reduces the content area", () => {
    const base = pageGeometry(DEFAULT_PAGE);
    const withHeader = pageGeometry(DEFAULT_PAGE, 200, 200);
    expect(withHeader.contentHeight).toBeLessThan(base.contentHeight);
    expect(paginate(flow(Array(40).fill(8)), withHeader).pages).toBeGreaterThan(paginate(flow(Array(40).fill(8)), base).pages);
  });

  it("table rows move whole to the next page", () => {
    let y = 0;
    const rows: Atom[] = Array.from({ length: 40 }, () => ({ kind: "row", top: (y += 50) - 50, bottom: y }));
    const res = paginate(rows, A4);
    expect(res.pages).toBe(3);
    assertLayout(rows, A4, res);
    expect(res.breaks.every((b) => b.line === null)).toBe(true);
  });

  it("a row starting a new page makes room for the repeated table header", () => {
    let y = 0;
    const rows: Atom[] = Array.from({ length: 40 }, (_, i) => ({ kind: "row", top: (y += 50) - 50, bottom: y, ...(i > 0 ? { repeat: 30 } : {}) }));
    const res = paginate(rows, A4);
    const first = res.breaks[0];
    expect(first.repeat).toBe(30);
    // the gap is the usual one plus the header height; the row sits right under the repeated header
    const natural = rows[first.atom].top;
    expect(natural + first.spacer).toBeCloseTo(A4.pitch + 30, 0);
    expect(res.breaks.every((b) => b.repeat === 30)).toBe(true);
  });

  it("\"page break before\" starts a new page, except at the top of one", () => {
    const atoms = flow([3, 3, 3, 3]);
    atoms[2].breakBefore = true;
    const res = paginate(atoms, A4);
    expect(res.startPage[2]).toBe(1);
    expect(res.startPage[3]).toBe(1);
    assertLayout(atoms, A4, res);
    // already at the top of a page: no empty page is added
    const first = flow([3, 3]);
    first[0].breakBefore = true;
    expect(paginate(first, A4).pages).toBe(1);
  });

  it("\"keep lines together\" moves the whole paragraph instead of splitting it", () => {
    const split = flow([30, 30, 30]); // 3 paragraphs of 30 lines: the second one straddles the first page end
    const kept = flow([30, 30, 30]);
    kept[1].keepLines = true;
    const a = paginate(split, A4);
    const b = paginate(kept, A4);
    expect(a.breaks.some((x) => x.atom === 1 && x.line !== null)).toBe(true);
    expect(b.breaks.some((x) => x.atom === 1 && x.line !== null)).toBe(false);
    assertLayout(kept, A4, b);
  });

  it("a paragraph set to \"keep with next\" never ends a page alone", () => {
    const atoms = flow([20, 20, 20, 20, 20]);
    atoms[1].keepWithNext = true;
    atoms[1].lines = undefined;
    atoms[1].kind = "block";
    const res = paginate(atoms, A4);
    const last = (i: number) => atoms[i].bottom + appliedOffset(res.breaks, i);
    // the atom after it starts on the same page as it ends
    expect(Math.floor((last(1) - 1) / A4.pitch)).toBe(res.startPage[2]);
  });

  it("random documents always satisfy the layout invariants", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let t = 0; t < 40; t++) {
      const n = 5 + Math.floor(rnd() * 60);
      const counts = Array.from({ length: n }, () => 1 + Math.floor(rnd() * 25));
      const headings = counts.map((_, i) => i).filter(() => rnd() < 0.15);
      const atoms = flow(counts, { headings });
      const geom = pageGeometry({ ...DEFAULT_PAGE, orientation: rnd() < 0.3 ? "landscape" : "portrait", margins: (["normal", "narrow", "wide"] as const)[Math.floor(rnd() * 3)] });
      const res = paginate(atoms, geom);
      assertLayout(atoms, geom, res);
      // every atom is placed exactly once, in order
      expect(res.startPage).toHaveLength(atoms.length);
      expect([...res.startPage]).toEqual([...res.startPage].sort((a, b) => a - b));
    }
  });
});

describe("sections", () => {
  const portrait = pageGeometry(DEFAULT_PAGE);
  const landscape = pageGeometry({ ...DEFAULT_PAGE, orientation: "landscape" });
  const sec = (top: number, section: number): Atom => ({ kind: "section", top, bottom: top + 4, section });

  it("a section starts on a new page, with its own size", () => {
    const a = flow([10, 10]); // page 1
    const b: Atom = sec(a[1].bottom + 10, 1);
    const c = flow([10, 10], {}, b.bottom + 10);
    const atoms = [...a, b, ...c];
    const res = paginate(atoms, [portrait, landscape]);
    expect(res.startPage.slice(0, 2)).toEqual([0, 0]);
    expect(res.startPage[3]).toBe(1); // first atom of the second section: page 2
    expect(res.sheets).toHaveLength(2);
    expect(res.sheets[0]).toMatchObject({ width: portrait.width, height: portrait.height, section: 0 });
    expect(res.sheets[1]).toMatchObject({ width: landscape.width, height: landscape.height, section: 1, indexInSection: 0 });
    // the second sheet starts below the first one, a gap apart
    expect(res.sheets[1].top).toBeCloseTo(res.sheets[0].top + portrait.height + portrait.gap, 5);
    // the content of section 2 begins at the top of its text area
    const first = atoms[3];
    const y = first.top + appliedOffset(res.breaks, 3);
    expect(y).toBeCloseTo(res.sheets[1].top + landscape.insetTop, 5);
  });

  it("pages after the break use the new text height", () => {
    const a = flow([5]);
    const b = sec(a[0].bottom + 10, 1);
    const tall = flow(Array(60).fill(4), {}, b.bottom + 10);
    const res = paginate([...a, b, ...tall], [portrait, landscape]);
    const secPages = res.sheets.filter((s) => s.section === 1);
    expect(secPages.length).toBeGreaterThan(2);
    // landscape pages are closer together than portrait ones
    expect(secPages[1].top - secPages[0].top).toBeCloseTo(landscape.pitch, 5);
    expect(landscape.pitch).toBeLessThan(portrait.pitch);
    // every atom sits inside the text area of its page
    tall.forEach((t, k) => {
      const i = 2 + k;
      const top = t.top + appliedOffset(res.breaks, i);
      const sheet = res.sheets[res.startPage[i]];
      expect(top).toBeGreaterThanOrEqual(sheet.top + sheet.insetTop - 0.5);
      expect(top).toBeLessThan(sheet.top + sheet.height - sheet.insetBottom); // (paragraphs may be split by lines: only the start is checked)
    });
  });

  it("a section break at the very end still gives the new section a page", () => {
    const a = flow([5]);
    const res = paginate([...a, sec(a[0].bottom + 10, 1)], [portrait, landscape]);
    expect(res.pages).toBe(2);
    expect(res.sheets[1].width).toBe(landscape.width);
  });

  it("a single geometry still works as before", () => {
    const atoms = flow(Array(40).fill(8));
    expect(paginate(atoms, portrait)).toEqual(paginate(atoms, [portrait]));
    const sh = paginate(atoms, portrait).sheets;
    expect(sh[1].top - sh[0].top).toBeCloseTo(portrait.pitch, 5);
  });
});

describe("columns", () => {
  const two = pageGeometry({ ...DEFAULT_PAGE, columns: { count: 2, gapCm: 1, line: false } } as never);
  const textW = two.width - two.insetLeft - two.insetRight;
  const cw = (textW - two.columns!.gap) / 2;
  /** Blocks of `n` lines, back to back (natural flow in a column of one column's width). */
  const blocks = (counts: number[], opts: { split?: boolean } = {}): Atom[] => flow(counts).map((a) => (opts.split ? a : { ...a, keepLines: true }));

  it("fills the first column, then the second, then the next page", () => {
    // each block is 10 lines (LH * 10): a column holds ~ 931 / (10*LH + 10)
    const atoms = blocks(Array(30).fill(10));
    const res = paginate(atoms, two);
    const pl = res.placements;
    expect(pl.every((p) => p !== null)).toBe(true);
    const cols = pl.map((p) => `${p!.page}:${p!.x === 0 ? 0 : 1}`);
    // starts in column 0 of page 0, moves to column 1, then to page 1
    expect(cols[0]).toBe("0:0");
    expect(cols.some((c) => c === "0:1")).toBe(true);
    expect(cols.some((c) => c.startsWith("1:"))).toBe(true);
    // the second column is at the right of the first one
    const right = pl.find((p) => p!.x > 0)!;
    expect(right.x).toBeCloseTo(cw + two.columns!.gap, 5);
    expect(right.width).toBeCloseTo(cw, 5);
    // a block never starts below the bottom of the text area of its page
    atoms.forEach((_a, i) => expect(pl[i]!.y).toBeLessThan(res.sheets[pl[i]!.page].top + res.sheets[pl[i]!.page].height - two.insetBottom));
    // the tops of the first block of every column are the top of the text area
    expect(pl[0]!.y).toBeCloseTo(0, 5);
    expect(right.y).toBeCloseTo(0, 5);
    expect(res.pages).toBeGreaterThanOrEqual(2);
  });

  it("keeps the blocks of a column in order, one under the other", () => {
    const atoms = blocks([4, 4, 4]);
    const res = paginate(atoms, two);
    const ys = res.placements.map((p) => p!.y);
    expect(ys[1]).toBeGreaterThan(ys[0]);
    expect(ys[2]).toBeGreaterThan(ys[1]);
    // gaps are the natural ones (10 px between blocks in `flow`)
    expect(ys[1] - (ys[0] + (atoms[0].bottom - atoms[0].top))).toBeCloseTo(10, 5);
  });

  it("a column break sends what follows to the next column, then to the next page", () => {
    const atoms = blocks([2, 2, 2, 2]);
    const withBreaks: Atom[] = [atoms[0], { ...atoms[1], kind: "colbreak" }, atoms[2], { ...atoms[3], kind: "colbreak" }, { ...atoms[0], top: atoms[3].bottom + 10, bottom: atoms[3].bottom + 10 + (atoms[0].bottom - atoms[0].top) }];
    const res = paginate(withBreaks, two);
    const pl = res.placements;
    expect(pl[0]!.x).toBe(0);
    expect(pl[2]!.x).toBeCloseTo(cw + two.columns!.gap, 5);
    expect(pl[2]!.y).toBeCloseTo(0, 5);
    expect(pl[4]!.page).toBe(1);
    expect(pl[4]!.x).toBe(0);
  });

  it("splits a long paragraph across the columns of a page", () => {
    const atoms = flow([8, 60]); // 60 lines do not fit in the rest of column 1 but fit in two columns
    const res = paginate(atoms, two);
    const p = res.placements[1]!;
    expect(p.split).toBeDefined();
    expect(p.split!.columns).toBe(2);
    expect(p.width).toBeCloseTo(2 * cw + two.columns!.gap, 5);
    expect(p.split!.offset).toBeGreaterThan(0); // it starts below the first paragraph in column 1
    expect(p.x).toBe(0);
  });

  it("does not split across pages: a paragraph that would need a third column goes to the next page", () => {
    const atoms = flow([8, 400]);
    const res = paginate(atoms, two);
    const p = res.placements[1]!;
    expect(p.split).toBeUndefined();
    expect(p.page).toBeGreaterThanOrEqual(0);
  });

  it("the spacer stands in for the region and the blocks after it follow the real end", () => {
    const col = flow(Array(6).fill(10));
    const after = flow([3], {}, col[col.length - 1].bottom + 12);
    const sec: Atom = { kind: "section", top: col[col.length - 1].bottom + 4, bottom: col[col.length - 1].bottom + 8, section: 1, continuous: true };
    const atoms = [...col, sec, ...after.map((a) => ({ ...a, top: a.top + 12, bottom: a.bottom + 12 }))];
    const one = pageGeometry(DEFAULT_PAGE);
    const res = paginate(atoms, [two, one]);
    const region = res.breaks.find((b) => b.region)!;
    expect(region.atom).toBe(0);
    expect(region.spacer).toBeGreaterThan(0);
    // balanced: the two columns of the last (only) page have about the same height
    const ys = res.placements.slice(0, 6).map((p) => ({ x: p!.x, bottom: p!.y }));
    const left = Math.max(...ys.filter((p) => p.x === 0).map((p) => p.bottom));
    const right = Math.max(...ys.filter((p) => p.x > 0).map((p) => p.bottom));
    expect(Math.abs(left - right)).toBeLessThan(10 * 24 + 12);
    expect(right).toBeGreaterThan(0);
    // the block after the continuous break is placed below the region, in the flow
    const i = atoms.length - 1;
    const real = atoms[i].top + appliedOffset(res.breaks, i);
    const regionEnd = Math.max(...res.placements.slice(0, 6).map((p, k) => p!.y + (atoms[k].bottom - atoms[k].top)));
    expect(real).toBeGreaterThan(regionEnd - 1);
    expect(res.pages).toBe(1);
  });

  it("a section with one column is untouched by all this", () => {
    const atoms = flow(Array(40).fill(8));
    const plain = paginate(atoms, pageGeometry(DEFAULT_PAGE));
    expect(plain.placements.every((p) => p === null)).toBe(true);
  });
});
