import { describe, expect, it } from "vitest";
import { paginate, appliedOffset } from "../engine";
import { pageGeometry, type Atom, type LineBox, type PageGeometry } from "../model";
import { DEFAULT_PAGE } from "../../state/types";

const A4: PageGeometry = pageGeometry(DEFAULT_PAGE); // 1123 high, 96 margins -> 931 content, pitch 1147
const LH = 24;

/** Natural flow of paragraphs (margin 10px between) from the given line counts. */
function flow(lineCounts: number[], opts: { headings?: number[]; breaks?: number[] } = {}): Atom[] {
  let y = 0;
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
    expect(wide).toBeGreaterThan(portrait);
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
