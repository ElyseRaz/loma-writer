import { DEFAULT_SHAPE_STYLE, DEFAULT_TEXTBOX_STYLE, NONE, isTextBox } from "./catalog";

export interface GradientStop {
  /** 0..100 */
  pos: number;
  color: string;
}

/** Gradient fill. `angle` is in degrees, clockwise from "left to right" (0 = left→right, 90 = top→bottom). */
export interface Gradient {
  type: "linear" | "radial";
  angle: number;
  stops: GradientStop[];
}

export interface Shadow {
  color: string;
  /** 0..1 */
  opacity: number;
  /** Blur radius, px. */
  blur: number;
  dx: number;
  dy: number;
}

/**
 * How a shape sits in the page, with the same options as Word:
 * - inline: in the line of text · square: text wraps around it · topBottom: text stops above and resumes below
 * - front / behind: free position, over or under the text · group: child of a group (position inside the group)
 */
export type Wrap = "inline" | "square" | "topBottom" | "front" | "behind" | "group";
export const WRAP_LABELS: Record<Exclude<Wrap, "group">, string> = {
  inline: "En ligne avec le texte",
  square: "Carré",
  topBottom: "Haut et bas",
  front: "Devant le texte",
  behind: "Derrière le texte",
};
export const FLOATING: Wrap[] = ["square", "topBottom", "front", "behind"];

/** What the coordinates `x` and `y` are measured from. */
export type Anchor = "paragraph" | "page";

/** Placement shared by shapes and groups. */
export interface Placement {
  width: number;
  height: number;
  rotation: number;
  wrap: Wrap;
  anchor: Anchor;
  x: number;
  y: number;
  /** Stacking order among shapes of the same layer (higher = on top). */
  z: number;
  align: "left" | "center" | "right";
}

export interface ShapeAttrs extends Placement {
  kind: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
  gradient: Gradient | null;
  shadow: Shadow | null;
  alt: string;
}

export interface GroupAttrs extends Placement {
  alt: string;
}

export const MIN_SIZE = 8;
export const MAX_WIDTH = 650;

const placement = (): Placement => ({ width: 180, height: 110, rotation: 0, wrap: "inline", anchor: "paragraph", x: 0, y: 0, z: 0, align: "left" });

/** Defaults for a new shape of this kind. */
export function defaultShapeAttrs(kind: string): ShapeAttrs {
  const box = isTextBox(kind);
  const style = box ? DEFAULT_TEXTBOX_STYLE : DEFAULT_SHAPE_STYLE;
  const line = kind === "line";
  return {
    ...placement(),
    kind,
    width: box ? 240 : line ? 200 : kind === "star5" || kind === "diamond" || kind === "plus" || kind === "heart" ? 140 : 180,
    height: box ? 70 : line ? 24 : 110,
    ...style,
    ...(line ? { fill: NONE, strokeWidth: 3 } : {}),
    gradient: null,
    shadow: null,
    alt: "",
  };
}

export const defaultGroupAttrs = (): GroupAttrs => ({ ...placement(), wrap: "front", alt: "" });

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const color = (v: unknown, fallback: string) => (typeof v === "string" && (/^#[0-9a-f]{6}$/i.test(v) || v === NONE) ? v : fallback);

export function cleanGradient(g: unknown): Gradient | null {
  const x = g as Partial<Gradient> | null | undefined;
  if (!x || (x.type !== "linear" && x.type !== "radial") || !Array.isArray(x.stops)) return null;
  const stops = x.stops
    .filter((s) => s && /^#[0-9a-f]{6}$/i.test(String(s.color)))
    .slice(0, 6)
    .map((s) => ({ pos: clamp(num(s.pos, 0), 0, 100), color: String(s.color).toLowerCase() }))
    .sort((a, b) => a.pos - b.pos);
  return stops.length >= 2 ? { type: x.type, angle: num(x.angle, 90) % 360, stops } : null;
}

export function cleanShadow(s: unknown): Shadow | null {
  const x = s as Partial<Shadow> | null | undefined;
  if (!x || !/^#[0-9a-f]{6}$/i.test(String(x.color))) return null;
  return { color: String(x.color).toLowerCase(), opacity: clamp(num(x.opacity, 0.4), 0, 1), blur: clamp(num(x.blur, 6), 0, 60), dx: clamp(num(x.dx, 4), -100, 100), dy: clamp(num(x.dy, 4), -100, 100) };
}

/** Brings any partial or foreign attributes back to valid values (used by every command and import). */
export function cleanPlacement(a: Partial<Placement>, base: Placement = placement()): Placement {
  const wrap: Wrap = (["inline", "square", "topBottom", "front", "behind", "group"] as const).includes(a.wrap as Wrap) ? (a.wrap as Wrap) : base.wrap;
  return {
    width: clamp(Math.round(num(a.width, base.width)), MIN_SIZE, MAX_WIDTH * 2),
    height: Math.max(MIN_SIZE, Math.round(num(a.height, base.height))),
    rotation: ((Math.round(num(a.rotation, base.rotation) * 10) / 10) % 360 + 360) % 360,
    wrap,
    anchor: a.anchor === "page" ? "page" : "paragraph",
    x: Math.round(num(a.x, base.x)),
    y: Math.round(num(a.y, base.y)),
    z: clamp(Math.round(num(a.z, base.z)), -49, 49),
    align: a.align === "center" || a.align === "right" ? a.align : "left",
  };
}

export function cleanShapeAttrs(a: Partial<ShapeAttrs>, base: ShapeAttrs): ShapeAttrs {
  const p = cleanPlacement(a, base);
  // Inline shapes are not wider than the text area; floating ones may be.
  if (p.wrap === "inline") p.width = Math.min(p.width, MAX_WIDTH);
  return {
    ...p,
    kind: typeof a.kind === "string" && a.kind ? a.kind : base.kind,
    fill: color(a.fill, base.fill),
    stroke: color(a.stroke, base.stroke),
    strokeWidth: clamp(num(a.strokeWidth, base.strokeWidth), 0, 24),
    gradient: "gradient" in a ? cleanGradient(a.gradient) : base.gradient,
    shadow: "shadow" in a ? cleanShadow(a.shadow) : base.shadow,
    alt: typeof a.alt === "string" ? a.alt.slice(0, 300) : base.alt,
  };
}
