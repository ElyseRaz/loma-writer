import { builtinStyle, cleanStyles, STYLE_IDS, type DocStyles, type StyleId } from "../../editor/docStyles";
import { bulletFromChar, numberFromFormat } from "./listFormats";
import JSZip from "jszip";
import { pageFromDimensions } from "./page";
import { ensureBlocks, hasVisibleContent, heading, mergeText, paragraph, splitEquations, textNode, type PM, type RunProps } from "./pm";
import { corrupt, DocumentError, type ImportResult } from "./types";
import { first, kids, mimeForPath, parseXml, toDataUri } from "./xml";
import { mathmlOrOmmlLatex } from "./mathImport";
import { byLocalName } from "../math/mathml";
import { DEFAULT_SHAPE_STYLE, isKnownShape, NONE, TEXT_BOX } from "../../editor/shapes/catalog";
import type { Gradient, Shadow } from "../../editor/shapes/types";
import { sanitizeHeaderFooter, type HeaderFooterSettings } from "../../pagination/headerFooter";

interface Style {
  name: string;
  display: string;
  family: string;
  parent: string | null;
  run: RunProps;
  align?: string;
  lineHeight?: string;
  breakBefore: boolean;
  breakAfter: boolean;
  shading?: string;
  borders?: Record<string, boolean>;
  cellShading?: string;
  cellBorderless?: boolean;
  /** Minimum row height of a table-row style, in px. */
  rowHeightPx?: number;
  /** `style:graphic-properties` attributes (shapes, text frames). */
  gfx?: Record<string, string>;
  /** automatic styles always apply; named paragraph styles only when they are not generic body styles */
  automatic: boolean;
}

interface Ctx {
  styles: Map<string, Style>;
  listKinds: Map<string, Array<"bulletList" | "orderedList">>;
  /** Marker style (ours) of each level of a list style; null = default. */
  listTypes: Map<string, Array<string | null>>;
  columns: Map<string, number>; // table-column style -> width px
  images: Map<string, string>;
  /** "Object 1" -> LaTeX of the formula stored in that embedded object. */
  formulas: Map<string, string>;
  /** True while reading a header/footer: page-number fields become nodes. */
  fields?: boolean;
  /** `draw:gradient` definitions by name. */
  gradients?: Map<string, { style: string; start: string; end: string; angle: number }>;
  /** Page width and margins (px), to turn ODF positions into ours. */
  page?: { w: number; margins: { top: number; left: number; right: number } };
  warnings: Set<string>;
}

const px = (len: string | null): number | null => {
  const m = /^(-?[\d.]+)\s*(cm|mm|in|pt|px)?$/.exec(len ?? "");
  if (!m) return null;
  const v = +m[1];
  return { cm: (v * 96) / 2.54, mm: (v * 96) / 25.4, in: v * 96, pt: (v * 96) / 72, px: v, undefined: v }[(m[2] ?? "undefined") as "cm"];
};

function readRun(el: Element | null): RunProps {
  const p: RunProps = {};
  if (!el) return p;
  const a = (n: string) => el.getAttribute(n);
  const weight = a("fo:font-weight");
  if (weight) p.bold = weight === "bold" || +weight >= 600;
  const fs = a("fo:font-style");
  if (fs) p.italic = fs === "italic" || fs === "oblique";
  const u = a("style:text-underline-style");
  if (u) p.underline = u !== "none";
  const st = a("style:text-line-through-style");
  if (st) p.strike = st !== "none";
  const pos = a("style:text-position");
  if (pos) {
    const lead = pos.split(/\s+/)[0];
    p.sup = lead.startsWith("super") || (/^[\d.]+%$/.test(lead) && parseFloat(lead) > 0);
    p.sub = lead.startsWith("sub") || (/^-[\d.]+%$/.test(lead));
  }
  const color = a("fo:color");
  if (color && /^#[0-9a-f]{6}$/i.test(color)) p.color = color.toLowerCase();
  const size = a("fo:font-size");
  if (size?.match(/(pt|px|cm|mm|in)$/)) p.sizePt = +((px(size) ?? 0) * 0.75).toFixed(2) || undefined;
  const font = a("fo:font-family") ?? a("style:font-name");
  if (font) p.font = font.replace(/^['"]|['"]$/g, "");
  const bg = a("fo:background-color");
  if (bg && /^#[0-9a-f]{6}$/i.test(bg)) p.highlight = bg.toLowerCase();
  return p;
}

const merge = (base: RunProps, over: RunProps): RunProps => {
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
};

const ALIGN: Record<string, string> = { start: "left", left: "left", center: "center", end: "right", right: "right", justify: "justify" };

/** Background and borders written directly on a paragraph style. */
function paragraphDeco(pp: Element | null): { shading?: string; borders?: Record<string, boolean> } {
  if (!pp) return {};
  const bg = pp.getAttribute("fo:background-color");
  const all = pp.getAttribute("fo:border");
  const borders: Record<string, boolean> = {};
  for (const side of ["top", "right", "bottom", "left"]) {
    const v = pp.getAttribute(`fo:border-${side}`) ?? all;
    if (v && v !== "none" && !v.startsWith("0pt") && !v.startsWith("0cm")) borders[side] = true;
  }
  return { ...(bg && /^#[0-9a-f]{6}$/i.test(bg) ? { shading: bg.toLowerCase() } : {}), ...(Object.keys(borders).length ? { borders } : {}) };
}

function graphicProps(gp: Element | null): Record<string, string> | undefined {
  if (!gp) return undefined;
  const out: Record<string, string> = {};
  for (const a of Array.from(gp.attributes)) out[a.name] = a.value;
  return out;
}

function cellDeco(cp: Element | null): { cellShading?: string; cellBorderless?: boolean } {
  if (!cp) return {};
  const bg = cp.getAttribute("fo:background-color");
  return { ...(bg && /^#[0-9a-f]{6}$/i.test(bg) ? { cellShading: bg.toLowerCase() } : {}), ...(cp.getAttribute("fo:border") === "none" ? { cellBorderless: true } : {}) };
}

function collectStyles(docs: Document[], ctx: Ctx) {
  ctx.gradients = new Map();
  for (const doc of docs) {
    for (const g of Array.from(doc.getElementsByTagName("draw:gradient"))) {
      const name = g.getAttribute("draw:name");
      if (name) ctx.gradients.set(name, { style: g.getAttribute("draw:style") ?? "linear", start: (g.getAttribute("draw:start-color") ?? "#ffffff").toLowerCase(), end: (g.getAttribute("draw:end-color") ?? "#000000").toLowerCase(), angle: parseFloat(g.getAttribute("draw:angle") ?? "0") || 0 });
    }
  }
  for (const doc of docs) {
    for (const s of Array.from(doc.getElementsByTagName("style:style"))) {
      const name = s.getAttribute("style:name");
      if (!name) continue;
      const rowProps = first(s, "style:table-row-properties");
      const pp = first(s, "style:paragraph-properties");
      const lh = pp?.getAttribute("fo:line-height");
      ctx.styles.set(name, {
        name,
        display: (s.getAttribute("style:display-name") ?? name).toLowerCase(),
        family: s.getAttribute("style:family") ?? "",
        parent: s.getAttribute("style:parent-style-name"),
        run: readRun(first(s, "style:text-properties")),
        align: ALIGN[pp?.getAttribute("fo:text-align") ?? ""],
        lineHeight: lh?.endsWith("%") && Math.abs(parseFloat(lh) - 100) > 3 ? String(+(parseFloat(lh) / 100).toFixed(2)) : undefined,
        breakBefore: pp?.getAttribute("fo:break-before") === "page",
        breakAfter: pp?.getAttribute("fo:break-after") === "page",
        ...paragraphDeco(pp),
        ...cellDeco(first(s, "style:table-cell-properties")),
        gfx: graphicProps(first(s, "style:graphic-properties")),
        rowHeightPx: rowProps ? px(rowProps.getAttribute("style:min-row-height") ?? rowProps.getAttribute("style:row-height")) ?? undefined : undefined,
        automatic: s.parentNode?.nodeName === "office:automatic-styles",
      });
      if (s.getAttribute("style:family") === "table-column") {
        const w = px(first(s, "style:table-column-properties")?.getAttribute("style:column-width") ?? null);
        if (w) ctx.columns.set(name, w);
      }
    }
    for (const ls of Array.from(doc.getElementsByTagName("text:list-style"))) {
      const levels: Array<"bulletList" | "orderedList"> = [];
      for (const l of kids(ls)) levels[+(l.getAttribute("text:level") ?? 1) - 1] = l.nodeName === "text:list-level-style-number" ? "orderedList" : "bulletList";
      const types: Array<string | null> = [];
      for (const l of kids(ls)) {
        const i = +(l.getAttribute("text:level") ?? 1) - 1;
        types[i] = l.nodeName === "text:list-level-style-number" ? numberFromFormat(l.getAttribute("style:num-format"), "odf") : bulletFromChar(l.getAttribute("text:bullet-char"));
      }
      ctx.listTypes.set(ls.getAttribute("style:name") ?? "", types);
      ctx.listKinds.set(ls.getAttribute("style:name") ?? "", levels);
    }
  }
}

/** Normal, headings, quote and code styles as defined in styles.xml, minus what equals the built-in look. */
function readDocStyles(styles: Document | null): DocStyles {
  if (!styles) return {};
  const names: Record<StyleId, string[]> = { normal: ["Standard"], h1: ["Heading_20_1", "Heading 1"], h2: ["Heading_20_2", "Heading 2"], h3: ["Heading_20_3", "Heading 3"], quote: ["Quote"], code: ["Preformatted_20_Text", "Preformatted Text"] };
  const all = Array.from(styles.getElementsByTagName("style:style")).filter((s) => s.parentNode?.nodeName === "office:styles");
  const out: DocStyles = {};
  const pt = (v: string | null) => { const n = px(v); return n === null ? undefined : Math.round(n * 0.75 * 2) / 2; };
  for (const id of STYLE_IDS) {
    const el = all.find((s) => names[id].includes(s.getAttribute("style:name") ?? ""));
    if (!el) continue;
    const pp = first(el, "style:paragraph-properties");
    const run = readRun(first(el, "style:text-properties"));
    const lh = pp?.getAttribute("fo:line-height");
    const align = ALIGN[pp?.getAttribute("fo:text-align") ?? ""];
    const raw: Record<string, unknown> = {
      ...(id !== "normal" && run.font && !(id === "code" && /mono|courier|consolas/i.test(run.font)) ? { fontFamily: run.font } : {}),
      ...(id !== "normal" && run.sizePt ? { sizePt: run.sizePt } : {}),
      ...(run.color ? { color: run.color } : {}), ...(run.bold !== undefined ? { bold: run.bold } : {}), ...(run.italic !== undefined ? { italic: run.italic } : {}),
      ...(align && align !== "left" ? { align } : {}),
      ...(pt(pp?.getAttribute("fo:margin-top") ?? null) !== undefined ? { spaceBefore: pt(pp!.getAttribute("fo:margin-top")) } : {}),
      ...(pt(pp?.getAttribute("fo:margin-bottom") ?? null) !== undefined ? { spaceAfter: pt(pp!.getAttribute("fo:margin-bottom")) } : {}),
      ...(lh?.endsWith("%") ? { lineHeight: parseFloat(lh) / 100 } : {}),
    };
    const base = builtinStyle(id, { fontFamily: "", sizePt: 11 }) as unknown as Record<string, unknown>;
    const diff = Object.fromEntries(Object.entries(raw).filter(([k, v]) => k === "fontFamily" || (typeof v === "number" ? Math.abs(v - (base[k] as number)) > 0.25 : v !== base[k])));
    if (Object.keys(diff).length) out[id] = diff;
  }
  return cleanStyles(out);
}

function chain(ctx: Ctx, name: string | null): Style[] {
  const out: Style[] = [];
  for (let cur = name, guard = 0; cur && guard < 12; guard++) {
    const s = ctx.styles.get(cur);
    if (!s) break;
    out.unshift(s);
    cur = s.parent;
  }
  return out;
}

type Kind = { kind: "normal" } | { kind: "heading"; level: number } | { kind: "quote" } | { kind: "code" };
function kindOf(ctx: Ctx, name: string | null): Kind {
  for (const s of [...chain(ctx, name)].reverse()) {
    const h = /^heading[ _](\d+)$/.exec(s.display.replace(/_20_/g, " ")) ?? /^heading[ _]?(\d+)$/.exec(s.name.toLowerCase().replace(/_20_/g, " "));
    if (h) return { kind: "heading", level: Math.min(3, +h[1]) };
    if (s.display === "title") return { kind: "heading", level: 1 };
    if (["quote", "quotations", "block quote", "citation", "citations"].includes(s.display)) return { kind: "quote" };
    if (["preformatted text", "source text", "source code", "code", "texte préformaté"].includes(s.display)) return { kind: "code" };
  }
  return { kind: "normal" };
}

const GENERIC = new Set(["standard", "text body", "default paragraph style", "body text", "default"]);

function paraRun(ctx: Ctx, name: string | null, kind: Kind): RunProps {
  if (kind.kind !== "normal") return {};
  return chain(ctx, name).filter((s) => s.automatic || !GENERIC.has(s.display)).reduce((acc, s) => merge(acc, s.run), {} as RunProps);
}
const spanRun = (ctx: Ctx, name: string | null) => chain(ctx, name).reduce((acc, s) => merge(acc, s.run), {} as RunProps);

function frameImage(ctx: Ctx, frame: Element): PM | null {
  const obj = first(frame, "draw:object");
  if (obj) {
    const latex = ctx.formulas.get((obj.getAttribute("xlink:href") ?? "").replace(/^\.\//, "").replace(/\/$/, ""));
    if (latex) return { type: "equation", attrs: { latex } };
  }
  if (first(frame, "draw:text-box")) { ctx.warnings.add("Zones de texte : non prises en charge, ignorées."); return null; }
  const img = first(frame, "draw:image");
  const href = img?.getAttribute("xlink:href");
  if (!img || !href) { ctx.warnings.add("Objets incorporés (formules, diagrammes…) : ignorés."); return null; }
  const src = ctx.images.get(href.replace(/^\.\//, ""));
  if (!src) { ctx.warnings.add("Une image du document est introuvable dans le fichier."); return null; }
  if (frame.getAttribute("text:anchor-type") && frame.getAttribute("text:anchor-type") !== "as-char")
    ctx.warnings.add("Images flottantes : le positionnement n'est pas conservé, elles sont placées dans le texte.");
  const w = px(frame.getAttribute("svg:width"));
  const h = px(frame.getAttribute("svg:height"));
  const alt = first(frame, "svg:desc")?.textContent ?? undefined;
  return { type: "image", attrs: { src, ...(alt ? { alt } : {}), ...(w && h ? { width: Math.round(w), height: Math.round(h) } : {}) } };
}

const ODF_SHAPES: Record<string, string> = {
  rectangle: "rect", "round-rectangle": "roundRect", ellipse: "ellipse", "isosceles-triangle": "triangle", "right-triangle": "rtTriangle", diamond: "diamond", parallelogram: "parallelogram",
  trapezoid: "trapezoid", pentagon: "pentagon", hexagon: "hexagon", octagon: "octagon", cross: "plus", heart: "heart", cloud: "cloud", lightning: "lightningBolt", moon: "moon", ring: "donut",
  "right-arrow": "rightArrow", "left-arrow": "leftArrow", "up-arrow": "upArrow", "down-arrow": "downArrow", "left-right-arrow": "leftRightArrow", "up-down-arrow": "upDownArrow",
  chevron: "chevron", "pentagon-right": "homePlate", star4: "star4", star5: "star5", star6: "star6", star8: "star8", "rectangular-callout": "wedgeRectCallout", "round-callout": "wedgeEllipseCallout",
};

const cmOf = (v: string | null) => (px(v) ?? 0);

const hexOf = (v: string | undefined) => (v && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : undefined);
const clampZ = (n: number) => Math.max(-49, Math.min(49, n));

/** Translation and rotation of `draw:transform="rotate (a) translate (x y)"` (angle in radians, counter-clockwise). */
function parseTransform(t: string | null): { rotation: number; x: number | null; y: number | null } {
  if (!t) return { rotation: 0, x: null, y: null };
  const rot = /rotate\s*\(\s*([-+\d.eE]+)/.exec(t);
  const tr = /translate\s*\(\s*([-+\d.eE]+)([a-z]*)\s+([-+\d.eE]+)([a-z]*)/.exec(t);
  const deg = rot ? ((-parseFloat(rot[1]) * 180) / Math.PI + 360) % 360 : 0;
  return { rotation: Math.round(deg * 10) / 10, x: tr ? px(tr[1] + (tr[2] || "cm")) : null, y: tr ? px(tr[3] + (tr[4] || "cm")) : null };
}

/** Wrap, anchoring and position of a drawing element, in our terms (see `resolvePlacements` for DOCX). */
function odfPlacement(ctx: Ctx, el: Element, style: Record<string, string>, w: number, h: number, pos: { x: number | null; y: number | null }) {
  const at = el.getAttribute("text:anchor-type");
  if (!at || at === "as-char") return { wrap: "inline", anchor: "paragraph", x: 0, y: 0 };
  const ws = style["style:wrap"];
  const wrap = ws === "run-through" ? (style["style:run-through"] === "background" ? "behind" : "front") : ["parallel", "dynamic", "biggest", "left", "right"].includes(ws) ? "square" : ws === "none" ? "topBottom" : "front";
  const page = ctx.page ?? { w: 794, margins: { top: 96, left: 96, right: 96 } };
  const contentW = page.w - page.margins.left - page.margins.right;
  const hRel = style["style:horizontal-rel"] ?? (at === "page" ? "page" : "paragraph");
  const vRel = style["style:vertical-rel"] ?? (at === "page" ? "page" : "paragraph");
  const hPage = hRel === "page" || hRel === "page-start-margin" || hRel === "page-end-margin";
  const hContent = hRel === "page-content";
  const hPos = style["style:horizontal-pos"] ?? "from-left";
  let x = pos.x ?? 0;
  if (hPos === "center") x = ((hPage ? page.w : contentW) - w) / 2;
  else if (hPos === "right") x = (hPage ? page.w : contentW) - w;
  else if (hPos === "left") x = 0;
  const vPage = vRel === "page";
  const vContent = vRel === "page-content";
  let y = pos.y ?? 0;
  void h;
  let anchor: "paragraph" | "page";
  if (!vPage && !vContent) {
    anchor = "paragraph";
    if (hPage) x -= page.margins.left;
    else if (hContent) x -= 0;
  } else {
    anchor = "page";
    if (!hPage) x += page.margins.left;
    if (vContent) y += page.margins.top;
  }
  if ((wrap === "square" || wrap === "topBottom") && anchor === "page") { x -= page.margins.left; y = 0; anchor = "paragraph"; }
  return { wrap, anchor, x: Math.round(x), y: Math.round(y) };
}

/** Fill, outline, shadow and gradient written in a graphic style. */
function graphicLook(ctx: Ctx, style: Record<string, string>, isBox: boolean) {
  const base = isBox ? { fill: "#ffffff", stroke: "#6b7280", strokeWidth: 1 } : DEFAULT_SHAPE_STYLE;
  let fill: string = base.fill, stroke: string = base.stroke, strokeWidth = base.strokeWidth;
  let gradient: Gradient | null = null;
  if (isBox) {
    const border = style["fo:border"];
    const bm = border && border !== "none" ? /([\d.]+)(pt|px|cm|mm)?\s+\w+\s+(#[0-9a-f]{6})/i.exec(border) : null;
    stroke = border === "none" || !border ? NONE : bm ? bm[3].toLowerCase() : base.stroke;
    if (bm) strokeWidth = Math.round(Math.max(0.5, px(`${bm[1]}${bm[2] ?? "pt"}`) ?? 1) * 10) / 10;
    fill = hexOf(style["fo:background-color"]) ?? NONE;
  } else {
    fill = style["draw:fill"] === "none" ? NONE : hexOf(style["draw:fill-color"]) ?? base.fill;
    stroke = style["draw:stroke"] === "none" ? NONE : hexOf(style["svg:stroke-color"]) ?? base.stroke;
    strokeWidth = style["svg:stroke-width"] ? Math.round(Math.max(0.5, px(style["svg:stroke-width"]) ?? base.strokeWidth) * 10) / 10 : base.strokeWidth;
  }
  if (style["draw:fill"] === "gradient" || (isBox && style["draw:fill"] === "gradient")) {
    const g = ctx.gradients?.get(style["draw:fill-gradient-name"] ?? "");
    if (g) {
      gradient = g.style === "radial" || g.style === "ellipsoid" || g.style === "square" || g.style === "rectangular"
        ? { type: "radial", angle: 0, stops: [{ pos: 0, color: g.end }, { pos: 100, color: g.start }] }
        : { type: "linear", angle: (((90 - g.angle) % 360) + 360) % 360, stops: [{ pos: 0, color: g.start }, { pos: 100, color: g.end }] };
      fill = gradient.stops[0].color;
    }
  }
  let shadow: Shadow | null = null;
  if (style["draw:shadow"] === "visible") {
    const opacity = parseFloat(style["draw:shadow-opacity"] ?? "100") / 100;
    shadow = { color: hexOf(style["draw:shadow-color"]) ?? "#808080", opacity: Number.isFinite(opacity) ? opacity : 1, blur: Math.round(px(style["loext:shadow-blur"] ?? "0cm") ?? 0), dx: Math.round(px(style["draw:shadow-offset-x"] ?? "0cm") ?? 0), dy: Math.round(px(style["draw:shadow-offset-y"] ?? "0cm") ?? 0) };
  }
  return { fill, stroke, strokeWidth, gradient, shadow };
}

const titleOf = (el: Element) => kids(el).find((k) => k.nodeName === "svg:title")?.textContent ?? "";
const zOf = (el: Element) => { const z = el.getAttribute("draw:z-index"); return z === null ? 0 : clampZ(parseInt(z, 10) - 50); };

/** A straight line (`draw:line` / `draw:connector`) as a line shape (a slanted line is a rotated one). */
function lineNode(ctx: Ctx, el: Element): PM {
  const style = ctx.styles.get(el.getAttribute("draw:style-name") ?? "")?.gfx ?? {};
  const [x1, y1, x2, y2] = ["svg:x1", "svg:y1", "svg:x2", "svg:y2"].map((n) => cmOf(el.getAttribute(n)));
  const length = Math.max(24, Math.round(Math.hypot(x2 - x1, y2 - y1)));
  const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  const rotation = Math.abs(y2 - y1) < 1 && x2 >= x1 ? 0 : Math.round(((angle % 360) + 360) % 360);
  const height = 24;
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  const place = odfPlacement(ctx, el, style, length, height, { x: cx - length / 2, y: cy - height / 2 });
  return {
    type: "shape",
    attrs: {
      kind: "line", width: length, height, fill: NONE,
      stroke: hexOf(style["svg:stroke-color"]) ?? "#242424",
      strokeWidth: style["svg:stroke-width"] ? Math.round(Math.max(0.5, px(style["svg:stroke-width"]) ?? 2) * 10) / 10 : 2,
      rotation, gradient: null, shadow: null, alt: titleOf(el), z: zOf(el), align: "left", ...place,
    },
    content: [],
  };
}

/** A custom shape or text box as a shape node, with its placement, gradient, shadow and rotation. */
function shapeNode(ctx: Ctx, el: Element, isBox: boolean): PM {
  const style = ctx.styles.get(el.getAttribute("draw:style-name") ?? "")?.gfx ?? {};
  const tr = parseTransform(el.getAttribute("draw:transform"));
  let kind = TEXT_BOX;
  if (!isBox) {
    const type = first(el, "draw:enhanced-geometry")?.getAttribute("draw:type") ?? "rectangle";
    const id = type.startsWith("ooxml-") ? type.slice(6) : ODF_SHAPES[type] ?? type;
    if (isKnownShape(id)) kind = id;
    else { ctx.warnings.add(`Forme « ${type} » non prise en charge : remplacée par un rectangle.`); kind = "rect"; }
    // A rotated text box is written as a rectangle named "Zone de texte".
    if (kind === "rect" && (el.getAttribute("draw:name") ?? "").startsWith("Zone de texte")) kind = TEXT_BOX;
  }
  const isFrame = isBox;
  const width = Math.round(cmOf(el.getAttribute("svg:width"))) || 160;
  const height = Math.round(cmOf(el.getAttribute("svg:height") ?? el.getAttribute("fo:min-height"))) || (isFrame ? 60 : 100);
  const look = graphicLook(ctx, style, kind === TEXT_BOX);
  const pos = { x: tr.x ?? (el.hasAttribute("svg:x") ? cmOf(el.getAttribute("svg:x")) : null), y: tr.y ?? (el.hasAttribute("svg:y") ? cmOf(el.getAttribute("svg:y")) : null) };
  const place = odfPlacement(ctx, el, style, width, height, pos);
  const defaultAlign = kind === TEXT_BOX ? "left" : "center";
  const holder = isBox ? first(el, "draw:text-box") ?? el : el;
  const paragraphs: PM[] = kids(holder).filter((k) => k.nodeName === "text:p" || k.nodeName === "text:h").map((p) => {
    const { node } = convertPara(ctx, p);
    const a = { ...(node.attrs ?? {}) } as Record<string, unknown>;
    delete a.level;
    if (a.textAlign === defaultAlign) delete a.textAlign;
    return { type: "paragraph", ...(Object.keys(a).length ? { attrs: a } : {}), ...(node.content?.length ? { content: node.content.filter((c) => c.type === "text" || c.type === "hardBreak") } : {}) } as PM;
  });
  return {
    type: "shape",
    attrs: { kind, width, height, ...look, rotation: tr.rotation, alt: titleOf(el), z: zOf(el), align: "left", ...place },
    content: kind === "line" ? [] : paragraphs.length ? paragraphs : [{ type: "paragraph" }],
  };
}

/** `draw:g`: children keep absolute positions in ODF; they become positions inside the group's box. */
function groupNode(ctx: Ctx, el: Element): PM | null {
  const members: PM[] = [];
  const visit = (g: Element) => {
    for (const k of kids(g)) {
      if (k.nodeName === "draw:custom-shape") members.push(shapeNode(ctx, k, false));
      else if (k.nodeName === "draw:frame" && first(k, "draw:text-box")) members.push(shapeNode(ctx, k, true));
      else if (k.nodeName === "draw:line" || k.nodeName === "draw:connector") members.push(lineNode(ctx, k));
      else if (k.nodeName === "draw:g") visit(k);
    }
  };
  visit(el);
  if (!members.length) return null;
  const boxes = members.map((m) => ({ m, x: Number(m.attrs!.x), y: Number(m.attrs!.y), w: Number(m.attrs!.width), h: Number(m.attrs!.height) }));
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w)), y1 = Math.max(...boxes.map((b) => b.y + b.h));
  const lead = members[0].attrs!;
  const wrap = lead.wrap === "inline" ? "inline" : lead.wrap;
  return {
    type: "shapeGroup",
    attrs: { width: Math.round(x1 - x0), height: Math.round(y1 - y0), rotation: 0, wrap, anchor: lead.anchor, x: wrap === "inline" ? 0 : x0, y: wrap === "inline" ? 0 : y0, z: lead.z, align: "left", alt: "" },
    content: boxes.map((b) => ({ ...b.m, attrs: { ...b.m.attrs, wrap: "group", anchor: "paragraph", x: Math.round(b.x - x0), y: Math.round(b.y - y0), z: 0 } })),
  };
}

function inlineOf(ctx: Ctx, parent: Element, base: RunProps, out: PM[]) {
  for (let n = parent.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3) {
      const t = (n.nodeValue ?? "").replace(/[ \t\r\n]+/g, " ");
      if (t) out.push(textNode(t, base));
      continue;
    }
    if (n.nodeType !== 1) continue;
    const el = n as Element;
    switch (el.nodeName) {
      case "text:span": inlineOf(ctx, el, merge(base, spanRun(ctx, el.getAttribute("text:style-name"))), out); break;
      case "text:a": {
        // Internal links may carry a LibreOffice type suffix: "#name|outline".
        const raw = el.getAttribute("xlink:href");
        const href = raw?.startsWith("#") ? `#${encodeURIComponent(raw.slice(1).split("|")[0])}` : raw;
        inlineOf(ctx, el, { ...merge(base, spanRun(ctx, el.getAttribute("text:style-name"))), ...(href ? { link: href } : {}) }, out);
        break;
      }
      case "text:bookmark": case "text:bookmark-start": { const name = el.getAttribute("text:name"); if (name) out.push({ type: "bookmark", attrs: { name } }); break; }
      case "text:page-number": if (ctx.fields) out.push({ type: "pageField", attrs: { kind: "page" } }); else inlineOf(ctx, el, base, out); break;
      case "text:page-count": if (ctx.fields) out.push({ type: "pageField", attrs: { kind: "pages" } }); else inlineOf(ctx, el, base, out); break;
      case "text:s": out.push(textNode(" ".repeat(+(el.getAttribute("text:c") ?? 1)), base)); break;
      case "text:tab": out.push(textNode("\t", base)); break;
      case "text:line-break": out.push({ type: "hardBreak" }); break;
      case "draw:custom-shape": out.push(shapeNode(ctx, el, false)); break;
      case "draw:line": case "draw:connector": out.push(lineNode(ctx, el)); break;
      case "draw:g": { const g = groupNode(ctx, el); if (g) out.push(g); break; }
      case "draw:frame": {
        if (first(el, "draw:text-box")) { out.push(shapeNode(ctx, el, true)); break; }
        const img = frameImage(ctx, el);
        if (img) out.push(img);
        break;
      }
      case "text:note": ctx.warnings.add("Notes de bas de page et de fin : non prises en charge, ignorées."); break;
      case "office:annotation": ctx.warnings.add("Commentaires : non pris en charge, ignorés."); break;
      case "text:soft-page-break": case "text:bookmark-end": case "text:change": case "text:change-start": case "text:change-end": break;
      default: if (el.nodeName.startsWith("text:")) inlineOf(ctx, el, base, out);
    }
  }
}

function convertPara(ctx: Ctx, el: Element): { node: PM; kind: Kind; before: boolean; after: boolean } {
  const styleName = el.getAttribute("text:style-name");
  let kind = kindOf(ctx, styleName);
  if (el.nodeName === "text:h") {
    const lvl = +(el.getAttribute("text:outline-level") ?? 1);
    if (lvl > 3) ctx.warnings.add("Titres de niveau 4 à 9 ramenés au niveau 3.");
    kind = { kind: "heading", level: Math.min(3, lvl) };
  }
  const st = chain(ctx, styleName);
  const align = [...st].reverse().find((s) => s.align)?.align;
  const lineHeight = [...st].reverse().find((s) => s.lineHeight && (s.automatic || !GENERIC.has(s.display)) && kind.kind === "normal")?.lineHeight;
  const base = paraRun(ctx, styleName, kind);
  if (lineHeight) base.lineHeight = lineHeight;
  const own = ctx.styles.get(styleName ?? "");
  // Only an automatic (direct) style decorates a paragraph; named styles such as Quote keep their own look.
  const deco = own?.automatic ? { shading: own.shading, borders: own.borders } : undefined;
  const inline: PM[] = [];
  inlineOf(ctx, el, kind.kind === "heading" ? { ...base, bold: undefined, sizePt: undefined } : base, inline);
  const content = splitEquations(mergeText(inline));
  return { node: kind.kind === "heading" ? heading(kind.level, content, align, deco) : paragraph(content, align, deco), kind, before: !!own?.breakBefore, after: !!own?.breakAfter };
}

function convertTable(ctx: Ctx, tbl: Element): PM {
  const colWidths: number[] = [];
  for (const c of kids(tbl).filter((k) => k.nodeName === "table:table-column" || k.nodeName === "table:table-columns"))
    for (const col of c.nodeName === "table:table-columns" ? kids(c) : [c]) {
      const w = ctx.columns.get(col.getAttribute("table:style-name") ?? "") ?? 0;
      for (let i = 0; i < Math.min(200, +(col.getAttribute("table:number-columns-repeated") ?? 1)); i++) colWidths.push(Math.round(w));
    }
  const rows: PM[] = [];
  const addRows = (container: Element, header: boolean) => {
    for (const r of kids(container)) {
      if (r.nodeName === "table:table-header-rows") addRows(r, true);
      else if (r.nodeName === "table:table-rows" || r.nodeName === "table:table-row-group") addRows(r, header);
      else if (r.nodeName === "table:table-row") {
        const cells: PM[] = [];
        let col = 0;
        for (const c of kids(r)) {
          const repeat = Math.min(100, +(c.getAttribute("table:number-columns-repeated") ?? 1));
          if (c.nodeName === "table:covered-table-cell") { col += repeat; continue; }
          if (c.nodeName !== "table:table-cell") continue;
          const colspan = +(c.getAttribute("table:number-columns-spanned") ?? 1);
          const rowspan = +(c.getAttribute("table:number-rows-spanned") ?? 1);
          for (let i = 0; i < repeat; i++) {
            const widths = colWidths.slice(col, col + colspan);
            const cs = ctx.styles.get(c.getAttribute("table:style-name") ?? "");
            // The default grey of header cells is not an explicit shading.
            const shade = cs?.cellShading && !(header && cs.cellShading === "#f3f4f6") ? cs.cellShading : undefined;
            cells.push({
              type: header ? "tableHeader" : "tableCell",
              attrs: { colspan, rowspan, ...(shade ? { shading: shade } : {}), ...(cs?.cellBorderless ? { borderless: true } : {}), ...(widths.length === colspan && widths.every((w) => w > 0) ? { colwidth: widths } : {}) },
              content: ensureBlocks(convertBlocks(ctx, c, null, 0)),
            });
            col += colspan;
          }
        }
        for (let i = 0; i < Math.min(100, +(r.getAttribute("table:number-rows-repeated") ?? 1)); i++) { const h = ctx.styles.get(r.getAttribute("table:style-name") ?? "")?.rowHeightPx; rows.push({ type: "tableRow", ...(h && h >= 18 && h <= 1500 ? { attrs: { rowHeight: Math.round(h) } } : {}), content: JSON.parse(JSON.stringify(cells)) }); }
      }
    }
  };
  addRows(tbl, false);
  return { type: "table", content: rows };
}

/** Shapes are blocks. Inline ones split the paragraph; free ones (anchored here) are placed before it. */
function hoistShapes(node: PM, out: PM[]) {
  const content = node.content ?? [];
  const isObj = (n: PM) => n.type === "shape" || n.type === "shapeGroup";
  if (node.type !== "paragraph" || !content.some(isObj)) { out.push(node); return; }
  const align = node.attrs?.textAlign;
  out.push(...content.filter((n) => isObj(n) && n.attrs?.wrap !== "inline").map((n) => ({ ...n, attrs: { ...n.attrs, align: "left" } })));
  let cur: PM[] = [];
  const flush = () => { if (cur.length) out.push({ ...node, content: cur }); cur = []; };
  for (const n of content) {
    if (isObj(n) && n.attrs?.wrap === "inline") { flush(); out.push({ ...n, attrs: { ...n.attrs, align: align === "center" || align === "right" ? align : "left" } }); }
    else if (!isObj(n)) cur.push(n);
  }
  flush();
}

function convertBlocks(ctx: Ctx, container: Element, listStyle: string | null, depth: number): PM[] {
  const out: PM[] = [];
  let quote: PM | null = null;
  let code: PM | null = null;
  for (const el of kids(container)) {
    switch (el.nodeName) {
      case "text:h": case "text:p": {
        const { node, kind, before, after } = convertPara(ctx, el);
        if (before) { quote = code = null; out.push({ type: "pageBreak" }); }
        if (after && !node.content?.length) { quote = code = null; out.push({ type: "pageBreak" }); break; }
        if (kind.kind === "quote") { code = null; if (!quote) { quote = { type: "blockquote", content: [] }; out.push(quote); } quote.content!.push(node); }
        else if (kind.kind === "code") {
          quote = null;
          const text = (node.content ?? []).map((c) => c.text ?? "").join("");
          if (!code) { code = { type: "codeBlock", content: text ? [{ type: "text", text }] : [] }; out.push(code); }
          else code.content = [{ type: "text", text: `${(code.content ?? []).map((c) => c.text).join("")}\n${text}` }];
        } else { quote = code = null; hoistShapes(node, out); }
        if (after) { quote = code = null; out.push({ type: "pageBreak" }); }
        break;
      }
      case "text:list": {
        quote = code = null;
        const style = el.getAttribute("text:style-name") ?? listStyle;
        const kind = ctx.listKinds.get(style ?? "")?.[depth] ?? "bulletList";
        const items = kids(el)
          .filter((i) => i.nodeName === "text:list-item" || i.nodeName === "text:list-header")
          .map((i): PM => ({ type: "listItem", content: ensureBlocks(convertBlocks(ctx, i, style, depth + 1)) }));
        const listType = ctx.listTypes.get(style ?? "")?.[depth] ?? null;
        out.push({ type: kind, ...(listType ? { attrs: { listType } } : {}), content: items });
        break;
      }
      case "table:table": quote = code = null; out.push(convertTable(ctx, el)); break;
      case "text:section": case "text:index-body": quote = code = null; out.push(...convertBlocks(ctx, el, listStyle, depth)); break;
      case "text:table-of-content": ctx.warnings.add("Tables des matières : remplacées par leur dernier contenu généré."); out.push(...convertBlocks(ctx, first(el, "text:index-body") ?? el, listStyle, depth)); break;
      case "text:tracked-changes": ctx.warnings.add("Suivi des modifications : non pris en charge."); break;
      case "draw:frame": {
        if (first(el, "draw:text-box")) { out.push(shapeNode(ctx, el, true)); break; }
        const img = frameImage(ctx, el);
        if (img) out.push(paragraph([img]));
        break;
      }
      case "draw:custom-shape": out.push(shapeNode(ctx, el, false)); break;
      case "draw:line": case "draw:connector": out.push(lineNode(ctx, el)); break;
    }
  }
  return out;
}

function readHeadersFooters(ctx: Ctx, master: Element): HeaderFooterSettings | undefined {
  const out: HeaderFooterSettings = { header: {}, footer: {}, titlePage: false, evenOdd: false };
  ctx.fields = true;
  for (const kind of ["header", "footer"] as const) {
    const set = out[kind];
    for (const [tag, slot] of [[kind, "default"], [`${kind}-first`, "first"], [`${kind}-left`, "even"]] as const) {
      const el = kids(master).find((k) => k.nodeName === `style:${tag}`);
      if (!el) continue;
      set[slot] = { blocks: convertBlocks(ctx, el, null, 0) };
      if (slot === "first") out.titlePage = true;
      if (slot === "even") out.evenOdd = true;
    }
  }
  ctx.fields = false;
  const clean = sanitizeHeaderFooter(out);
  const any = (s: HeaderFooterSettings["header"]) => !!(s.default || s.first || s.even);
  if (!any(clean.header) && !any(clean.footer)) return undefined;
  clean.titlePage = out.titlePage && !!(clean.header.first || clean.footer.first);
  clean.evenOdd = out.evenOdd && !!(clean.header.even || clean.footer.even);
  return clean;
}

export async function importOdt(bytes: Uint8Array): Promise<ImportResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw corrupt("archive ZIP illisible");
  }
  const contentXml = await zip.file("content.xml")?.async("string");
  if (!contentXml) throw corrupt("content.xml est absent : ce n'est pas un document ODT");
  const stylesXml = await zip.file("styles.xml")?.async("string");
  const content = parseXml(contentXml, "content.xml");
  const styles = stylesXml ? parseXml(stylesXml, "styles.xml") : null;

  const images = new Map<string, string>();
  for (const path of Object.keys(zip.files)) {
    const mime = mimeForPath(path);
    if (mime && !zip.files[path].dir) images.set(path, toDataUri(await zip.file(path)!.async("uint8array"), mime));
  }
  const formulas = new Map<string, string>();
  for (const path of Object.keys(zip.files).filter((p) => /^Object [^/]+\/content\.xml$/.test(p))) {
    try {
      const math = byLocalName(parseXml(await zip.file(path)!.async("string"), path), "math")[0];
      if (math) formulas.set(path.replace(/\/content\.xml$/, ""), mathmlOrOmmlLatex(math));
    } catch { /* an unreadable formula is reported below, as an unsupported object */ }
  }
  const ctx: Ctx = { styles: new Map(), listKinds: new Map(), listTypes: new Map(), columns: new Map(), images, formulas, warnings: new Set() };
  collectStyles(styles ? [styles, content] : [content], ctx);

  const text = first(content, "office:text");
  if (!text) throw corrupt("corps du document absent");

  // Page setup from the first master page (read first: positions of free shapes depend on it).
  let page = pageFromDimensions(794, 1123, null, ctx.warnings);
  const master = styles ? first(styles, "style:master-page") : null;
  const layoutName = master?.getAttribute("style:page-layout-name");
  const layout = styles ? Array.from(styles.getElementsByTagName("style:page-layout")).find((l) => l.getAttribute("style:name") === layoutName) ?? first(styles, "style:page-layout") : null;
  const props = layout ? first(layout, "style:page-layout-properties") : null;
  let pageW = 794;
  let margins = { top: 96, left: 96, right: 96 };
  if (props) {
    const w = px(props.getAttribute("fo:page-width"));
    const h = px(props.getAttribute("fo:page-height"));
    const side = (name: string) => px(props.getAttribute(name)) ?? 96;
    if (w && h) {
      page = pageFromDimensions(w, h, { top: side("fo:margin-top"), right: side("fo:margin-right"), bottom: side("fo:margin-bottom"), left: side("fo:margin-left") }, ctx.warnings, { mirrored: layout?.getAttribute("style:page-usage") === "mirrored" });
      pageW = w;
      margins = { top: side("fo:margin-top"), left: side("fo:margin-left"), right: side("fo:margin-right") };
    }
  }
  ctx.page = { w: pageW, margins };
  const blocks = convertBlocks(ctx, text, null, 0);
  const headerFooter = master ? readHeadersFooters(ctx, master) : undefined;

  if (!hasVisibleContent(blocks)) {
    const hasSource = !!text.textContent?.trim() || text.getElementsByTagName("draw:image").length > 0 || text.getElementsByTagName("table:table").length > 0;
    if (hasSource) throw new DocumentError("unreadable-content", "Le contenu de ce document n'a pas pu être lu : il utilise des éléments que Loma Writer ne sait pas importer.");
  }
  const docStyles = readDocStyles(styles);
  return { model: { content: { type: "doc", content: ensureBlocks(blocks) }, page, ...(headerFooter ? { headerFooter } : {}), ...(Object.keys(docStyles).length ? { styles: docStyles } : {}) }, warnings: [...ctx.warnings] };
}
