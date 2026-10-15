import { DEFAULT_PAGE, type PageSetup, type PageSize } from "../../state/types";
import { CUSTOM_SIZE_LIMITS, MARGIN_PRESETS, PAPER_SIZES, cmToPx } from "../../state/page";

const CM_PER_PX = 2.54 / 96;
export const pxToCm = (px: number) => +(px * CM_PER_PX).toFixed(3);

export interface PageExtras {
  /** Facing pages (mirror margins): `margins.left` is then the inner margin. */
  mirrored?: boolean;
  /** Binding margin in px and where it is added; `margins` do not include it. */
  gutterPx?: number;
  gutterTop?: boolean;
}

/**
 * Maps a page (in CSS px at 96 dpi) onto a page setup: a standard paper size when it matches one (within 2 mm), a custom size
 * otherwise; margins as a preset when they match one, as custom margins otherwise (always kept exactly).
 */
export function pageFromDimensions(widthPx: number, heightPx: number, margins: { top: number; right: number; bottom: number; left: number } | null, _warnings: Set<string>, extra: PageExtras = {}): PageSetup {
  const orientation = widthPx > heightPx ? "landscape" : "portrait";
  const [short, long] = widthPx > heightPx ? [heightPx, widthPx] : [widthPx, heightPx];

  let size: PageSize = "Custom";
  let best = Infinity;
  for (const p of PAPER_SIZES) {
    const dist = Math.abs(cmToPx(p.width) - short) + Math.abs(cmToPx(p.height) - long);
    if (dist < best) { best = dist; size = p.id; }
  }
  const out: PageSetup = { size: DEFAULT_PAGE.size, orientation, margins: DEFAULT_PAGE.margins };
  if (best <= 8) out.size = size;
  else {
    const { min, max } = CUSTOM_SIZE_LIMITS;
    const c = (px: number) => Math.min(max, Math.max(min, +(px * CM_PER_PX).toFixed(2)));
    out.size = "Custom";
    out.customSizeCm = { width: c(short), height: c(long) };
  }

  if (margins) {
    const px = (cm: number) => cmToPx(cm);
    const match = MARGIN_PRESETS.find((m) => (m.id === "mirrored") === !!extra.mirrored && [[margins.top, m.cm.top], [margins.right, m.cm.right], [margins.bottom, m.cm.bottom], [margins.left, m.cm.left]].every(([a, b]) => Math.abs(a - px(b)) <= 2));
    if (match) out.margins = match.id;
    else {
      const cm = (v: number) => +(v * CM_PER_PX).toFixed(2);
      out.margins = "custom";
      out.customMarginsCm = { top: cm(margins.top), right: cm(margins.right), bottom: cm(margins.bottom), left: cm(margins.left) };
      if (extra.mirrored) out.mirrored = true;
    }
  }
  if (extra.gutterPx && extra.gutterPx > 1) {
    out.gutterCm = +(extra.gutterPx * CM_PER_PX).toFixed(2);
    if (extra.gutterTop) out.gutterPos = "top";
  }
  return out;
}
