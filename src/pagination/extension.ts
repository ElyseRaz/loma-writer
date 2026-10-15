import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Editor } from "@tiptap/react";
import { paginate } from "./engine";
import { collectAtoms } from "./measure";
import type { Band, PageGeometry, Sheet } from "./model";

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
    return { geometry: null, geometries: [], scale: 1, dirty: false };
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
    out.push(Decoration.node(off, off + n.nodeSize, { style: `--sec-l:${+left.toFixed(2)}px;--sec-r:${+right.toFixed(2)}px` }));
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
    ({ atoms, refs } = collectAtoms(view, origin, scale, storage.geometries.map((g) => !!g.columns && g.columns.count > 1)));
    result = paginate(atoms, storage.geometries.length ? storage.geometries : geom);
  } finally {
    view.dom.classList.remove("pg-measuring");
  }

  // Merge breaks that land on the same position, and remember where each moved block must end up.
  const merged = new Map<string, { pos: number; kind: "block" | "inline" | "row"; spacer: number; columns: number; target: number; headers: HTMLTableRowElement[]; region?: { margin: number; pages: number } }>();
  let offset = 0;
  for (const b of result.breaks) {
    offset += b.net ?? b.spacer;
    const ref = refs[b.atom];
    const lines = b.line !== null ? atoms[b.atom].lines?.() : null;
    const pos = b.line === null ? ref.pos : ref.lineStarts[b.line];
    if (pos === undefined) continue;
    const kind = b.line !== null ? "inline" : ref.kind === "row" ? "row" : "block";
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
  result.placements.forEach((pl, i) => {
    if (!pl) return;
    const pos = refs[i]?.pos;
    const node = pos === undefined ? null : doc.nodeAt(pos);
    if (!node) return;
    const sheet = result.sheets[Math.min(pl.page, result.sheets.length - 1)];
    // Left and right indents of a paragraph come out of the width of its box (its margins are kept).
    const ind = (node.attrs.indentLeft || 0) + (node.attrs.indentRight || 0);
    const lead = refs[i]?.indent ?? 0; // list items: the indent of their (flattened) list
    const width = Math.max(24, pl.width - lead - ind * (96 / 2.54));
    // The container of a list item or of a quote paragraph is not drawn any more: it only passes its children through.
    if (refs[i]?.inContainer) {
      const $p = doc.resolve(pos);
      const cpos = $p.before($p.depth);
      if (!boxes.has(cpos)) { boxes.add(cpos); blockDecos.push(Decoration.node(cpos, cpos + $p.parent.nodeSize, { "data-col-box": "" })); }
    }
    const vars = [`--col-x:${+(sheet.left + sheet.insetLeft + pl.x + lead).toFixed(2)}px`, `--col-y:calc(${+pl.y.toFixed(2)}px - ${pl.page} * var(--pg-print-sub, 0px))`, `--col-w:${+width.toFixed(2)}px`];
    if (pl.split) vars.push(`--col-m:${pl.split.columns}`, `--col-gap:${+pl.split.gap.toFixed(2)}px`, `--col-h:${+pl.split.height.toFixed(2)}px`, `--col-off:${+pl.split.offset.toFixed(2)}px`);
    blockDecos.push(Decoration.node(pos, pos + node.nodeSize, { "data-col": "", ...(refs[i]?.inContainer === "quote" ? { "data-col-quote": "" } : {}), ...(pl.split ? { "data-col-split": "" } : {}), style: vars.join(";") }));
  });
  const decos = DecorationSet.create(view.state.doc, [...widgets, ...blockDecos]);
  const signature = `${signatureOf(result.pages, decos)}|${JSON.stringify(result.sheets.map((s) => [Math.round(s.top * 10), s.width, s.height, s.section]))}|${JSON.stringify(result.placements.map((p) => p && [p.page, Math.round(p.x), Math.round(p.y), Math.round(p.width), p.split?.columns ?? 0]))}|${JSON.stringify(result.bands.map((b) => [b.page, Math.round(b.top), Math.round(b.height)]))}`;
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
  window.dispatchEvent(new Event("loma:layout")); // free shapes follow their anchor
}
