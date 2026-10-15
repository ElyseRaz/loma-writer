import { DEFAULT_PAGE, MARGIN_PX, PAGE_PX, type PageSetup } from "../../state/types";

/** Keeps only known values, so a hand-edited file cannot break the layout. */
function sanitizeMargins(page: Partial<PageSetup> | undefined): Pick<PageSetup, "margins" | "customMarginsCm"> {
  if (page?.margins === "custom") {
    const m = page.customMarginsCm;
    const ok = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 10;
    if (m && ok(m.top) && ok(m.right) && ok(m.bottom) && ok(m.left)) return { margins: "custom", customMarginsCm: { top: m.top, right: m.right, bottom: m.bottom, left: m.left } };
    return { margins: DEFAULT_PAGE.margins };
  }
  return { margins: page?.margins && page.margins in MARGIN_PX ? (page.margins as PageSetup["margins"]) : DEFAULT_PAGE.margins };
}

export function sanitizePage(page: Partial<PageSetup> | undefined): PageSetup {
  return {
    size: page?.size && page.size in PAGE_PX ? page.size : DEFAULT_PAGE.size,
    orientation: page?.orientation === "landscape" ? "landscape" : "portrait",
    ...sanitizeMargins(page),
  };
}
