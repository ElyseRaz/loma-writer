import { DEFAULT_PAGE, type PageSetup } from "../../state/types";
import { CUSTOM_SIZE_LIMITS, MARGIN_PRESETS, MAX_MARGIN_CM, PAPER_SIZES, validatePage } from "../../state/page";

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Keeps only known values, so a hand-edited file cannot break the layout. Defaults are not written back (the result stays minimal). */
export function sanitizePage(page: Partial<PageSetup> | undefined): PageSetup {
  const out: PageSetup = { size: DEFAULT_PAGE.size, orientation: page?.orientation === "landscape" ? "landscape" : "portrait", margins: DEFAULT_PAGE.margins };

  if (page?.size === "Custom") {
    const s = page.customSizeCm;
    const { min, max } = CUSTOM_SIZE_LIMITS;
    if (s && finite(s.width) && finite(s.height) && s.width >= min && s.width <= max && s.height >= min && s.height <= max) { out.size = "Custom"; out.customSizeCm = { width: s.width, height: s.height }; }
  } else if (page?.size && PAPER_SIZES.some((p) => p.id === page.size)) out.size = page.size;

  if (page?.margins === "custom") {
    const m = page.customMarginsCm;
    const ok = (v: unknown) => finite(v) && v >= 0 && v <= MAX_MARGIN_CM;
    if (m && ok(m.top) && ok(m.right) && ok(m.bottom) && ok(m.left)) {
      out.margins = "custom";
      out.customMarginsCm = { top: m.top, right: m.right, bottom: m.bottom, left: m.left };
      if (page.mirrored === true) out.mirrored = true;
    }
  } else if (page?.margins && MARGIN_PRESETS.some((m) => m.id === page.margins)) out.margins = page.margins;

  if (finite(page?.gutterCm) && page.gutterCm > 0 && page.gutterCm <= MAX_MARGIN_CM) {
    out.gutterCm = page.gutterCm;
    if (page.gutterPos === "top") out.gutterPos = "top";
  }
  // A setup that leaves no room for text is never accepted from a file.
  return validatePage(out).length ? { size: out.size, orientation: out.orientation, ...(out.customSizeCm ? { customSizeCm: out.customSizeCm } : {}), margins: DEFAULT_PAGE.margins } : out;
}
