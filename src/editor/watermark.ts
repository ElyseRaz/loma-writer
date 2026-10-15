/** A text watermark drawn behind the text of every page ("Filigrane"). */
export interface Watermark {
  text: string;
  /** #rrggbb */
  color: string;
  /** Font size in pt. */
  size: number;
  /** "diagonal" (rising at 45°) or "horizontal". */
  layout: "diagonal" | "horizontal";
  /** 0.1 to 1 (1 = opaque). */
  opacity: number;
}

export const DEFAULT_WATERMARK: Watermark = { text: "CONFIDENTIEL", color: "#c0c0c0", size: 80, layout: "diagonal", opacity: 0.5 };
export const WATERMARK_PRESETS = ["CONFIDENTIEL", "BROUILLON", "NE PAS COPIER", "URGENT", "ÉCHANTILLON", "COPIE"];
export const MAX_WATERMARK_TEXT = 40;
export const WATERMARK_SIZE = { min: 20, max: 250 };

const HEX = /^#[0-9a-f]{6}$/i;

/** A valid watermark from anything stored in a file or a draft, or null. */
export function cleanWatermark(raw: unknown): Watermark | null {
  const r = raw as Partial<Watermark> | null | undefined;
  if (!r || typeof r.text !== "string") return null;
  const text = r.text.replace(/\s+/g, " ").trim().slice(0, MAX_WATERMARK_TEXT);
  if (!text) return null;
  const size = typeof r.size === "number" && Number.isFinite(r.size) ? Math.min(WATERMARK_SIZE.max, Math.max(WATERMARK_SIZE.min, Math.round(r.size))) : DEFAULT_WATERMARK.size;
  const opacity = typeof r.opacity === "number" && Number.isFinite(r.opacity) ? Math.min(1, Math.max(0.1, Math.round(r.opacity * 100) / 100)) : DEFAULT_WATERMARK.opacity;
  return {
    text,
    color: typeof r.color === "string" && HEX.test(r.color) ? r.color.toLowerCase() : DEFAULT_WATERMARK.color,
    size,
    layout: r.layout === "horizontal" ? "horizontal" : "diagonal",
    opacity,
  };
}

/** Rough width in pt of the text at its size (bold capitals are wide): sets the size of the DOCX shape. */
export const watermarkWidthPt = (w: Watermark) => Math.max(60, Math.round(w.text.length * w.size * 0.66));
