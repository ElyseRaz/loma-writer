/**
 * Printing a document whose sections have different paper sizes.
 *
 * A print job normally has one `@page` size, and the editor prints its page stack as one tall column cut into equal pages. With
 * several sizes, each size gets a named page (`@page ps1 { size … }`) and each run of sheets of one size is printed from its own
 * copy of the stack, shifted and clipped to show only those sheets: the browser then starts a new page of the right size at each
 * change of name. The copies exist only while the print job runs.
 */

const ROOT = "loma-print-root";
const STYLE = "loma-print-sections";

interface SheetBox {
  section: string;
  left: number;
  width: number;
  height: number;
}

/** True when the sheets on screen do not all have the same size. */
export function hasMixedSizes(): boolean {
  const sizes = new Set<string>();
  document.querySelectorAll<HTMLElement>(".page-sheet").forEach((s) => sizes.add(`${s.offsetWidth}x${s.offsetHeight}`));
  return sizes.size > 1;
}

const A4 = { w: 794, h: 1123 };
let hintShown = false;

/**
 * WebKitGTK (the desktop app's engine) ignores `@page { size }`: the paper comes from the print dialog, A4 by default. A warning for
 * the documents that would not fit it (another paper size, or several sizes), null when nothing is to be said.
 */
export function paperWarning(): string | null {
  const webkit = /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium/.test(navigator.userAgent);
  if (!webkit) return null;
  const sheets = Array.from(document.querySelectorAll<HTMLElement>(".page-sheet"));
  if (!sheets.length) return null;
  const notA4 = sheets.some((s) => Math.abs(s.offsetWidth - A4.w) > 2 || Math.abs(s.offsetHeight - A4.h) > 2);
  if (notA4) {
    return hasMixedSizes()
      ? "Ce document mélange plusieurs formats de papier : la boîte d'impression n'en propose qu'un. Pour un résultat exact, exportez en PDF ou imprimez chaque section à part."
      : "Le format du document n'est pas l'A4 : choisissez le même format de papier dans la boîte d'impression, sinon les pages seront décalées (ou exportez en PDF).";
  }
  // An A4 document is only cut by a paper that is shorter than A4 (Letter): said once per session.
  if (hintShown) return null;
  hintShown = true;
  return "Impression : choisissez le papier A4 dans la boîte d'impression ; un papier plus court (Letter) coupe les pages.";
}

/** Gap removed under each page break on paper (keep in step with `--pg-print-sub` in the stylesheet). */
export const PRINT_SUB = 24;
/** A table with more rows than this is copied row by row (only the rows near the sheet). */
const LONG_TABLE = 40;
/** Blocks this far (px) from a sheet are not copied into its page. */
const WINDOW = 400;

/** What the copy needs to know about a top-level block of the text, measured once for all the sheets. */
interface BlockInfo {
  el: HTMLElement;
  /** Vertical ranges (stack px) of the block, or of its children when it has no box of its own (display: contents), and of its floating pictures and shapes. */
  ranges: Array<[number, number]>;
  /** Drawn out of the flow (absolute, or display: contents): nothing has to hold its place. */
  outOfFlow: boolean;
  /** A long table: where each of its rows is (a table is one block, but it spans many sheets: only the rows near a sheet are copied for it). */
  rows?: Array<{ el: HTMLElement; range: [number, number]; height: number; cells: number; keep: boolean }>;
  /** Height of the empty box that replaces it on paper (page-break spacers inside it are shorter there). */
  paperHeight: number;
}

function measureBlocks(stack: HTMLElement, pm: HTMLElement): Map<Node, BlockInfo> {
  const stackBox = stack.getBoundingClientRect();
  const k = stack.offsetWidth ? stackBox.width / stack.offsetWidth || 1 : 1;
  const range = (r: DOMRect): [number, number] => [(r.top - stackBox.top) / k, (r.bottom - stackBox.top) / k];
  const infos = new Map<Node, BlockInfo>();
  for (const child of Array.from(pm.children)) {
    if (!(child instanceof HTMLElement) || child.classList.contains("pg-spacer")) continue;
    const cs = getComputedStyle(child);
    const contents = cs.display === "contents";
    const own = contents ? Array.from(child.children).map((c) => range(c.getBoundingClientRect())) : [range(child.getBoundingClientRect())];
    // A picture or a shape that floats is drawn where its page says, which may be far from its anchor block.
    const floating = Array.from(child.querySelectorAll<HTMLElement>(".shape-box, .img-box")).map((e) => range(e.getBoundingClientRect()));
    const sub = Array.from(child.querySelectorAll<HTMLElement>(".pg-spacer")).reduce((n, sp) => n + (parseFloat(sp.style.getPropertyValue("--k")) || 1) * PRINT_SUB, 0);
    const trs = Array.from(child.querySelectorAll<HTMLTableRowElement>(":scope > table > tbody > tr, :scope > table > thead > tr, :scope > table > tr"));
    // Rows of a column section are moved by their cells (WebKit ignores an offset on the row itself): the cells say where the row is drawn.
    const rows = trs.length > LONG_TABLE ? trs.map((tr) => { const at = (tr.classList.contains("col-shift") && tr.cells[0] ? tr.cells[0] : tr).getBoundingClientRect(); return { el: tr, range: range(at), height: tr.getBoundingClientRect().height / k, cells: tr.cells.length || 1, keep: tr.classList.contains("pg-spacer") || tr.classList.contains("pg-header") }; }) : undefined;
    infos.set(child, { el: child, ...(rows ? { rows } : {}), ranges: [...own, ...floating], outOfFlow: cs.position === "absolute" || contents, paperHeight: Math.max(0, (own[0][1] - own[0][0]) - sub) });
  }
  return infos;
}

/** Copy of a long table: the rows that can show on the sheet are copied, the others become an empty row of the same height. */
function cloneLongTable(info: BlockInfo, window0: number, window1: number): HTMLElement {
  const byEl = new Map((info.rows ?? []).map((r) => [r.el, r] as const));
  const near = new Set((info.rows ?? []).filter((r) => r.keep || (r.range[1] >= window0 && r.range[0] <= window1)).map((r) => r.el));
  const copy = (node: Node): Node => {
    if (!(node instanceof HTMLElement)) return node.cloneNode(true);
    if (node instanceof HTMLTableRowElement) {
      if (near.has(node)) return node.cloneNode(true);
      const row = byEl.get(node);
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = row?.cells ?? 1;
      td.style.cssText = `padding:0;border:0;box-shadow:none;height:${(row?.height ?? 0).toFixed(2)}px`;
      tr.append(td);
      return tr;
    }
    const clone = node.cloneNode(false) as HTMLElement;
    node.childNodes.forEach((c) => clone.append(copy(c)));
    return clone;
  };
  return copy(info.el) as HTMLElement;
}

/**
 * Copy of the page stack for one sheet. Only what can show on that sheet is copied: the sheets of other pages are left out, and the
 * top-level blocks of the text far above or below are replaced by an empty box of the same height (so everything else keeps its
 * place) or dropped when they are drawn out of the flow. Copying the whole document once per page would be quadratic.
 */
function copyForSheet(stack: HTMLElement, blocks: Map<Node, BlockInfo>, pm: HTMLElement | null, sheetIndex: number, window0: number, window1: number): HTMLElement {
  const sheets = Array.from(stack.querySelectorAll<HTMLElement>(".page-sheet"));
  const copyNode = (node: Node): Node | null => {
    if (!(node instanceof HTMLElement)) return node.cloneNode(true);
    if (node.classList.contains("page-sheet") && sheets.indexOf(node) !== sheetIndex) return null;
    const clone = node.cloneNode(false) as HTMLElement;
    const kids = Array.from(node.childNodes);
    if (node === pm) {
      for (const child of kids) {
        const info = blocks.get(child);
        if (!info) { clone.append(child.cloneNode(true)); continue; }
        if (info.ranges.some(([top, bottom]) => bottom >= window0 && top <= window1)) { clone.append(info.rows ? cloneLongTable(info, window0, window1) : child.cloneNode(true)); continue; }
        if (info.outOfFlow) continue;
        const box = document.createElement(info.el.tagName);
        box.className = info.el.className;
        box.setAttribute("style", info.el.getAttribute("style") ?? "");
        box.style.cssText += `;height:${info.paperHeight.toFixed(2)}px;box-sizing:border-box;overflow:hidden;padding-top:0;padding-bottom:0;border-top-width:0;border-bottom-width:0`;
        clone.append(box);
      }
      return clone;
    }
    for (const child of kids) { const c = copyNode(child); if (c) clone.append(c); }
    return clone;
  };
  return copyNode(stack) as HTMLElement;
}

/** Builds the print copies (one page holder per sheet); returns a function that removes them. */
export function prepareSectionPrint(): (() => void) | null {
  const stack = document.querySelector<HTMLElement>(".page-stack");
  const sheets = Array.from(document.querySelectorAll<HTMLElement>(".page-sheet"));
  if (!stack || sheets.length < 1) return null; // every document prints through the copies: the live stack is pinned at the origin and would give a single page

  const boxes: SheetBox[] = sheets.map((s) => ({ section: `${s.offsetWidth}x${s.offsetHeight}`, left: s.offsetLeft, width: s.offsetWidth, height: s.offsetHeight }));
  const names = new Map<string, string>();
  boxes.forEach((b) => { if (!names.has(b.section)) names.set(b.section, `ps${names.size}`); });

  const style = document.createElement("style");
  style.id = STYLE;
  style.textContent = [
    ...[...names].map(([key, name]) => { const [w, h] = key.split("x"); return `@page ${name} { size: ${w}px ${h}px; margin: 0; }`; }),
    `#${ROOT} { display: none; }`,
    `@media print { body > *:not(#${ROOT}):not(#${STYLE}) { display: none !important; } #${ROOT} { display: block !important; } #${ROOT} .print-run { position: relative; overflow: hidden; break-inside: avoid; isolation: isolate; } #${ROOT} .page-stack { position: absolute !important; transform: none !important; margin: 0 !important; } }`,
  ].join("\n");

  const root = document.createElement("div");
  root.id = ROOT;
  const pm = stack.querySelector<HTMLElement>(".ProseMirror");
  const blocks = pm ? measureBlocks(stack, pm) : new Map<Node, BlockInfo>();
  const stackBox = stack.getBoundingClientRect();
  const k = stack.offsetWidth ? stackBox.width / stack.offsetWidth || 1 : 1;
  let sheetTop = 0; // in print the gaps between sheets do not exist: sheets are contiguous
  boxes.forEach((box, i) => {
    const top = sheetTop;
    sheetTop += box.height;
    // One holder per sheet = one page: each page is placed exactly, whatever the printer's page height rounds to (a single tall holder
    // drifts by a pixel or so per page, and ends with an empty page). It is a little shorter than the sheet for the same reason.
    const holder = document.createElement("div");
    holder.className = "print-run";
    holder.style.cssText = `width: ${box.width}px; height: ${box.height - 2}px`;
    const sheetScreenTop = (sheets[i].getBoundingClientRect().top - stackBox.top) / k; // same base as the block ranges
    const copy = copyForSheet(stack, blocks, pm, i, sheetScreenTop - WINDOW, sheetScreenTop + box.height + WINDOW);
    copy.removeAttribute("id");
    copy.querySelectorAll("[contenteditable]").forEach((e) => e.removeAttribute("contenteditable"));
    copy.querySelectorAll("[id]").forEach((e) => e.removeAttribute("id")); // the live page keeps its ids (bookmarks, anchors)
    // The general print rules pin the stack at the origin with !important: the shift has to be as strong.
    copy.style.setProperty("inset", "auto", "important");
    copy.style.setProperty("left", `${-box.left}px`, "important");
    copy.style.setProperty("top", `${-top}px`, "important");
    holder.append(copy);
    holder.style.cssText += `;page: ${names.get(box.section)};${i > 0 ? " break-before: page;" : ""}`;
    root.append(holder);
  });
  document.head.append(style);
  document.body.append(root);
  return () => { root.remove(); style.remove(); };
}

let cleanup: (() => void) | null = null;

/** Installs the `beforeprint` / `afterprint` hooks (any way of printing goes through them). */
export function installSectionPrint(): () => void {
  const before = () => {
    cleanup?.();
    try { cleanup = prepareSectionPrint(); } catch { cleanup = null; } // on failure the page is printed as it is, rather than not at all
  };
  const after = () => { cleanup?.(); cleanup = null; };
  window.addEventListener("beforeprint", before);
  window.addEventListener("afterprint", after);
  return () => { window.removeEventListener("beforeprint", before); window.removeEventListener("afterprint", after); after(); };
}
