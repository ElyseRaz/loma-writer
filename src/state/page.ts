import type { MarginPreset, MarginsCm, PageSetup, PageSize } from "./types";

/** Internal unit of the layout engine: CSS px at 96 dpi. Everything the user sees and types is in centimetres. */
const PX_PER_CM = 96 / 2.54;
export const cmToPx = (cm: number) => cm * PX_PER_CM;
export const pxToCm2 = (px: number) => +(px / PX_PER_CM).toFixed(2);

export interface PaperDef {
  id: PageSize;
  label: string;
  /** Portrait dimensions in cm. */
  width: number;
  height: number;
}

/** Paper sizes, in portrait. "Custom" takes its dimensions from `PageSetup.customSizeCm`. */
export const PAPER_SIZES: PaperDef[] = [
  { id: "A0", label: "A0", width: 84.1, height: 118.9 },
  { id: "A1", label: "A1", width: 59.4, height: 84.1 },
  { id: "A2", label: "A2", width: 42, height: 59.4 },
  { id: "A3", label: "A3", width: 29.7, height: 42 },
  { id: "A4", label: "A4", width: 21, height: 29.7 },
  { id: "A5", label: "A5", width: 14.8, height: 21 },
  { id: "A6", label: "A6", width: 10.5, height: 14.8 },
  { id: "B5", label: "B5", width: 17.6, height: 25 },
  { id: "Letter", label: "Lettre", width: 21.59, height: 27.94 },
  { id: "Legal", label: "Legal", width: 21.59, height: 35.56 },
  { id: "Executive", label: "Executive", width: 18.41, height: 26.67 },
  { id: "Tabloid", label: "Tabloïd", width: 27.94, height: 43.18 },
];

export const CUSTOM_SIZE_LIMITS = { min: 5, max: 120 };
export const DEFAULT_CUSTOM_SIZE = { width: 21, height: 29.7 };
export const MAX_MARGIN_CM = 50;
/** The text area must stay at least this large (cm). */
export const MIN_TEXT_CM = 3;

export const paperDef = (size: PageSize): PaperDef | undefined => PAPER_SIZES.find((p) => p.id === size);

export interface MarginPresetDef {
  id: MarginPreset;
  label: string;
  /** `left`/`right` are the inner/outer margins for the mirrored preset. */
  cm: MarginsCm;
}

export const MARGIN_PRESETS: MarginPresetDef[] = [
  { id: "normal", label: "Normales", cm: { top: 2.54, bottom: 2.54, left: 2.54, right: 2.54 } },
  { id: "narrow", label: "Étroites", cm: { top: 1.27, bottom: 1.27, left: 1.27, right: 1.27 } },
  { id: "moderate", label: "Modérées", cm: { top: 2.54, bottom: 2.54, left: 1.91, right: 1.91 } },
  { id: "wide", label: "Larges", cm: { top: 2.54, bottom: 2.54, left: 5.08, right: 5.08 } },
  { id: "mirrored", label: "Marges en miroir", cm: { top: 2.54, bottom: 2.54, left: 3.18, right: 2.54 } },
];

/** Compatibility table: preset id -> uniform px (kept for code that only needs an order of magnitude). */
export const MARGIN_PX: Record<MarginPreset, number> = { normal: cmToPx(2.54), narrow: cmToPx(1.27), moderate: cmToPx(2.54), wide: cmToPx(2.54), mirrored: cmToPx(2.54) };

export const PAGE_PX: Record<string, { w: number; h: number }> = Object.fromEntries(PAPER_SIZES.map((p) => [p.id, { w: Math.round(cmToPx(p.width)), h: Math.round(cmToPx(p.height)) }]));

/** Portrait dimensions in cm of the page's paper. */
export function paperCm(p: Pick<PageSetup, "size" | "customSizeCm">): { width: number; height: number } {
  if (p.size === "Custom") return p.customSizeCm ?? DEFAULT_CUSTOM_SIZE;
  const d = paperDef(p.size) ?? paperDef("A4")!;
  return { width: d.width, height: d.height };
}

/** Page dimensions in px, orientation applied. Standard sizes are rounded to whole px (794 × 1123 for A4). */
export function pageDimensions(p: PageSetup): { w: number; h: number } {
  const { width, height } = paperCm(p);
  const base = p.size === "Custom" ? { w: Math.round(cmToPx(width)), h: Math.round(cmToPx(height)) } : (PAGE_PX[p.size] ?? PAGE_PX.A4);
  return p.orientation === "portrait" ? base : { w: base.h, h: base.w };
}

export const isMirrored = (p: PageSetup) => p.margins === "mirrored" || p.mirrored === true;

/** The margins in cm before the binding margin is added (`left` is the inner margin when mirrored). */
export function baseMarginsCm(p: PageSetup): MarginsCm {
  if (p.margins === "custom" && p.customMarginsCm) return p.customMarginsCm;
  return (MARGIN_PRESETS.find((m) => m.id === p.margins) ?? MARGIN_PRESETS[0]).cm;
}

export const gutterOf = (p: PageSetup) => ({ cm: p.gutterCm && p.gutterCm > 0 ? p.gutterCm : 0, pos: p.gutterPos === "top" ? ("top" as const) : ("left" as const) });

/** The margins the layout uses, in cm: the binding margin is part of the margin it is added to. */
export function effectiveMarginsCm(p: PageSetup): MarginsCm {
  const m = baseMarginsCm(p);
  const g = gutterOf(p);
  return { ...m, left: m.left + (g.pos === "left" ? g.cm : 0), top: m.top + (g.pos === "top" ? g.cm : 0) };
}

/** Margins of a page in CSS px, whether preset or custom, binding margin included. */
export function marginsPx(p: PageSetup): { top: number; right: number; bottom: number; left: number } {
  const m = effectiveMarginsCm(p);
  return { top: cmToPx(m.top), right: cmToPx(m.right), bottom: cmToPx(m.bottom), left: cmToPx(m.left) };
}

export interface PageProblem {
  field: "width" | "height" | "top" | "bottom" | "left" | "right" | "gutter" | "text";
  message: string;
}

/** What is wrong with a page setup (empty when valid): no negative margins, a usable text area, a sane custom paper. */
export function validatePage(p: PageSetup): PageProblem[] {
  const out: PageProblem[] = [];
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  const { width, height } = paperCm(p);
  if (p.size === "Custom") {
    const { min, max } = CUSTOM_SIZE_LIMITS;
    if (!num(width) || width < min || width > max) out.push({ field: "width", message: `La largeur doit être comprise entre ${min} et ${max} cm.` });
    if (!num(height) || height < min || height > max) out.push({ field: "height", message: `La hauteur doit être comprise entre ${min} et ${max} cm.` });
  }
  const m = baseMarginsCm(p);
  for (const k of ["top", "bottom", "left", "right"] as const) {
    if (!num(m[k]) || m[k] < 0) out.push({ field: k, message: "Une marge ne peut pas être négative." });
    else if (m[k] > MAX_MARGIN_CM) out.push({ field: k, message: `Une marge ne peut pas dépasser ${MAX_MARGIN_CM} cm.` });
  }
  const g = p.gutterCm ?? 0;
  if (!num(g) || g < 0 || g > MAX_MARGIN_CM) out.push({ field: "gutter", message: `La marge de reliure doit être comprise entre 0 et ${MAX_MARGIN_CM} cm.` });
  if (!out.length) {
    const e = effectiveMarginsCm(p);
    const [pw, ph] = p.orientation === "landscape" ? [height, width] : [width, height];
    if (pw - e.left - e.right < MIN_TEXT_CM) out.push({ field: "text", message: `Les marges laissent moins de ${MIN_TEXT_CM} cm de largeur pour le texte.` });
    if (ph - e.top - e.bottom < MIN_TEXT_CM) out.push({ field: "text", message: `Les marges laissent moins de ${MIN_TEXT_CM} cm de hauteur pour le texte.` });
  }
  return out;
}

/**
 * Nearest valid setup when the paper or the orientation changes: margins that no longer fit the new page are reduced
 * so the text area keeps a usable size (the content is never touched).
 */
export function fitMargins(p: PageSetup): PageSetup {
  if (!validatePage(p).some((x) => x.field === "text")) return p;
  const { width, height } = paperCm(p);
  const [pw, ph] = p.orientation === "landscape" ? [height, width] : [width, height];
  const m = baseMarginsCm(p);
  const g = gutterOf(p);
  const room = (total: number, a: number, b: number, extra: number) => {
    const avail = Math.max(0, total - MIN_TEXT_CM - extra);
    const k = a + b > avail && a + b > 0 ? avail / (a + b) : 1;
    return [+(a * k).toFixed(2), +(b * k).toFixed(2)] as const;
  };
  const [left, right] = room(pw, m.left, m.right, g.pos === "left" ? g.cm : 0);
  const [top, bottom] = room(ph, m.top, m.bottom, g.pos === "top" ? g.cm : 0);
  return { ...p, margins: "custom", customMarginsCm: { top, bottom, left, right } };
}

/** "21 × 29,7 cm" */
export const formatCm = (n: number) => String(+n.toFixed(2)).replace(".", ",");
export const formatSize = (w: number, h: number) => `${formatCm(w)} × ${formatCm(h)} cm`;
