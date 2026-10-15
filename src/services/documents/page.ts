import { DEFAULT_PAGE, MARGIN_PX, PAGE_PX, type MarginPreset, type PageSetup, type PageSize } from "../../state/types";

const CM_PER_PX = 2.54 / 96;
export const pxToCm = (px: number) => +(px * CM_PER_PX).toFixed(3);

/**
 * Maps a page (in CSS px at 96 dpi) onto the paper sizes the editor supports; margins are kept exactly
 * (as a preset when they match one, as custom margins otherwise). A paper size that is not exact is reported.
 */
export function pageFromDimensions(widthPx: number, heightPx: number, margins: { top: number; right: number; bottom: number; left: number } | null, warnings: Set<string>): PageSetup {
  const orientation = widthPx > heightPx ? "landscape" : "portrait";
  const [short, long] = widthPx > heightPx ? [heightPx, widthPx] : [widthPx, heightPx];

  let size: PageSize = DEFAULT_PAGE.size;
  let best = Infinity;
  for (const [name, d] of Object.entries(PAGE_PX) as [PageSize, { w: number; h: number }][]) {
    const dist = Math.abs(d.w - short) + Math.abs(d.h - long);
    if (dist < best) { best = dist; size = name; }
  }
  if (best > 8) warnings.add(`Format de page ${Math.round(short * CM_PER_PX * 10)} × ${Math.round(long * CM_PER_PX * 10)} mm non pris en charge : remplacé par ${size}.`);

  if (!margins) return { size, orientation, margins: DEFAULT_PAGE.margins };
  const preset = (Object.entries(MARGIN_PX) as [MarginPreset, number][]).find(([, px]) => [margins.top, margins.right, margins.bottom, margins.left].every((m) => Math.abs(m - px) <= 2));
  if (preset) return { size, orientation, margins: preset[0] };
  const cm = (px: number) => +(px * CM_PER_PX).toFixed(2);
  return { size, orientation, margins: "custom", customMarginsCm: { top: cm(margins.top), right: cm(margins.right), bottom: cm(margins.bottom), left: cm(margins.left) } };
}
