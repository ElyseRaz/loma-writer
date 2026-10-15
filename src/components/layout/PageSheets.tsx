import { useLayoutEffect, useRef } from "react";
import { pickHeaderFooter, type HeaderFooterContent, type SectionLayout } from "../../pagination/headerFooter";
import type { PageGeometry } from "../../pagination/model";
import { headerFooterHtml, withPageNumbers } from "../../services/headerFooterHtml";

export interface HeaderFooterHeights {
  header: number;
  footer: number;
}

const sideStyle = (g: PageGeometry) => ({ left: g.insetLeft, right: g.insetRight });

/** Hidden copy of every header/footer variant, to know how much room the page layout must reserve. */
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
function TextBounds({ geometry: g }: { geometry: PageGeometry }) {
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

/**
 * The white sheets drawn behind the text, one per page, `gap` apart, with their header and footer. The HTML
 * comes from the editor schema (never from raw user markup).
 */
export function PageSheets({ pages, geometry, section, onHeights, bounds = true }: { pages: number; geometry: PageGeometry; section: SectionLayout; onHeights: (h: HeaderFooterHeights) => void; bounds?: boolean }) {
  return (
    <>
      <Measure section={section} geometry={geometry} onHeights={onHeights} />
      {Array.from({ length: pages }, (_, i) => {
        const header = pickHeaderFooter(section.header, section, i, i + 1);
        const footer = pickHeaderFooter(section.footer, section, i, i + 1);
        return (
          <div
            key={i}
            data-page={i + 1}
            className="page-sheet absolute left-0"
            style={{ top: `calc(${i} * (${geometry.height}px + var(--pg-gap, ${geometry.gap}px)))`, width: geometry.width, height: geometry.height }}
          >
            {bounds && <TextBounds geometry={geometry} />}
            {header && <div className="hf hf-body" style={{ top: 30, ...sideStyle(geometry) }} dangerouslySetInnerHTML={{ __html: withPageNumbers(headerFooterHtml(header.blocks), i + 1, pages) }} />}
            {footer && <div className="hf hf-body" style={{ bottom: 30, ...sideStyle(geometry) }} dangerouslySetInnerHTML={{ __html: withPageNumbers(headerFooterHtml(footer.blocks), i + 1, pages) }} />}
          </div>
        );
      })}
    </>
  );
}
