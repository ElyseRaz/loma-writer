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

/** Builds the print copies; returns a function that removes them. Does nothing (returns null) when every sheet has the same size. */
export function prepareSectionPrint(): (() => void) | null {
  const stack = document.querySelector<HTMLElement>(".page-stack");
  const sheets = Array.from(document.querySelectorAll<HTMLElement>(".page-sheet"));
  if (!stack || sheets.length < 2 || !hasMixedSizes()) return null;

  const boxes: SheetBox[] = sheets.map((s) => ({ section: `${s.offsetWidth}x${s.offsetHeight}`, left: s.offsetLeft, width: s.offsetWidth, height: s.offsetHeight }));
  // Runs of consecutive sheets of the same size.
  const runs: Array<{ key: string; from: number; to: number }> = [];
  boxes.forEach((b, i) => {
    const last = runs[runs.length - 1];
    if (last && last.key === b.section) last.to = i;
    else runs.push({ key: b.section, from: i, to: i });
  });
  const names = new Map<string, string>();
  runs.forEach((r) => { if (!names.has(r.key)) names.set(r.key, `ps${names.size}`); });

  const style = document.createElement("style");
  style.id = STYLE;
  style.textContent = [
    ...[...names].map(([key, name]) => { const [w, h] = key.split("x"); return `@page ${name} { size: ${w}px ${h}px; margin: 0; }`; }),
    `#${ROOT} { display: none; }`,
    `@media print { body > *:not(#${ROOT}):not(#${STYLE}) { display: none !important; } #${ROOT} { display: block !important; } #${ROOT} .print-run { position: relative; overflow: hidden; break-inside: auto; } #${ROOT} .page-stack { position: absolute !important; transform: none !important; margin: 0 !important; } }`,
  ].join("\n");

  const root = document.createElement("div");
  root.id = ROOT;
  let sheetTop = 0; // in print the gaps between sheets do not exist: sheets are contiguous
  const tops = boxes.map((b) => { const t = sheetTop; sheetTop += b.height; return t; });
  runs.forEach((run, i) => {
    const first = boxes[run.from];
    const height = boxes.slice(run.from, run.to + 1).reduce((s, b) => s + b.height, 0);
    const holder = document.createElement("div");
    holder.className = "print-run";
    holder.style.cssText = `page: ${names.get(run.key)}; width: ${first.width}px; height: ${height}px;${i > 0 ? " break-before: page;" : ""}`;
    const copy = stack.cloneNode(true) as HTMLElement;
    copy.removeAttribute("id");
    copy.querySelectorAll("[contenteditable]").forEach((e) => e.removeAttribute("contenteditable"));
    // The general print rules pin the stack at the origin with !important: the shift has to be as strong.
    copy.style.setProperty("inset", "auto", "important");
    copy.style.setProperty("left", `${-first.left}px`, "important");
    copy.style.setProperty("top", `${-tops[run.from]}px`, "important");
    holder.append(copy);
    root.append(holder);
  });
  document.head.append(style);
  document.body.append(root);
  return () => { root.remove(); style.remove(); };
}

let cleanup: (() => void) | null = null;

/** Installs the `beforeprint` / `afterprint` hooks (any way of printing goes through them). */
export function installSectionPrint(): () => void {
  const before = () => { cleanup?.(); cleanup = prepareSectionPrint(); };
  const after = () => { cleanup?.(); cleanup = null; };
  window.addEventListener("beforeprint", before);
  window.addEventListener("afterprint", after);
  return () => { window.removeEventListener("beforeprint", before); window.removeEventListener("afterprint", after); after(); };
}
