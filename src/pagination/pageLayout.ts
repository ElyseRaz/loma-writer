/** One page sheet in the coordinates of the page stack (px at 100 % zoom). */
export interface StackSheet {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * The sheets of the stack, from its `data-sheets` attribute (set by the canvas from the pagination). Documents have one or more
 * sections, so sheets may differ in size and are not at a regular distance: code that places objects on "the page" must use this.
 * Falls back to a uniform stack described by `data-pitch` / `data-pages`.
 */
export function stackSheets(stack: HTMLElement): StackSheet[] {
  try {
    const raw = JSON.parse(stack.dataset.sheets ?? "null") as number[][] | null;
    if (raw?.length) return raw.map(([top, left, width, height]) => ({ top, left, width, height }));
  } catch {
    /* fall through */
  }
  const pitch = Number(stack.dataset.pitch) || 0;
  const pages = Math.max(1, Number(stack.dataset.pages) || 1);
  const width = stack.offsetWidth;
  const h = stack.querySelector<HTMLElement>(".page-sheet")?.offsetHeight ?? Math.max(0, pitch - 24);
  return Array.from({ length: pages }, (_, i) => ({ top: i * pitch, left: 0, width, height: h }));
}

/** Index of the sheet holding the stack ordinate `y` (the gap below a sheet belongs to it). */
export function sheetIndexAt(sheets: StackSheet[], y: number): number {
  let page = 0;
  sheets.forEach((s, i) => { if (s.top <= y + 1) page = i; });
  return page;
}

export interface Placed {
  /** Index of the sheet the object lands on. */
  page: number;
  /** Position relative to that sheet (what free objects store). */
  x: number;
  y: number;
  /** Position in stack coordinates. */
  ax: number;
  ay: number;
}

/** Where an object of size `w` × `h` dragged to the stack position (`ax`, `ay`) lands: on the sheet under its top-left corner, kept inside the paper. */
export function placeInSheets(sheets: StackSheet[], ax: number, ay: number, w: number, h: number): Placed {
  const page = sheetIndexAt(sheets, ay);
  const s = sheets[page];
  const x = Math.round(Math.min(Math.max(ax - s.left, 0), Math.max(0, s.width - w)));
  const y = Math.round(Math.min(Math.max(ay - s.top, 0), Math.max(0, s.height - h)));
  return { page, x, y, ax: s.left + x, ay: s.top + y };
}
