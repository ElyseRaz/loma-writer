import { useLayoutEffect, useRef } from "react";
import { pickHeaderFooter, sectionFor, type HeaderFooterContent, type HeaderFooterSettings, type SectionLayout } from "../../pagination/headerFooter";
import type { Watermark } from "../../editor/watermark";
import { PAGE_GAP, type Band, type PageGeometry, type Sheet } from "../../pagination/model";
import { displayedNumbers, formatPageNumber } from "../../pagination/pageNumber";
import { headerFooterHtml, withPageNumbers } from "../../services/headerFooterHtml";

export interface HeaderFooterHeights {
  header: number;
  footer: number;
}

const sideStyle = (g: { insetLeft: number; insetRight: number }) => ({ left: g.insetLeft, right: g.insetRight });

/** The part of the document a sheet belongs to: its paper and its headers and footers. */
export interface SheetSection {
  page: import("../../state/types").PageSetup;
  hf: HeaderFooterSettings;
}

/** Hidden copy of every header/footer variant of a section, to know how much room the page layout must reserve. */
function Measure({ section, geometry, onHeights }: { section: SectionLayout; geometry: PageGeometry; onHeights: (h: HeaderFooterHeights) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const variants = (set: SectionLayout["header"]) => (["default", "first", "even"] as const).map((k) => set[k]).filter(Boolean) as HeaderFooterContent[];
  const sig = JSON.stringify([section.header, section.footer, geometry.width, geometry.insetLeft, geometry.insetRight]);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const max = (kind: string) => Math.max(0, ...Array.from(el.querySelectorAll<HTMLElement>(`[data-kind="${kind}"]`)).map((n) => n.offsetHeight));
    onHeights({ header: max("header"), footer: max("footer") });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return (
    <div ref={root} aria-hidden className="hf hf-body" style={{ position: "absolute", visibility: "hidden", pointerEvents: "none", left: 0, top: 0, width: geometry.width - geometry.insetLeft - geometry.insetRight, marginLeft: geometry.insetLeft }}>
      {(["header", "footer"] as const).flatMap((kind) => variants(section[kind]).map((c, i) => <div key={`${kind}${i}`} data-kind={kind} dangerouslySetInnerHTML={{ __html: withPageNumbers(headerFooterHtml(c.blocks), 88, 88) }} />))}
    </div>
  );
}

/** Corner marks at the corners of the text area (like Word's "Afficher les limites du texte"): they are not part of the document and are not printed. */
function TextBounds({ geometry: g }: { geometry: { width: number; height: number; insetLeft: number; insetRight: number; insetTop: number; insetBottom: number } }) {
  const L = Math.min(14, g.insetLeft, g.insetTop);
  const mark = (x: number, y: number, right: boolean, bottom: boolean) => (
    <span
      className="page-bound"
      style={{ position: "absolute", left: right ? undefined : x, right: right ? g.width - x : undefined, top: bottom ? undefined : y, bottom: bottom ? g.height - y : undefined, width: L, height: L,
        [right ? "borderRight" : "borderLeft"]: "1px solid", [bottom ? "borderBottom" : "borderTop"]: "1px solid" }}
    />
  );
  const l = g.insetLeft, r = g.width - g.insetRight, t = g.insetTop, b = g.height - g.insetBottom;
  return <div aria-hidden data-bounds className="pointer-events-none absolute inset-0">{mark(l, t, false, false)}{mark(r, t, true, false)}{mark(l, b, false, true)}{mark(r, b, true, true)}</div>;
}

/** The watermark, centred on the sheet, behind the text; it is part of the page, so it prints. */
function WatermarkMark({ watermark: w }: { watermark: Watermark }) {
  return (
    <div aria-hidden data-watermark className="pointer-events-none absolute inset-0 flex select-none items-center justify-center overflow-hidden">
      <span style={{ fontSize: `${w.size}pt`, fontWeight: 700, whiteSpace: "nowrap", color: w.color, opacity: w.opacity, transform: w.layout === "diagonal" ? "rotate(-45deg)" : "none", fontFamily: '"Calibri", "Carlito", sans-serif', lineHeight: 1 }}>{w.text}</span>
    </div>
  );
}

/**
 * The white sheets drawn behind the text, one per page, with their header and footer. Each sheet has the size of its section; the
 * HTML comes from the editor schema (never from raw user markup).
 */
export function PageSheets({ sheets, sections, geometries, onHeights, bounds = true, watermark = null, bands = [] }: {
  sheets: Sheet[];
  sections: SheetSection[];
  /** Geometry of each section (used to measure its header and footer). */
  geometries: PageGeometry[];
  /** Measured header/footer heights, one entry per section. */
  onHeights: (index: number, h: HeaderFooterHeights) => void;
  bounds?: boolean;
  watermark?: Watermark | null;
  /** Vertical rules between columns (engine coordinates, like the sheets). */
  bands?: Band[];
}) {
  const pages = sheets.length;
  let sumHeights = 0;
  // Displayed page numbers: a section may restart them and show them in roman numerals or letters.
  const numbers = displayedNumbers(sheets, sections.map((s) => s.page.numberStart));
  return (
    <>
      {sections.map((sec, i) => <Measure key={i} section={sectionFor(sec.page, sec.hf)} geometry={geometries[Math.min(i, geometries.length - 1)]} onHeights={(h) => onHeights(i, h)} />)}
      {sheets.map((sheet, i) => {
        const sec = sections[Math.min(sheet.section, sections.length - 1)];
        const layout = sectionFor(sec.page, sec.hf);
        const shown = formatPageNumber(numbers[i], sec.page.numberFormat);
        const header = pickHeaderFooter(layout.header, layout, sheet.indexInSection, numbers[i]);
        const footer = pickHeaderFooter(layout.footer, layout, sheet.indexInSection, numbers[i]);
        const top = sumHeights;
        sumHeights += sheet.height;
        return (
          <div
            key={i}
            data-page={i + 1}
            data-section={sheet.section + 1}
            data-inset-top={sheet.insetTop}
            data-inset-bottom={sheet.insetBottom}
            data-inset-left={sheet.insetLeft}
            data-inset-right={sheet.insetRight}
            className="page-sheet absolute"
            style={{ left: sheet.left, top: `calc(${top}px + ${i} * var(--pg-gap, ${PAGE_GAP}px))`, width: sheet.width, height: sheet.height }}
          >
            {watermark && <WatermarkMark watermark={watermark} />}
            {bands.filter((b) => b.page === i).flatMap((b) => Array.from({ length: b.count - 1 }, (_, c) => (
              <span key={`${b.top}-${c}`} aria-hidden className="page-column-rule" style={{ left: b.left + (c + 1) * b.width + c * b.gap + b.gap / 2, top: b.top - sheet.top, height: b.height }} />
            )))}
            {bounds && <TextBounds geometry={sheet} />}
            {header && <div className="hf hf-body" style={{ top: 30, ...sideStyle(sheet) }} dangerouslySetInnerHTML={{ __html: withPageNumbers(headerFooterHtml(header.blocks), shown, pages) }} />}
            {footer && <div className="hf hf-body" style={{ bottom: 30, ...sideStyle(sheet) }} dangerouslySetInnerHTML={{ __html: withPageNumbers(headerFooterHtml(footer.blocks), shown, pages) }} />}
          </div>
        );
      })}
    </>
  );
}
