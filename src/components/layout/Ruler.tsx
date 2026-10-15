import { useMemo } from "react";

const PX_PER_CM = 96 / 2.54;

/** Horizontal ruler in centimetres, zero at the left margin. Purely informative for now (no draggable indents yet). */
export function Ruler({ pageWidth, marginLeft, marginRight, zoom }: { pageWidth: number; marginLeft: number; marginRight: number; zoom: number }) {
  const z = zoom / 100;
  const marks = useMemo(() => {
    const out: Array<{ x: number; kind: "cm" | "half" | "mm"; label?: number }> = [];
    for (let mm = -Math.floor(marginLeft / (PX_PER_CM / 10)); ; mm++) {
      const x = marginLeft + mm * (PX_PER_CM / 10);
      if (x > pageWidth) break;
      if (x < 0 || x > pageWidth) continue;
      if (mm % 10 === 0) out.push({ x, kind: "cm", label: mm > 0 ? mm / 10 : undefined });
      else if (mm % 5 === 0) out.push({ x, kind: "half" });
      else if (z >= 0.75) out.push({ x, kind: "mm" });
    }
    return out;
  }, [pageWidth, marginLeft, z]);

  return (
    <div className="sticky top-0 z-10 flex h-5 w-max min-w-full shrink-0 justify-center bg-chrome px-8 shadow-[0_1px_0_var(--c-line)]" aria-hidden>
      <div className="relative h-5 shrink-0" style={{ width: pageWidth * z }}>
        <div className="absolute inset-x-0 top-1 bottom-0 bg-line/70" />
        <div className="absolute top-1 bottom-0 bg-surface" style={{ left: marginLeft * z, right: marginRight * z }} />
        <svg className="absolute inset-0" width={pageWidth * z} height={20}>
          {marks.map((m) => (
            <g key={m.x}>
              <line x1={m.x * z} x2={m.x * z} y1={m.kind === "cm" ? 12 : m.kind === "half" ? 14 : 16} y2={20} stroke="var(--c-tick)" strokeWidth={1} />
              {m.label !== undefined && (
                <text x={m.x * z} y={10} fontSize={9} textAnchor="middle" fill="var(--c-muted)" style={{ letterSpacing: "0.02em" }}>
                  {m.label}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
