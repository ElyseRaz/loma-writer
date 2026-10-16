import { Extension } from "@tiptap/core";
import { notesOptionsOf } from "../editor/references/Notes";
import { formatNoteNumber, noteValue } from "../editor/references/notesNumbering";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Editor } from "@tiptap/react";
import { paginate } from "./engine";
import { collectAtoms, FRAME_PROPS, type AtomRef } from "./measure";
import type { PageStart } from "./pageIndex";
import { bodyOf, type NoteParagraph, renderBody } from "../editor/references/noteBody";
import { FOOTNOTE_SEPARATOR, type Band, type PageGeometry, type Sheet } from "./model";

export interface PaginationState {
  decos: DecorationSet;
  pages: number;
  /** Where each page sheet is (engine coordinates: 0 = top of the text area of page 0). */
  sheets: Sheet[];
  /** Rules between columns. */
  bands: Band[];
  /** Signature of the layout the decorations encode; recomputed from the live decorations so edits invalidate it. */
  signature: string;
}

interface SpacerSpec {
  kind: string;
  spacer: number;
  target: number;
  key: string;
}

/** Where the spacers really are now (after edits and undo/redo have moved or dropped them). */
function signatureOf(pages: number, decos: DecorationSet): string {
  const parts = decos.find().filter((d) => (d.spec as SpacerSpec | undefined)?.kind !== undefined).map((d) => `${(d.spec as SpacerSpec).kind}@${d.from}:${(d.spec as SpacerSpec).spacer.toFixed(1)}:${(d.spec as SpacerSpec).target.toFixed(1)}`);
  return `${pages}|${parts.join(",")}`;
}

const QUIET_MS = 60;
const MAX_WAIT = 220;

export const paginationKey = new PluginKey<PaginationState>("loma-pagination");

interface Storage {
  /** Geometry of the first section (what single-section code reads). */
  geometry: PageGeometry | null;
  /** One geometry per section. */
  geometries: PageGeometry[];
  scale: number;
  dirty: boolean;
  /** Called after each layout, with the number of pages. */
  onLayout?: (pages: number) => void;
  /** Page where each block of the last layout starts (tables of contents read it). */
  pageStarts: PageStart[];
  /** The footnotes of each page (by page index) as drawn by the last layout, for the sheets to show. */
  pageNotes: Record<number, PageNote[]>;
  /** Room the last layout kept at the bottom of each page for its notes (separator included). */
  pageReserved: number[];
}

/** A footnote as shown at the bottom of its page. */
export interface PageNote {
  pos: number;
  /** How its number is written. */
  label: string;
  body: NoteParagraph[];
  /** A note that goes on over several pages: pixels of it already shown on the earlier pages, and pixels shown here (all when absent). */
  skip?: number;
  clip?: number;
}

const storageOf = (editor: Editor) => (editor.storage as unknown as { pagination: Storage }).pagination;

/** Tells the engine about the current page geometry and zoom, and asks for a new layout when they change. */
export function setPaginationInputs(editor: Editor, geometry: PageGeometry | PageGeometry[], scale: number) {
  const s = storageOf(editor);
  const geoms = Array.isArray(geometry) ? geometry : [geometry];
  // A new zoom re-runs the (cheap) verification: text snaps to device pixels differently at each zoom level.
  const changed = JSON.stringify(s.geometries) !== JSON.stringify(geoms) || s.scale !== scale;
  s.geometries = geoms;
  s.geometry = geoms[0];
  s.scale = scale;
  if (changed) {
    s.dirty = true;
    if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(paginationKey, { repaginate: true }));
  }
}

/** Asks for a new layout, e.g. when the editor becomes visible again. */
export function requestPagination(editor: Editor) {
  if (editor.isDestroyed) return;
  storageOf(editor).dirty = true;
  editor.view.dispatch(editor.state.tr.setMeta(paginationKey, { repaginate: true }));
}

/** A non-editable copy of a table header row, shown at the top of each page the table continues on. */
function headerCopy(row: HTMLTableRowElement): HTMLElement {
  const el = row.cloneNode(true) as HTMLElement;
  el.className = "pg-spacer pg-header";
  el.removeAttribute("data-pm-slice");
  el.setAttribute("aria-hidden", "true");
  el.contentEditable = "false";
  el.querySelectorAll("[contenteditable]").forEach((n) => n.removeAttribute("contenteditable"));
  return el;
}

function spacer(kind: "block" | "inline" | "row", height: number, target: number, columns: number, repeats = false, region?: { margin: number; pages: number }): HTMLElement {
  const el = document.createElement(kind === "row" ? "tr" : kind === "inline" ? "span" : "div");
  el.className = `pg-spacer pg-${kind}`;
  el.setAttribute("aria-hidden", "true");
  el.contentEditable = "false";
  el.dataset.target = String(target);
  if (repeats) el.dataset.repeats = "1";
  if (region) {
    // The blocks of a column region are drawn out of the flow: this spacer is as tall as the region, with the gap that followed it.
    el.dataset.region = "1";
    el.style.marginBottom = `${region.margin}px`;
    el.style.setProperty("--k", String(Math.max(1, region.pages)));
  }
  setHeight(el, height);
  if (kind === "row") {
    const td = document.createElement("td");
    td.colSpan = columns;
    td.className = "pg-cell";
    el.appendChild(td);
  }
  return el;
}

function setHeight(el: HTMLElement, h: number) {
  el.dataset.h = String(h);
  // On screen the whole height is used; when printing the visual gap between sheets is removed.
  const box = el.tagName === "TR" ? ((el.firstChild as HTMLElement | null) ?? el) : el;
  box.style.setProperty("--h", String(h));
}

/**
 * Real pagination of the single ProseMirror document. The text is never cut or moved in the model:
 * page ends are materialised as spacer widgets placed where the engine decided, so the cursor, undo history
 * and the DOCX/ODT adapters are unaffected.
 */
export const Pagination = Extension.create({
  name: "pagination",

  addStorage(): Storage {
    return { geometry: null, geometries: [], scale: 1, dirty: false, pageStarts: [], pageNotes: {}, pageReserved: [] };
  },

  addProseMirrorPlugins() {
    const storage = this.storage as Storage;
    return [
      new Plugin<PaginationState>({
        key: paginationKey,
        state: {
          init: () => ({ decos: DecorationSet.empty, pages: 1, sheets: [], bands: [], signature: "" }),
          apply(tr, value) {
            const meta = tr.getMeta(paginationKey) as { decos: DecorationSet; pages: number; sheets: Sheet[]; bands: Band[]; signature: string } | undefined;
            if (meta && "decos" in meta) return meta;
            if (!tr.docChanged) return value;
            const decos = value.decos.map(tr.mapping, tr.doc);
            return { ...value, decos, signature: `${signatureOf(value.pages, decos)}|${value.signature.split("|").slice(2).join("|")}`.replace(/\|$/, "") };
          },
        },
        props: {
          decorations: (state) => {
            const decos = paginationKey.getState(state)?.decos ?? DecorationSet.empty;
            const margins = sectionMargins(state.doc, storage.geometries);
            return margins ? decos.add(state.doc, margins) : decos;
          },
        },
        view(view) {
          let raf = 0;
          let verifyRaf = 0;
          let timer: ReturnType<typeof setTimeout> | undefined;
          let firstAt = 0;
          // Typing: wait a short pause between keystrokes (but never more than MAX_WAIT) before measuring again.
          const schedule = (immediate = false) => {
            const now = performance.now();
            if (!firstAt) firstAt = now;
            clearTimeout(timer);
            timer = setTimeout(
              () => {
                firstAt = 0;
                cancelAnimationFrame(raf);
                raf = requestAnimationFrame(() =>
                  layout(view, storage, () => {
                    cancelAnimationFrame(verifyRaf);
                    verifyRaf = requestAnimationFrame(() => verify(view, storage));
                  }),
                );
              },
              immediate || now - firstAt > MAX_WAIT ? 0 : QUIET_MS,
            );
          };
          // The browser maps a click on text moved with a relative offset (columns) through the unmoved line boxes: look the character up
          // in the lines as they are drawn instead.
          const original = view.posAtCoords.bind(view);
          view.posAtCoords = (coords) => shiftedPosAtCoords(view, coords) ?? original(coords);
          const onLoad = () => schedule(true); // images change heights once decoded
          view.dom.addEventListener("load", onLoad, true);
          void document.fonts?.ready.then(() => schedule(true));
          schedule(true);
          return {
            update(v, prev) {
              if (storage.dirty) schedule(true);
              else if (!v.state.doc.eq(prev.doc)) schedule();
            },
            destroy() {
              view.posAtCoords = original;
              clearTimeout(timer);
              cancelAnimationFrame(raf);
              cancelAnimationFrame(verifyRaf);
              view.dom.removeEventListener("load", onLoad, true);
            },
          };
        },
      }),
    ];
  },
});


/** A display-only widget (frames, header copies): never takes the selection or the clicks. */
function overlayWidget(at: number, side: number, key: string, build: () => HTMLElement): Decoration {
  return Decoration.widget(at, build, { side, key: `pg:${key}`, kind: "frame", spacer: 0, target: 0, ignoreSelection: true, stopEvent: () => true });
}
/** Key part for a position or a size: rounded, so two layouts that look the same share a widget. */
const fk = (...n: number[]) => n.map((v) => v.toFixed(1)).join(":");

/** An absolutely positioned, non-editable, hidden-from-assistive-tech box. */
function makeFrame(tag: "span" | "div", className: string, css: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  el.setAttribute("aria-hidden", "true");
  el.contentEditable = "false";
  el.style.cssText = css;
  return el;
}
const boxCss = (left: number, top: number, width: number | null, height: number) => `left:${+left.toFixed(2)}px;top:${+top.toFixed(2)}px;${width === null ? "" : `width:${+width.toFixed(2)}px;`}height:${+height.toFixed(2)}px`;
const paintCss = (c: { bg: string; border: string }) => `background:${c.bg};${c.border ? `border:${c.border};` : ""}`;

/** Inline spans that move the later runs of lines of a block to their own column or page (and the frames behind them). */
function fragmentDecos(atom: import("./model").Atom, ref: import("./measure").AtomRef, pl: import("./model").Placement, pos: number, nodeSize: number, sub: (pages: number) => string, framed: boolean, rowCells?: AtomRef["cells"]): Decoration[] {
  const cut = pl.frags;
  if (!cut || cut.length < 2) return [];
  const lines = atom.lines?.() ?? [];
  const flows = ref.flows ?? [{ end: pos + nodeSize - 1, starts: ref.lineStarts as Array<number | undefined>, extent: [] }];
  const out: Decoration[] = [];
  cut.forEach((f, k) => {
    if (!lines[f.from]) return;
    // A table row shared over slots: its cells are redrawn (background, border) for each run, behind the text, from the first cell.
    if (rowCells?.length) {
      const top = k === 0 ? 0 : f.y - pl.y;
      const h = lines[f.to - 1].bottom - (k === 0 ? atom.top : lines[f.from].top);
      const dxk = k === 0 ? 0 : f.x - pl.x;
      out.push(overlayWidget(pos + 2, -3, `rowframe:${pos}:${k}:${fk(dxk, top, h)}:${rowCells.map((c) => `${c.left.toFixed(1)},${c.width.toFixed(1)},${c.bg},${c.border}`).join("|")}`, () => rowFrames(rowCells, dxk, top, h)));
    }
    // Blocks with a background or a border inside a list item: their frame is redrawn for every run (inside the unit's own box).
    if (!rowCells) {
      const topRel = k === 0 ? 0 : f.y - pl.y;
      const base = k === 0 ? atom.top : lines[f.from].top;
      const dxk = k === 0 ? 0 : f.x - pl.x;
      flows.forEach((flow, fi) => {
        if (!flow.look) return;
        let top = Infinity;
        let bottom = -Infinity;
        for (let i = f.from; i < f.to; i++) { const e = flow.extent[i]; if (e) { top = Math.min(top, e.top); bottom = Math.max(bottom, e.bottom); } }
        if (bottom <= top) return;
        const t = topRel + (top - base);
        const h = bottom - top;
        out.push(overlayWidget(pos + 1, -3, `uframe:${pos}:${k}:${fi}:${fk(dxk, t, h, flow.look!.left, flow.look!.width)}:${flow.look!.css}`, () => unitFrame(flow.look!, dxk, t, h)));
      });
    }
    // Cells of a table inside a list item: the part of each cell that falls in this run is drawn again at its place.
    if (!rowCells && ref.tdBoxes?.length) {
      const topRel = k === 0 ? 0 : f.y - pl.y;
      const base = k === 0 ? atom.top : lines[f.from].top;
      const end = lines[f.to - 1].bottom;
      const dxk = k === 0 ? 0 : f.x - pl.x;
      ref.tdBoxes.forEach((c, ci) => {
        // The part of the cell in this run. The lines stop above the cell's padding and border: when the cell ends here, the frame goes on to its bottom.
        const top = Math.max(c.top, base);
        const bottom = c.bottom <= end + 10 ? c.bottom : Math.min(c.bottom, end);
        if (bottom - top < 1) return;
        const t = Math.round((topRel + (top - base)) * 2) / 2;
        const h = Math.max(1, Math.round((bottom - top) * 2) / 2);
        out.push(overlayWidget(pos + 1, -3, `cframe:${pos}:${k}:${ci}:${fk(dxk, t, h, c.left, c.width)}:${c.bg}:${c.border}`, () => cellFrame(c, dxk, t, h)));
      });
    }
    if (k === 0) return;
    const nextFrom = k + 1 < cut.length ? cut[k + 1].from : lines.length;
    const dx = f.x - pl.x;
    const dy = f.y - (pl.y + lines[f.from].top - atom.top);
    const style = `--sx:${+dx.toFixed(2)}px;--sy:calc(${+dy.toFixed(2)}px${sub(f.page - pl.page)})`;
    for (const flow of flows) {
      let from: number | undefined;
      for (let i = f.from; i < f.to && from === undefined; i++) from = flow.starts[i];
      if (from === undefined) continue;
      let to: number | undefined;
      for (let i = nextFrom; i < flow.starts.length && to === undefined; i++) to = flow.starts[i];
      out.push(Decoration.inline(from, to ?? flow.end, { class: "col-shift", style }));
    }
    // A paragraph with a background or a border: the same frame behind each later run (a widget drawn out of the flow).
    if (framed) {
      const h = lines[f.to - 1].bottom - lines[f.from].top;
      out.push(overlayWidget(pos + 1, -3, `frame:${pos}:${k}:${fk(dx, f.y - pl.y, h)}`, () => frame(ref.el, dx, f.y - pl.y, h)));
    }
  });
  return out;
}

/** Display copy of the header rows of a table, drawn above a row (inside its first cell, which is positioned) at the top of a column. */
function headerOverlay(headers: HTMLTableRowElement[], width: number, height: number): HTMLElement {
  const table = document.createElement("table");
  table.className = "col-header";
  table.setAttribute("aria-hidden", "true");
  table.contentEditable = "false";
  table.style.cssText = `position:absolute;left:0;top:${-height}px;width:${width}px;margin:0;max-width:none;pointer-events:none;table-layout:fixed;`;
  const source = headers[0]?.closest("table");
  const colgroup = source?.querySelector("colgroup");
  if (colgroup) table.append(colgroup.cloneNode(true));
  const body = document.createElement("tbody");
  for (const row of headers) {
    const copy = row.cloneNode(true) as HTMLElement;
    copy.className = "";
    copy.removeAttribute("style");
    copy.removeAttribute("data-col-top");
    copy.removeAttribute("data-col-bottom");
    copy.querySelectorAll("[contenteditable]").forEach((n) => n.removeAttribute("contenteditable"));
    copy.querySelectorAll(".col-rowframe, .col-header, .col-frame, .pg-spacer").forEach((n) => n.remove());
    body.append(copy);
  }
  table.append(body);
  return table;
}

/** The frame of a shaded / bordered block inside a list item, for one run of its lines (relative to the list item's box). */
function unitFrame(look: { left: number; width: number; css: string }, dx: number, top: number, height: number): HTMLElement {
  return makeFrame("span", "col-frame", `${look.css};${boxCss(look.left + dx, top, look.width, height)}`);
}

/** One piece of a table cell inside a list item (relative to the item's box). */
function cellFrame(c: { left: number; width: number; bg: string; border: string }, dx: number, top: number, height: number): HTMLElement {
  return makeFrame("span", "col-frame", `${boxCss(c.left + dx, top, c.width, height)};${paintCss(c)}`);
}

/** The frames of the cells of a row, for one run of its lines (positions are relative to the row's first cell). */
function rowFrames(cells: NonNullable<AtomRef["cells"]>, left: number, top: number, height: number): HTMLElement {
  const box = makeFrame("div", "col-rowframe", "");
  for (const c of cells) box.append(makeFrame("div", "col-rowframe-cell", `${boxCss(left + c.left, top, c.width, height)};${paintCss(c)}`));
  return box;
}

/** A box at the place of a later run of lines, with the background and the borders of the paragraph it belongs to. */
function frame(source: HTMLElement, left: number, top: number, height: number): HTMLElement {
  const el = makeFrame("span", "col-frame", "");
  const st = source.style;
  for (const prop of [...FRAME_PROPS, "padding"] as const) if (st[prop]) el.style[prop] = st[prop];
  if (source.dataset.colQuote !== undefined || source.closest("blockquote")) el.classList.add("col-frame-quote");
  el.style.cssText += `;${boxCss(left, top, null, height)}`;
  return el;
}

/** Height a footnote takes at the bottom of a page of the width of each section (measured in a hidden copy of the note's style). */
function makeNoteMeasurer(view: EditorView, widths: number[], scale: number): { height: (note: Record<string, unknown>, section: number) => number; dispose: () => void } {
  const host = view.dom.parentElement;
  let probe: HTMLElement | null = null;
  const cache = new Map<string, number>();
  return {
    height(note, section) {
      const width = widths[Math.min(section, widths.length - 1)] ?? widths[0];
      const body = bodyOf(note as { body?: unknown; text?: unknown });
      const label = String(note.label || note.n || "1");
      const key = `${width}|${label}|${JSON.stringify(body)}`;
      const known = cache.get(key);
      if (known !== undefined) return known;
      if (!host) return 20;
      if (!probe) {
        probe = document.createElement("div");
        probe.className = "footnote-probe";
        probe.setAttribute("aria-hidden", "true");
        host.appendChild(probe);
      }
      probe.style.cssText = `position:absolute;visibility:hidden;left:-99999px;top:0;width:${width}px`;
      probe.replaceChildren(footnoteItem(label, body));
      const h = probe.getBoundingClientRect().height / scale;
      cache.set(key, h);
      return h;
    },
    dispose: () => probe?.remove(),
  };
}

/** One footnote as drawn (number and paragraphs); the stylesheet gives it its size. */
export function footnoteItem(label: string, body: NoteParagraph[]): HTMLElement {
  const item = document.createElement("div");
  item.className = "footnote-item";
  const num = document.createElement("span");
  num.className = "footnote-num";
  num.textContent = label;
  item.append(...renderBody(body, num));
  return item;
}

/** The footnotes of every page, from where their references really are on the page. */
function computePageNotes(view: EditorView, storage: Storage) {
  const sheets = paginationKey.getState(view.state)?.sheets ?? [];
  const next: Record<number, PageNote[]> = {};
  if (sheets.length) {
    const scale = storage.scale || 1;
    const origin = view.dom.getBoundingClientRect().top;
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === "endnotes") return false;
      if (node.type.name !== "footnote" || node.attrs.kind !== "foot") return true;
      const el = view.nodeDOM(pos);
      if (!(el instanceof HTMLElement)) return false;
      const y = (el.getBoundingClientRect().top - origin) / scale;
      let page = 0;
      sheets.forEach((s, i) => { if (s.top + s.insetTop <= y + 1) page = i; });
      (next[page] ??= []).push({ pos, label: String(node.attrs.label || node.attrs.n || "1"), body: bodyOf(node.attrs) });
      return false;
    });
  }
  // Footnotes that restart on each page are numbered here (the page of a reference is only known from the layout).
  const foot = notesOptionsOf(view.state.doc).foot;
  if (foot.restart === "page") {
    const fixes: Array<{ pos: number; n: number; label: string }> = [];
    for (const list of Object.values(next)) {
      list.forEach((note, i) => {
        const n = noteValue(foot, i);
        const label = formatNoteNumber(n, foot.format);
        note.label = label;
        const node = view.state.doc.nodeAt(note.pos);
        if (node && (node.attrs.label !== label || node.attrs.n !== n)) fixes.push({ pos: note.pos, n, label });
      });
    }
    if (fixes.length) {
      const tr = view.state.tr.setMeta("addToHistory", false);
      for (const f of fixes) tr.setNodeMarkup(f.pos, undefined, { ...view.state.doc.nodeAt(f.pos)!.attrs, n: f.n, label: f.label });
      queueMicrotask(() => { if (!view.isDestroyed) view.dispatch(tr); });
    }
  }
  // Notes that do not fit in the room of their page go on at the bottom of the next one (the engine kept the room).
  if (sheets.length) {
    const widths = storage.geometries.map((g) => g.width - g.insetLeft - g.insetRight);
    const measurer = makeNoteMeasurer(view, widths, storage.scale || 1);
    try {
      let queue: PageNote[] = [];
      const pages = Math.max(sheets.length, ...Object.keys(next).map((k) => +k + 1));
      for (let pg = 0; pg < pages; pg++) {
        const own = next[pg] ?? [];
        const items = [...queue, ...own];
        queue = [];
        if (!items.length) continue;
        const room = Math.max(0, (storage.pageReserved[pg] ?? 0) - FOOTNOTE_SEPARATOR);
        const shown: PageNote[] = [];
        let used = 0;
        for (const it of items) {
          const attrs = view.state.doc.nodeAt(it.pos)?.attrs ?? {};
          const full = measurer.height({ ...attrs, label: it.label }, sheets[Math.min(pg, sheets.length - 1)].section);
          const skip = it.skip ?? 0;
          const h = full - skip;
          if (queue.length === 0 && (used + h <= room + 1 || pg >= pages - 1)) { shown.push(skip ? { ...it, skip, clip: h } : it); used += h; continue; }
          const vis = queue.length === 0 ? Math.max(0, room - used) : 0;
          if (vis > 8) { shown.push({ ...it, skip, clip: vis }); used += vis; }
          queue.push({ ...it, skip: skip + vis });
        }
        next[pg] = shown;
      }
      if (queue.length) (next[pages - 1] ??= []).push(...queue);
    } finally {
      measurer.dispose();
    }
  }
  if (JSON.stringify(next) !== JSON.stringify(storage.pageNotes)) storage.pageNotes = next;
}

/** Position of the character under a point that lies on text moved by a column layout (`.col-shift` spans); null elsewhere. */
function shiftedPosAtCoords(view: EditorView, coords: { left: number; top: number }): { pos: number; inside: number } | null {
  const hit = document.elementsFromPoint(coords.left, coords.top).find((e) => e instanceof HTMLElement && e.classList.contains("col-shift") && e.tagName === "SPAN");
  if (!hit || !view.dom.contains(hit)) return null;
  const range = document.createRange();
  let best: { node: Text; offset: number; dist: number } | null = null;
  const walker = document.createTreeWalker(hit, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    range.selectNodeContents(n);
    if (!Array.from(range.getClientRects()).some((r) => coords.top >= r.top && coords.top <= r.bottom && coords.left >= r.left - 1 && coords.left <= r.right + 1)) continue;
    // The characters of a text node run line after line, top to bottom: look for the first one that is not above the point, then walk its line.
    const rectAt = (i: number) => { range.setStart(n, i); range.setEnd(n, i + 1); return range.getClientRects()[0]; };
    let lo = 0;
    let hi = n.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; const r = rectAt(mid); if (r && r.bottom < coords.top) lo = mid + 1; else hi = mid; }
    for (let i = lo; i < n.length; i++) {
      const r = rectAt(i);
      if (!r || r.width === 0) continue;
      if (r.top > coords.top) break;
      const dist = Math.abs(coords.left - (r.left + r.right) / 2);
      if (!best || dist < best.dist) best = { node: n, offset: coords.left > (r.left + r.right) / 2 ? i + 1 : i, dist };
    }
  }
  if (!best) return null;
  try { return { pos: view.posAtDOM(best.node, best.offset), inside: -1 }; } catch { return null; }
}

/**
 * Each top-level block gets the left and right margin of its section (CSS variables used by the stylesheet), so that sections
 * of different paper sizes have text areas of different widths. Single-geometry documents use the same mechanism.
 */
function sectionMargins(doc: import("@tiptap/pm/model").Node, geoms: PageGeometry[]): Decoration[] | null {
  if (!geoms.length) return null;
  const maxWidth = Math.max(...geoms.map((g) => g.width));
  const out: Decoration[] = [];
  let section = 0;
  doc.forEach((n, off) => {
    if (n.type.name === "sectionBreak") section++;
    const g = geoms[Math.min(section, geoms.length - 1)];
    const left = (maxWidth - g.width) / 2 + g.insetLeft;
    let right = (maxWidth - g.width) / 2 + g.insetRight;
    // With several columns the blocks are measured one column wide.
    if (g.columns && g.columns.count > 1) {
      const textW = g.width - g.insetLeft - g.insetRight;
      right += textW - (textW - (g.columns.count - 1) * g.columns.gap) / g.columns.count;
    }
    // Pictures in columns shrink to fit a column (width and height).
    let fit = "";
    if (g.columns && g.columns.count > 1) {
      const textW = g.width - g.insetLeft - g.insetRight;
      fit = `;--col-maxw:${+((textW - (g.columns.count - 1) * g.columns.gap) / g.columns.count).toFixed(2)}px;--col-maxh:${+(g.contentHeight - 8).toFixed(2)}px`;
    }
    out.push(Decoration.node(off, off + n.nodeSize, { style: `--sec-l:${+left.toFixed(2)}px;--sec-r:${+right.toFixed(2)}px${fit}`, ...(fit ? { "data-cols": "" } : {}) }));
  });
  return out;
}

function layout(view: EditorView, storage: Storage, done: () => void) {
  const geom = storage.geometry;
  if (!geom || view.isDestroyed || view.dom.getClientRects().length === 0) return; // not visible: redo when shown
  storage.dirty = false;
  const scale = storage.scale || 1;

  // Natural layout: hide the existing spacers while measuring (no repaint happens in between).
  view.dom.classList.add("pg-measuring");
  let result;
  let refs;
  let atoms;
  try {
    const origin = view.dom.getBoundingClientRect().top;
    const geoms = storage.geometries.length ? storage.geometries : [geom];
    const notes = makeNoteMeasurer(view, geoms.map((g) => g.width - g.insetLeft - g.insetRight), scale);
    try {
      ({ atoms, refs } = collectAtoms(view, origin, scale, storage.geometries.map((g) => !!g.columns && g.columns.count > 1), notes.height));
      result = paginate(atoms, storage.geometries.length ? storage.geometries : geom);
    } finally {
      notes.dispose();
    }
  } finally {
    view.dom.classList.remove("pg-measuring");
  }

  storage.pageReserved = result.reserved;
  storage.pageStarts = refs.map((r, i) => ({ pos: r.pos, page: result.startPage[i] ?? 0 })).sort((a, b) => a.pos - b.pos);

  // Merge breaks that land on the same position, and remember where each moved block must end up.
  const merged = new Map<string, { pos: number; kind: "block" | "inline" | "row"; spacer: number; columns: number; target: number; headers: HTMLTableRowElement[]; region?: { margin: number; pages: number } }>();
  let offset = 0;
  for (const b of result.breaks) {
    offset += b.net ?? b.spacer;
    const ref = refs[b.atom];
    const lines = b.line !== null ? atoms[b.atom].lines?.() : null;
    // The spacer of a column region goes before the table, not between its rows (the rows are drawn out of the flow).
    const inTable = !!b.region && !!ref.table;
    const pos = inTable ? ref.table!.pos : b.line === null ? ref.pos : ref.lineStarts[b.line];
    if (pos === undefined) continue;
    const kind = b.line !== null ? "inline" : ref.kind === "row" && !inTable ? "row" : "block";
    const natural = b.line !== null && lines ? lines[b.line].top : atoms[b.atom].top;
    const key = `${kind}:${pos}`;
    const prev = merged.get(key);
    merged.set(key, { pos, kind, spacer: (prev?.spacer ?? 0) + b.spacer, columns: ref.columns, target: natural + offset, headers: b.repeat ? ref.headers : [], ...(b.region ? { region: b.region } : {}) });
  }

  const widgets = [...merged.values()].flatMap((m) => [
    Decoration.widget(m.pos, () => spacer(m.kind, m.spacer, m.target, m.columns, m.headers.length > 0, m.region), {
      side: -2 - m.headers.length,
      key: `pg:${m.kind}:${m.pos}:${m.spacer.toFixed(1)}:${m.target.toFixed(1)}:${m.headers.length}${m.region ? `:r${m.region.margin.toFixed(1)}:${m.region.pages}` : ""}`,
      kind: m.kind,
      spacer: m.spacer,
      target: m.target,
      ignoreSelection: true,
      stopEvent: () => true,
    }),
    // Repeated header rows, drawn after the gap (display copies, not part of the document).
    ...m.headers.map((h, k) =>
      Decoration.widget(m.pos, () => headerCopy(h), {
        side: -1 - m.headers.length + k,
        key: `pg:h${k}:${m.pos}:${h.textContent}`,
        kind: "header",
        spacer: 0,
        target: 0,
        ignoreSelection: true,
        stopEvent: () => true,
      }),
    ),
  ]);
  // The blocks of the columns: each one is drawn at its column slot (CSS variables, see the stylesheet).
  const doc = view.state.doc;
  const blockDecos: Decoration[] = [];
  const boxes = new Set<number>();
  const sheetOf = (page: number) => result.sheets[Math.min(page, result.sheets.length - 1)];
  const sub = (pages: number) => (pages ? ` - ${pages} * var(--pg-print-sub, 0px)` : "");
  const firstRow = new Map<number, number>(); // table position -> atom index of its first row
  // Rows that end a column and rows that start the next one (an "outer border" table draws its top and bottom edges there).
  const edgeTop = new Set<number>();
  const edgeBottom = new Set<number>();
  result.placements.forEach((pl, i) => {
    const prev = result.placements[i - 1];
    if (pl && prev && refs[i]?.table && refs[i - 1]?.table?.pos === refs[i].table!.pos && (pl.page !== prev.page || Math.round(pl.x) !== Math.round(prev.x))) { edgeTop.add(i); edgeBottom.add(i - 1); }
  });
  result.placements.forEach((pl, i) => {
    if (!pl) return;
    const ref = refs[i];
    const pos = ref?.pos;
    const node = pos === undefined ? null : doc.nodeAt(pos);
    if (!node) return;
    const sheet = sheetOf(pl.page);
    // A table row of a column section: the table sits at the slot of its first row, every other row is moved by its own offset.
    if (ref.table) {
      const tpos = ref.table.pos;
      if (edgeTop.has(i) || edgeBottom.has(i)) blockDecos.push(Decoration.node(pos, pos + node.nodeSize, { ...(edgeTop.has(i) ? { "data-col-top": "" } : {}), ...(edgeBottom.has(i) ? { "data-col-bottom": "" } : {}) }));
      if (ref.table.first) {
        firstRow.set(tpos, i);
        if (pl.frags && pl.frags.length > 1) { blockDecos.push(Decoration.node(pos, pos + node.nodeSize, { class: "col-rowcut" })); blockDecos.push(...fragmentDecos(atoms[i], ref, pl, pos, node.nodeSize, sub, false, ref.cells)); }
        const table = doc.nodeAt(tpos);
        if (table) {
          const y = pl.y - (atoms[i].top - ref.table.top);
          blockDecos.push(Decoration.node(tpos, tpos + table.nodeSize, { "data-col": "", "data-col-table": "", style: `--col-x:${+(sheet.left + sheet.insetLeft + pl.x).toFixed(2)}px;--col-y:calc(${+y.toFixed(2)}px${sub(pl.page)});--col-w:${+pl.width.toFixed(2)}px` }));
        }
      } else {
        const j = firstRow.get(tpos);
        const p0 = j === undefined ? null : result.placements[j];
        if (j !== undefined && p0) {
          const dx = pl.x - p0.x;
          const dy = pl.y - p0.y - (atoms[i].top - atoms[j].top);
          const cutRow = !!pl.frags && pl.frags.length > 1;
          const shiftStyle = `--sx:${+dx.toFixed(2)}px;--sy:calc(${+dy.toFixed(2)}px${sub(pl.page - p0.page)})`;
          blockDecos.push(Decoration.node(pos, pos + node.nodeSize, { class: `col-shift${cutRow ? " col-rowcut" : ""}`, style: shiftStyle }));
          // The rows covered by a cell that spans rows move with it.
          for (const gp of ref.groupRows ?? []) { const covered = doc.nodeAt(gp); if (covered) blockDecos.push(Decoration.node(gp, gp + covered.nodeSize, { class: "col-shift", style: shiftStyle })); }
          blockDecos.push(...fragmentDecos(atoms[i], ref, pl, pos, node.nodeSize, sub, false, ref.cells));
          // The table goes on at the top of a column: its header rows are shown again above this row.
          if (pl.header && ref.headers.length) {
            blockDecos.push(overlayWidget(pos + 2, -4, `colhead:${pos}:${pl.header!.toFixed(1)}:${ref.headers.map((h) => h.textContent).join("|")}`, () => headerOverlay(ref.headers, ref.table!.width, pl.header!)));
          }
        }
      }
      return;
    }
    // Left and right indents of a paragraph come out of the width of its box (its margins are kept).
    const ind = (node.attrs.indentLeft || 0) + (node.attrs.indentRight || 0);
    const lead = ref?.indent ?? 0; // list items: the indent of their (flattened) list
    const width = Math.max(24, pl.width - lead - ind * (96 / 2.54));
    // The container of a list item or of a quote paragraph is not drawn any more: it only passes its children through.
    if (ref?.inContainer) {
      const $p = doc.resolve(pos);
      const cpos = $p.before($p.depth);
      if (!boxes.has(cpos)) { boxes.add(cpos); blockDecos.push(Decoration.node(cpos, cpos + $p.parent.nodeSize, { "data-col-box": "" })); }
    }
    const vars = [`--col-x:${+(sheet.left + sheet.insetLeft + pl.x + lead).toFixed(2)}px`, `--col-y:calc(${+pl.y.toFixed(2)}px${sub(pl.page)})`, `--col-w:${+width.toFixed(2)}px`];
    const cut = pl.frags && pl.frags.length > 1 ? pl.frags : null;
    if (cut) {
      // The box keeps the first run of lines; every later run is moved (relative offset of its text) to its own column or page.
      const lines = atoms[i].lines?.() ?? [];
      if (lines[cut[0].to - 1]) vars.push(`--col-h:${+(lines[cut[0].to - 1].bottom - atoms[i].top).toFixed(2)}px`);
      const framed = ref.inContainer === "quote" || FRAME_PROPS.some((p) => ref.el.style[p]);
      blockDecos.push(...fragmentDecos(atoms[i], ref, pl, pos, node.nodeSize, sub, framed));
    }
    blockDecos.push(Decoration.node(pos, pos + node.nodeSize, { "data-col": "", ...(ref?.inContainer === "quote" ? { "data-col-quote": "" } : {}), ...(cut ? { "data-col-cut": "" } : {}), style: vars.join(";") }));
  });
  const decos = DecorationSet.create(view.state.doc, [...widgets, ...blockDecos]);
  const signature = `${signatureOf(result.pages, decos)}|${JSON.stringify(result.sheets.map((s) => [Math.round(s.top * 10), s.width, s.height, s.section]))}|${JSON.stringify(result.placements.map((p) => p && [p.page, Math.round(p.x), Math.round(p.y), Math.round(p.width), p.frags?.map((f) => [f.from, f.page, Math.round(f.x), Math.round(f.y)]) ?? 0]))}|${JSON.stringify(result.bands.map((b) => [b.page, Math.round(b.top), Math.round(b.height)]))}`;
  const current = paginationKey.getState(view.state);
  if (current?.signature === signature && current.pages === result.pages) { window.dispatchEvent(new Event("loma:layout")); done(); return; }
  view.dispatch(view.state.tr.setMeta(paginationKey, { decos, pages: result.pages, sheets: result.sheets, bands: result.bands, signature }).setMeta("addToHistory", false));
  storage.onLayout?.(result.pages);
  window.dispatchEvent(new Event("loma:layout"));
  done();
}

/**
 * Margins and rounding make the real layout differ by a few pixels from the model. Each spacer is nudged so
 * the first line of every page lands exactly on the page's content top.
 */
function verify(view: EditorView, storage: Storage) {
  if (view.isDestroyed || !storage.geometry || view.dom.getClientRects().length === 0) return;
  const scale = storage.scale || 1;
  const origin = view.dom.getBoundingClientRect().top;
  view.dom.querySelectorAll<HTMLElement>(".pg-spacer:not(.pg-header):not([data-region])").forEach((el) => {
    const target = origin + +(el.dataset.target ?? 0) * scale;
    let next = el.classList.contains("pg-block") ? (el.nextElementSibling as HTMLElement | null) : null;
    if (el.dataset.repeats) { // the row follows the repeated header copies
      let n = el.nextElementSibling as HTMLElement | null;
      while (n?.classList.contains("pg-header")) n = n.nextElementSibling as HTMLElement | null;
      next = n;
    }
    const actual = next ? next.getBoundingClientRect().top : el.getBoundingClientRect().bottom;
    const delta = (target - actual) / scale;
    if (Math.abs(delta) > 0.5) setHeight(el, Math.max(0, +(el.dataset.h ?? 0) + delta));
  });
  computePageNotes(view, storage);
  window.dispatchEvent(new Event("loma:layout")); // free shapes follow their anchor
}
