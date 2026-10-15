import { Pipette } from "lucide-react";
import { useRef, useState } from "react";

type Hsv = { h: number; s: number; v: number };

export function hexToHsv(hex: string): Hsv {
  const n = parseInt(/^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : "2563eb", 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  const h = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return `#${[f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** Drag area reporting a position in [0,1]×[0,1]. */
function useDrag(onMove: (x: number, y: number) => void, onEnd: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const at = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    onMove(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
  };
  return {
    ref,
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); at(e); },
    onPointerMove: (e: React.PointerEvent) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) at(e); },
    onPointerUp: (e: React.PointerEvent) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) { at(e); e.currentTarget.releasePointerCapture(e.pointerId); onEnd(); } },
  };
}

/** Saturation/brightness square, eyedropper, preview and hue slider. `onCommit` fires when a drag ends. */
export function ColorPicker({ value, onCommit }: { value: string; onCommit: (hex: string) => void }) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const latest = useRef(hsv);
  const set = (h: Hsv) => { latest.current = h; setHsv(h); };
  const commit = () => onCommit(hsvToHex(latest.current));
  const sv = useDrag((x, y) => set({ ...latest.current, s: x, v: 1 - y }), commit);
  const hue = useDrag((x) => set({ ...latest.current, h: x * 359.99 }), commit);
  const hex = hsvToHex(hsv);
  const eyedropper = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
  return (
    <div className="w-[228px] select-none" aria-label="Sélecteur de couleur">
      <div
        {...sv}
        role="slider"
        aria-label="Saturation et luminosité"
        aria-valuetext={hex}
        tabIndex={0}
        onKeyDown={(e) => {
          const d = { ArrowLeft: [-0.03, 0], ArrowRight: [0.03, 0], ArrowUp: [0, 0.03], ArrowDown: [0, -0.03] }[e.key];
          if (!d) return;
          e.preventDefault();
          set({ ...latest.current, s: Math.min(1, Math.max(0, latest.current.s + d[0])), v: Math.min(1, Math.max(0, latest.current.v + d[1])) });
          commit();
        }}
        className="relative h-[150px] w-full cursor-crosshair touch-none rounded-t-md"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${hsv.h} 100% 50%)` }}
      >
        <span className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1.5px_#000]" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }} />
      </div>
      <div className="flex items-center gap-3 px-3 py-3">
        {eyedropper && (
          <button type="button" title="Pipette" aria-label="Pipette" onMouseDown={(e) => e.preventDefault()}
            onClick={async () => { try { const { sRGBHex } = await new eyedropper().open(); set(hexToHsv(sRGBHex)); onCommit(sRGBHex.toLowerCase()); } catch { /* cancelled */ } }}
            className="text-fg hover:text-accent"><Pipette size={18} /></button>
        )}
        <span className="h-9 w-9 shrink-0 rounded-full border border-black/10" style={{ background: hex }} aria-hidden />
        <div
          {...hue}
          role="slider"
          aria-label="Teinte"
          aria-valuemin={0}
          aria-valuemax={360}
          aria-valuenow={Math.round(hsv.h)}
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); set({ ...latest.current, h: Math.min(359.99, Math.max(0, latest.current.h + (e.key === "ArrowRight" ? 6 : -6))) }); commit(); } }}
          className="relative h-3 flex-1 cursor-pointer touch-none rounded-full"
          style={{ background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)" }}
        >
          <span className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-white/20 shadow-[0_0_0_1.5px_#2563eb,0_1px_3px_rgba(0,0,0,.4)]" style={{ left: `${(hsv.h / 360) * 100}%`, background: `hsl(${hsv.h} 100% 50%)` }} />
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-line px-3 py-2">
        <input
          aria-label="Code couleur"
          value={hex}
          onChange={(e) => /^#[0-9a-f]{6}$/i.test(e.target.value) && set(hexToHsv(e.target.value))}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          spellCheck={false}
          className="h-7 min-w-0 flex-1 rounded border border-line bg-surface px-1.5 font-mono text-[12px]"
        />
      </div>
    </div>
  );
}
