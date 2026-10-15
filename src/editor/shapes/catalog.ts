/** Vector shapes. Ids are the DrawingML preset names, so DOCX (and LibreOffice's `ooxml-*` types) know them. */
export type ShapeCategory = "Lignes" | "Rectangles" | "Formes de base" | "Flèches" | "Étoiles" | "Légendes";

export interface ShapeDef {
  id: string;
  label: string;
  category: ShapeCategory;
  /** SVG path for a box of w × h. */
  path: (w: number, h: number) => string;
  /** Shapes that have no inside: no fill, no text. */
  openPath?: boolean;
  /** Even-odd fill (shapes with holes). */
  evenOdd?: boolean;
  /** Share of the width/height lost on each side before the text area starts (round and pointed shapes). */
  textInset?: number;
}

type Pt = [number, number];
const poly = (pts: Pt[]) => `M${pts.map(([x, y]) => `${+x.toFixed(2)} ${+y.toFixed(2)}`).join("L")}Z`;
const ss = (w: number, h: number) => Math.min(w, h);

/** Regular polygon or star, fitted to the box. `inner` (0..1) turns it into a star. */
function radial(points: number, inner: number | null, w: number, h: number, rotate = -90): string {
  const total = inner === null ? points : points * 2;
  const pts: Pt[] = Array.from({ length: total }, (_, i) => {
    const a = ((rotate + (i * 360) / total) * Math.PI) / 180;
    const r = inner !== null && i % 2 ? inner : 1;
    return [Math.cos(a) * r, Math.sin(a) * r];
  });
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return poly(pts.map(([x, y]) => [((x - x0) / (x1 - x0)) * w, ((y - y0) / (y1 - y0)) * h]));
}

const unit = (d: string, w: number, h: number) => d.replace(/(-?\d*\.?\d+)\s+(-?\d*\.?\d+)/g, (_m, x, y) => `${+(+x * w).toFixed(2)} ${+(+y * h).toFixed(2)}`);

const round = (w: number, h: number) => {
  const r = Math.min(ss(w, h) * 0.16667, w / 2, h / 2);
  return `M${r} 0H${w - r}A${r} ${r} 0 0 1 ${w} ${r}V${h - r}A${r} ${r} 0 0 1 ${w - r} ${h}H${r}A${r} ${r} 0 0 1 0 ${h - r}V${r}A${r} ${r} 0 0 1 ${r} 0Z`;
};
const ellipse = (w: number, h: number, inset = 0) => `M${inset} ${h / 2}A${w / 2 - inset} ${h / 2 - inset} 0 1 0 ${w - inset} ${h / 2}A${w / 2 - inset} ${h / 2 - inset} 0 1 0 ${inset} ${h / 2}Z`;

const arrowRight = (w: number, h: number) => { const hl = Math.min(ss(w, h) * 0.5, w); return poly([[0, h * 0.25], [w - hl, h * 0.25], [w - hl, 0], [w, h / 2], [w - hl, h], [w - hl, h * 0.75], [0, h * 0.75]]); };
const arrowUp = (w: number, h: number) => { const hl = Math.min(ss(w, h) * 0.5, h); return poly([[w * 0.25, h], [w * 0.25, hl], [0, hl], [w / 2, 0], [w, hl], [w * 0.75, hl], [w * 0.75, h]]); };

export const SHAPES: ShapeDef[] = [
  { id: "line", label: "Ligne", category: "Lignes", openPath: true, path: (w, h) => `M0 ${h / 2}H${w}` },
  { id: "rect", label: "Rectangle", category: "Rectangles", path: (w, h) => `M0 0H${w}V${h}H0Z` },
  { id: "roundRect", label: "Rectangle arrondi", category: "Rectangles", path: round },
  { id: "snip1Rect", label: "Rectangle à coin coupé", category: "Rectangles", path: (w, h) => { const c = ss(w, h) * 0.16667; return poly([[0, 0], [w - c, 0], [w, c], [w, h], [0, h]]); } },
  { id: "ellipse", label: "Ellipse", category: "Formes de base", textInset: 0.146, path: (w, h) => ellipse(w, h) },
  { id: "triangle", label: "Triangle", category: "Formes de base", textInset: 0.2, path: (w, h) => poly([[w / 2, 0], [w, h], [0, h]]) },
  { id: "rtTriangle", label: "Triangle rectangle", category: "Formes de base", textInset: 0.15, path: (w, h) => poly([[0, 0], [0, h], [w, h]]) },
  { id: "diamond", label: "Losange", category: "Formes de base", textInset: 0.25, path: (w, h) => poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]) },
  { id: "parallelogram", label: "Parallélogramme", category: "Formes de base", textInset: 0.12, path: (w, h) => { const o = Math.min(ss(w, h) * 0.25, w / 2); return poly([[o, 0], [w, 0], [w - o, h], [0, h]]); } },
  { id: "trapezoid", label: "Trapèze", category: "Formes de base", textInset: 0.12, path: (w, h) => { const o = Math.min(ss(w, h) * 0.25, w / 2); return poly([[o, 0], [w - o, 0], [w, h], [0, h]]); } },
  { id: "pentagon", label: "Pentagone", category: "Formes de base", textInset: 0.15, path: (w, h) => radial(5, null, w, h) },
  { id: "hexagon", label: "Hexagone", category: "Formes de base", textInset: 0.1, path: (w, h) => { const x = Math.min(ss(w, h) * 0.25, w / 2); return poly([[0, h / 2], [x, 0], [w - x, 0], [w, h / 2], [w - x, h], [x, h]]); } },
  { id: "octagon", label: "Octogone", category: "Formes de base", textInset: 0.1, path: (w, h) => { const x = Math.min(ss(w, h) * 0.29289, w / 2); return poly([[0, x], [x, 0], [w - x, 0], [w, x], [w, h - x], [w - x, h], [x, h], [0, h - x]]); } },
  { id: "plus", label: "Croix", category: "Formes de base", textInset: 0.2, path: (w, h) => { const x = ss(w, h) * 0.25; return poly([[x, 0], [w - x, 0], [w - x, x], [w, x], [w, h - x], [w - x, h - x], [w - x, h], [x, h], [x, h - x], [0, h - x], [0, x], [x, x]]); } },
  { id: "heart", label: "Cœur", category: "Formes de base", textInset: 0.2, path: (w, h) => unit("M0.5 0.95C0.05 0.62 -0.03 0.28 0.2 0.1C0.36 -0.02 0.5 0.08 0.5 0.26C0.5 0.08 0.64 -0.02 0.8 0.1C1.03 0.28 0.95 0.62 0.5 0.95Z", w, h) },
  { id: "cloud", label: "Nuage", category: "Formes de base", textInset: 0.15, path: (w, h) => unit("M0.25 0.8C0.05 0.8 0 0.55 0.15 0.45C0.1 0.25 0.3 0.15 0.4 0.28C0.45 0.05 0.75 0.05 0.78 0.3C0.98 0.28 1.02 0.55 0.88 0.65C0.95 0.85 0.75 0.9 0.7 0.8C0.6 0.95 0.4 0.95 0.25 0.8Z", w, h) },
  { id: "lightningBolt", label: "Éclair", category: "Formes de base", textInset: 0.25, path: (w, h) => poly([[0.4, 0], [0.12, 0.52], [0.44, 0.52], [0.28, 1], [0.88, 0.4], [0.56, 0.4], [0.78, 0]].map(([x, y]) => [x * w, y * h] as Pt)) },
  { id: "moon", label: "Lune", category: "Formes de base", textInset: 0.2, path: (w, h) => `M${w * 0.7} 0A${w * 0.7} ${h / 2} 0 1 0 ${w * 0.7} ${h}A${w * 0.4} ${h * 0.5} 0 1 1 ${w * 0.7} 0Z` },
  { id: "donut", label: "Anneau", category: "Formes de base", evenOdd: true, textInset: 0.15, path: (w, h) => `${ellipse(w, h)}${ellipse(w, h, ss(w, h) * 0.25)}` },
  { id: "rightArrow", label: "Flèche droite", category: "Flèches", path: arrowRight },
  { id: "leftArrow", label: "Flèche gauche", category: "Flèches", path: (w, h) => { const hl = Math.min(ss(w, h) * 0.5, w); return poly([[w, h * 0.25], [hl, h * 0.25], [hl, 0], [0, h / 2], [hl, h], [hl, h * 0.75], [w, h * 0.75]]); } },
  { id: "upArrow", label: "Flèche haut", category: "Flèches", path: arrowUp },
  { id: "downArrow", label: "Flèche bas", category: "Flèches", path: (w, h) => { const hl = Math.min(ss(w, h) * 0.5, h); return poly([[w * 0.25, 0], [w * 0.25, h - hl], [0, h - hl], [w / 2, h], [w, h - hl], [w * 0.75, h - hl], [w * 0.75, 0]]); } },
  { id: "leftRightArrow", label: "Flèche double", category: "Flèches", path: (w, h) => { const hl = Math.min(ss(w, h) * 0.5, w / 2); return poly([[0, h / 2], [hl, 0], [hl, h * 0.25], [w - hl, h * 0.25], [w - hl, 0], [w, h / 2], [w - hl, h], [w - hl, h * 0.75], [hl, h * 0.75], [hl, h]]); } },
  { id: "upDownArrow", label: "Flèche haut-bas", category: "Flèches", path: (w, h) => { const hl = Math.min(ss(w, h) * 0.5, h / 2); return poly([[w / 2, 0], [w, hl], [w * 0.75, hl], [w * 0.75, h - hl], [w, h - hl], [w / 2, h], [0, h - hl], [w * 0.25, h - hl], [w * 0.25, hl], [0, hl]]); } },
  { id: "chevron", label: "Chevron", category: "Flèches", textInset: 0.1, path: (w, h) => { const x = Math.min(ss(w, h) * 0.5, w); return poly([[0, 0], [w - x, 0], [w, h / 2], [w - x, h], [0, h], [x, h / 2]]); } },
  { id: "homePlate", label: "Pentagone fléché", category: "Flèches", path: (w, h) => { const x = Math.min(ss(w, h) * 0.5, w); return poly([[0, 0], [w - x, 0], [w, h / 2], [w - x, h], [0, h]]); } },
  { id: "star4", label: "Étoile à 4 branches", category: "Étoiles", textInset: 0.25, path: (w, h) => radial(4, 0.38, w, h) },
  { id: "star5", label: "Étoile à 5 branches", category: "Étoiles", textInset: 0.25, path: (w, h) => radial(5, 0.4, w, h) },
  { id: "star6", label: "Étoile à 6 branches", category: "Étoiles", textInset: 0.22, path: (w, h) => radial(6, 0.55, w, h) },
  { id: "star8", label: "Étoile à 8 branches", category: "Étoiles", textInset: 0.2, path: (w, h) => radial(8, 0.72, w, h) },
  { id: "wedgeRectCallout", label: "Bulle rectangulaire", category: "Légendes", path: (w, h) => { const b = h * 0.8; return poly([[0, 0], [w, 0], [w, b], [w * 0.38, b], [w * 0.2, h], [w * 0.22, b], [0, b]]); } },
  { id: "wedgeEllipseCallout", label: "Bulle ronde", category: "Légendes", textInset: 0.12, path: (w, h) => `${ellipse(w, h * 0.8)}${poly([[w * 0.2, h * 0.68], [w * 0.14, h], [w * 0.38, h * 0.78]])}` },
];

/** The text box is a rectangle that grows with its text. */
export const TEXT_BOX = "textbox";
export const isTextBox = (kind: string) => kind === TEXT_BOX;

const byId = new Map(SHAPES.map((s) => [s.id, s]));
export const shapeDef = (id: string): ShapeDef => byId.get(id) ?? byId.get("rect")!;
export const isKnownShape = (id: string) => byId.has(id) || id === TEXT_BOX;

export const SHAPE_CATEGORIES: ShapeCategory[] = ["Lignes", "Rectangles", "Formes de base", "Flèches", "Étoiles", "Légendes"];

export interface ShapeStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
}
export const DEFAULT_SHAPE_STYLE: ShapeStyle = { fill: "#bfdbfe", stroke: "#2563eb", strokeWidth: 2 };
export const DEFAULT_TEXTBOX_STYLE: ShapeStyle = { fill: "#ffffff", stroke: "#6b7280", strokeWidth: 1 };

export const NONE = "none";
