/** Look of a table: a style (a bundle of settings) that can then be customised setting by setting. */
export interface TableLook {
  /** Which grid lines are drawn. */
  borders: "all" | "horizontal" | "outer" | "none";
  color: string;
  /** Line width in px. */
  width: number;
  headFill: string;
  headText: string;
  /** Fill of every other data row, or null. */
  band: string | null;
  /** Bold first column. */
  firstCol: boolean;
}

export const DEFAULT_LOOK: TableLook = { borders: "all", color: "#000000", width: 1, headFill: "#f3f4f6", headText: "#242424", band: null, firstCol: false };

export interface TableStyleDef {
  id: string;
  label: string;
  look: TableLook;
}

const look = (p: Partial<TableLook>): TableLook => ({ ...DEFAULT_LOOK, ...p });

/** The gallery ("Styles de tableau"). The first one is the default look. */
export const TABLE_STYLES: TableStyleDef[] = [
  { id: "grid", label: "Grille", look: look({}) },
  { id: "light", label: "Grille légère", look: look({ color: "#9ca3af", headFill: "#f3f4f6" }) },
  { id: "horizontal", label: "Lignes horizontales", look: look({ borders: "horizontal", color: "#6b7280", headFill: "#ffffff" }) },
  { id: "outer", label: "Cadre simple", look: look({ borders: "outer", headFill: "#ffffff" }) },
  { id: "none", label: "Sans bordure", look: look({ borders: "none", headFill: "#ffffff" }) },
  { id: "banded", label: "Lignes alternées", look: look({ color: "#d1d5db", band: "#f3f4f6", headFill: "#e5e7eb" }) },
  { id: "blue", label: "Bleu", look: look({ color: "#2563eb", headFill: "#2563eb", headText: "#ffffff", band: "#eff6ff" }) },
  { id: "green", label: "Vert", look: look({ color: "#16a34a", headFill: "#16a34a", headText: "#ffffff", band: "#f0fdf4" }) },
  { id: "orange", label: "Orange", look: look({ color: "#ea580c", headFill: "#ea580c", headText: "#ffffff", band: "#fff7ed" }) },
  { id: "dark", label: "Sombre", look: look({ color: "#111827", headFill: "#111827", headText: "#ffffff", band: "#f3f4f6" }) },
];

export const BORDER_WIDTHS = [0.5, 1, 1.5, 2, 3, 4];
export const BORDER_MODES: Array<{ id: TableLook["borders"]; label: string }> = [
  { id: "all", label: "Toutes les bordures" },
  { id: "horizontal", label: "Lignes horizontales" },
  { id: "outer", label: "Bordure extérieure" },
  { id: "none", label: "Aucune bordure" },
];

const HEX = /^#[0-9a-f]{6}$/i;

/** A valid look, from anything stored in a document or a draft. */
export function cleanLook(raw: unknown): TableLook {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const hex = (v: unknown, d: string) => (typeof v === "string" && HEX.test(v) ? v.toLowerCase() : d);
  return {
    borders: r.borders === "horizontal" || r.borders === "outer" || r.borders === "none" ? r.borders : "all",
    color: hex(r.color, DEFAULT_LOOK.color),
    width: typeof r.width === "number" && r.width >= 0.25 && r.width <= 8 ? r.width : DEFAULT_LOOK.width,
    headFill: hex(r.headFill, DEFAULT_LOOK.headFill),
    headText: hex(r.headText, DEFAULT_LOOK.headText),
    band: typeof r.band === "string" && HEX.test(r.band) ? r.band.toLowerCase() : null,
    firstCol: r.firstCol === true,
  };
}

/** The style of the gallery a look matches exactly, if any. */
export const styleIdOf = (l: TableLook) => TABLE_STYLES.find((s) => JSON.stringify(s.look) === JSON.stringify(l))?.id ?? null;

export interface Line { color: string; width: number }
export interface CellLook {
  fill: string | null;
  textColor: string | null;
  bold: boolean;
  top: Line | null;
  bottom: Line | null;
  left: Line | null;
  right: Line | null;
}

/** What one cell looks like. `row` and `col` are 0-based; `explicitFill` (a shading the user chose) wins over the style's fill. */
export function cellLook(l: TableLook, o: { row: number; col: number; rows: number; cols: number; header: boolean; explicitFill?: string | null }): CellLook {
  const line: Line = { color: l.color, width: l.width };
  const all = l.borders === "all";
  const horizontal = all || l.borders === "horizontal";
  const outer = l.borders === "outer";
  const lastRow = o.row === o.rows - 1;
  const lastCol = o.col === o.cols - 1;
  return {
    fill: o.explicitFill || (o.header ? l.headFill : l.band && o.row % 2 === 1 ? l.band : null),
    textColor: o.header && !o.explicitFill && l.headText !== DEFAULT_LOOK.headText ? l.headText : null,
    bold: l.firstCol && o.col === 0 && !o.header,
    top: horizontal || (outer && o.row === 0) ? line : null,
    bottom: horizontal || (outer && lastRow) ? line : null,
    left: all || (outer && o.col === 0) ? line : null,
    right: all || (outer && lastCol) ? line : null,
  };
}

type PM = { type?: string; text?: string; marks?: Array<{ type: string; attrs?: Record<string, unknown> }>; content?: PM[] };

/** Text of `nodes` with a colour (where none was chosen) and/or bold added, so exports show the style's text colour. */
export function tint<T extends PM>(nodes: T[] | undefined, color: string | null, bold: boolean): T[] {
  if (!nodes || (!color && !bold)) return nodes ?? [];
  const walk = (n: PM): PM => {
    if (n.type === "text") {
      const marks = [...(n.marks ?? [])];
      const ts = marks.findIndex((m) => m.type === "textStyle");
      if (color) {
        if (ts < 0) marks.push({ type: "textStyle", attrs: { color } });
        else if (!marks[ts].attrs?.color) marks[ts] = { ...marks[ts], attrs: { ...marks[ts].attrs, color } };
      }
      if (bold && !marks.some((m) => m.type === "bold")) marks.push({ type: "bold" });
      return { ...n, marks };
    }
    return n.content ? { ...n, content: n.content.map(walk) } : n;
  };
  return nodes.map(walk) as T[];
}
