import type { ParagraphLayout } from "../../editor/ParagraphFormat";
import { builtinStyle, cleanStyles, STYLE_IDS, type DocStyles, type StyleId } from "../../editor/docStyles";
import { bulletFromChar, numberFromFormat } from "./listFormats";
import { ODF_SHAPES } from "./odfShapes";
import JSZip from "jszip";
import { pageFromDimensions } from "./page";
import { cleanLabel } from "../../editor/references/Captions";
import { bodyText, cleanBody, type NoteParagraph } from "../../editor/references/noteBody";
import { cleanNotesOptions, DEFAULT_NOTES, type NoteNumbering, type NotesOptions } from "../../editor/references/notesNumbering";
import { cleanSource, cleanSources, isCitationStyle, type CitationStyle, type Source } from "../../editor/references/sources";
import { resolveTocTargets, type JsonNode } from "../../editor/references/tocBuild";
import { ensureBlocks, hasVisibleContent, heading, mergeText, paragraph, splitEquations, textNode, type PM, type RunProps } from "./pm";
import { corrupt, DocumentError, type ImportResult } from "./types";
import { assertSafeZip, first, kids, mimeForPath, parseXml, toDataUri } from "./xml";
import { mathmlOrOmmlLatex } from "./mathImport";
import { byLocalName } from "../math/mathml";
import { DEFAULT_SHAPE_STYLE, isKnownShape, NONE, TEXT_BOX } from "../../editor/shapes/catalog";
import type { Gradient, Shadow } from "../../editor/shapes/types";
import { sanitizeHeaderFooter, type HeaderFooterSettings } from "../../pagination/headerFooter";
import { formatPageNumber, type PageNumberFormat } from "../../pagination/pageNumber";
import type { ColumnsSpec, PageSetup } from "../../state/types";
import { DEFAULT_COLUMN_GAP_CM, MAX_COLUMNS } from "../../state/page";

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
  columnAfter: boolean;
  shading?: string;
  borders?: Record<string, boolean>;
  cellShading?: string;
  cellBorderless?: boolean;
  /** `style:page-number`: the paragraph restarts the page numbering at this number. */
  pageNumber?: number;
  /** `style:master-page-name`: a paragraph with this style starts a new page with that master page (a new section). */
  masterPage?: string;
  /** Indents, spacing and page-flow options of the paragraph style. */
  layout?: Partial<ParagraphLayout>;
  /** Minimum row height of a table-row style, in px. */
  rowHeightPx?: number;
  /** `style:graphic-properties` attributes (shapes, text frames). */
  gfx?: Record<string, string>;
  /** automatic styles always apply; named paragraph styles only when they are not generic body styles */
  automatic: boolean;
}

interface ListLevel {
  format: PageNumberFormat | "none";
  prefix: string;
  suffix: string;
  displayLevels: number;
  /** LibreOffice's full format, e.g. "Chapitre %2%:" (%N% is the counter of level N). */
  template: string | null;
  start: number;
  /** What follows the number: nothing, a space or a tab. */
  followed: string;
}

const ODF_FORMATS: Record<string, PageNumberFormat | "none"> = { "1": "decimal", I: "upperRoman", i: "lowerRoman", A: "upperLetter", a: "lowerLetter", "": "none" };

interface Ctx {
  styles: Map<string, Style>;
  listKinds: Map<string, Array<"bulletList" | "orderedList">>;
  /** Marker style (ours) of each level of a list style; null = default. */
  listTypes: Map<string, Array<string | null>>;
  /** Numbering of each level of a list style (headings numbered by a list: "Chapitre 1 :", "1.1."). */
  listLevels: Map<string, Array<ListLevel | undefined>>;
  /** Counters of the headings numbered by each list style (they go on from one list to the next). */
  listCounters: Map<string, number[]>;
  columns: Map<string, number>; // table-column style -> width px
  images: Map<string, string>;
  /** "Object 1" -> LaTeX of the formula stored in that embedded object. */
  formulas: Map<string, string>;
  /** True while reading a header/footer: page-number fields become nodes. */
  fields?: boolean;
  /** `draw:gradient` definitions by name. */
  gradients?: Map<string, { style: string; start: string; end: string; angle: number }>;
  /** Master pages by name (paper, margins, headers and footers) and the one in effect while reading the body. */
  masters?: Map<string, { page: PageSetup; hf: HeaderFooterSettings | undefined; w: number; margins: { top: number; left: number; right: number } }>;
  currentMaster?: string;
  /** Headers and footers in effect (to tell whether a section has its own). */
  currentHf?: HeaderFooterSettings;
  /** Page width and margins (px), to turn ODF positions into ours. */
  page?: { w: number; margins: { top: number; left: number; right: number } };
  /** Sources met in the bibliography marks (by tag). */
  sources?: Map<string, Source>;
  /** The `office:text` element being read (sections only start at its top level). */
  body?: Element;
  /** The top-level `text:section` being read, with its columns (it does not start a new page by itself). */
  sectionEl?: Element;
  sectionCols?: Map<string, ColumnsSpec>;
  /** Page setup in effect (what a continuous break repeats). */
  currentPage?: PageSetup;
  /** Columns of the `text:section` just entered, given to the break that opens it. */
  openColumns?: ColumnsSpec;
  /** Columns of a section that opens the document. */
  startColumns?: ColumnsSpec;
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
const cmOfAttr = (pp: Element | null, name: string): number | null => {
  const v = pp?.getAttribute(name);
  const n = v ? px(v) : null;
  return n === null ? null : +((n * 2.54) / 96).toFixed(3);
};
const ptOfAttr = (pp: Element | null, name: string): number | null => {
  const v = pp?.getAttribute(name);
  const n = v ? px(v) : null;
  return n === null ? null : +(n * 0.75).toFixed(2);
};

/** Indents, spacing and page-flow options written on a paragraph style. */
function readLayout(pp: Element | null): Partial<ParagraphLayout> | undefined {
  if (!pp) return undefined;
  const out: Partial<ParagraphLayout> = {};
  const l = cmOfAttr(pp, "fo:margin-left") ?? cmOfAttr(pp, "fo:margin"), r = cmOfAttr(pp, "fo:margin-right"), f = cmOfAttr(pp, "fo:text-indent");
  if (l) out.indentLeft = l;
  if (r) out.indentRight = r;
  if (f) out.firstLine = f;
  const b = ptOfAttr(pp, "fo:margin-top"), a = ptOfAttr(pp, "fo:margin-bottom");
  if (b !== null) out.spaceBefore = b;
  if (a !== null) out.spaceAfter = a;
  if (pp.getAttribute("fo:break-before") === "page") out.pageBreakBefore = true;
  if (pp.getAttribute("fo:keep-with-next") === "always") out.keepWithNext = true;
  if (pp.getAttribute("fo:keep-together") === "always") out.keepLines = true;
  return Object.keys(out).length ? out : undefined;
}

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
        columnAfter: pp?.getAttribute("fo:break-after") === "column",
        ...paragraphDeco(pp),
        ...cellDeco(first(s, "style:table-cell-properties")),
        gfx: graphicProps(first(s, "style:graphic-properties")),
        layout: readLayout(pp),
        masterPage: s.getAttribute("style:master-page-name") || undefined,
        pageNumber: /^\d+$/.test(pp?.getAttribute("style:page-number") ?? "") ? +pp!.getAttribute("style:page-number")! : undefined,
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
      const lv: Array<ListLevel | undefined> = [];
      for (const l of kids(ls)) {
        if (l.nodeName !== "text:list-level-style-number") continue;
        const i = +(l.getAttribute("text:level") ?? 1) - 1;
        const f = l.getAttribute("style:num-format") ?? "";
        lv[i] = {
          format: ODF_FORMATS[f] ?? "decimal",
          prefix: l.getAttribute("style:num-prefix") ?? "",
          suffix: l.getAttribute("style:num-suffix") ?? "",
          displayLevels: Math.max(1, +(l.getAttribute("text:display-levels") ?? 1) || 1),
          template: l.getAttribute("loext:num-list-format"),
          start: +(l.getAttribute("text:start-value") ?? 1) || 1,
          followed: first(l, "style:list-level-label-alignment")?.getAttribute("text:label-followed-by") ?? "space",
        };
      }
      ctx.listLevels.set(ls.getAttribute("style:name") ?? "", lv);
      ctx.listKinds.set(ls.getAttribute("style:name") ?? "", levels);
    }
  }
}

/** Normal, headings, quote and code styles as defined in styles.xml, minus what equals the built-in look. */
function readDocStyles(styles: Document | null, own: boolean): DocStyles {
  if (!styles) return {};
  const names: Record<StyleId, string[]> = { normal: ["Standard"], h1: ["Heading_20_1", "Heading 1"], h2: ["Heading_20_2", "Heading 2"], h3: ["Heading_20_3", "Heading 3"], h4: ["Heading_20_4", "Heading 4"], h5: ["Heading_20_5", "Heading 5"], h6: ["Heading_20_6", "Heading 6"], quote: ["Quote"], code: ["Preformatted_20_Text", "Preformatted Text"] };
  const all = Array.from(styles.getElementsByTagName("style:style")).filter((s) => s.parentNode?.nodeName === "office:styles");
  const out: DocStyles = {};
  const pt = (v: string | null) => { const n = px(v); return n === null ? undefined : Math.round(n * 0.75 * 2) / 2; };
  for (const id of STYLE_IDS) {
    const el = all.find((s) => names[id].includes(s.getAttribute("style:name") ?? ""));
    if (!el) continue;
    // What the file says, through the parent styles and the default style; what it does not say is the file's default (not Loma Writer's look).
    const lineage: Element[] = [];
    for (let cur: Element | undefined = el, guard = 0; cur && guard < 12; guard++) {
      lineage.unshift(cur);
      const parent = cur.getAttribute("style:parent-style-name");
      cur = parent ? all.find((x) => x.getAttribute("style:name") === parent) : undefined;
    }
    const dflt = Array.from(styles.getElementsByTagName("style:default-style")).find((d) => d.getAttribute("style:family") === "paragraph");
    const sources = [...(dflt ? [dflt] : []), ...lineage];
    const pAttr = (name: string) => { for (const e of [...sources].reverse()) { const v = first(e, "style:paragraph-properties")?.getAttribute(name); if (v) return v; } return null; };
    const run = (own ? lineage : sources).reduce<RunProps>((acc, e) => merge(acc, readRun(first(e, "style:text-properties"))), {});
    const font = lineage.reduce<RunProps>((acc, e) => merge(acc, readRun(first(e, "style:text-properties"))), {}).font; // the document font is no override
    const lh = pAttr("fo:line-height");
    const align = ALIGN[pAttr("fo:text-align") ?? ""];
    const raw: Record<string, unknown> = {
      ...(id !== "normal" && font && !(id === "code" && /mono|courier|consolas/i.test(font)) ? { fontFamily: font } : {}),
      ...(id !== "normal" && run.sizePt ? { sizePt: run.sizePt } : {}),
      ...(own ? { ...(run.color ? { color: run.color } : {}), ...(run.bold !== undefined ? { bold: run.bold } : {}), ...(run.italic !== undefined ? { italic: run.italic } : {}) } : { color: run.color ?? "#000000", bold: run.bold ?? false, italic: run.italic ?? false }),
      ...(align && align !== "left" ? { align } : {}),
      ...(own ? {} : { spaceBefore: pt(pAttr("fo:margin-top")) ?? 0, spaceAfter: pt(pAttr("fo:margin-bottom")) ?? 0, lineHeight: lh?.endsWith("%") ? parseFloat(lh) / 100 : 1 }),
      ...(own ? { ...(pt(pAttr("fo:margin-top")) !== undefined ? { spaceBefore: pt(pAttr("fo:margin-top")) } : {}), ...(pt(pAttr("fo:margin-bottom")) !== undefined ? { spaceAfter: pt(pAttr("fo:margin-bottom")) } : {}), ...(lh?.endsWith("%") ? { lineHeight: parseFloat(lh) / 100 } : {}) } : {}),
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
    if (h) return { kind: "heading", level: Math.min(6, +h[1]) };
    if (s.display === "title") return { kind: "heading", level: 1 };
    if (["quote", "quotations", "block quote", "citation", "citations"].includes(s.display)) return { kind: "quote" };
    if (["preformatted text", "source text", "source code", "code", "texte préformaté"].includes(s.display)) return { kind: "code" };
  }
  return { kind: "normal" };
}

const DOC_STYLE_NAMES = new Set(["Standard", "Heading", "Quote", "Preformatted_20_Text", "Preformatted Text", ...[1, 2, 3, 4, 5, 6].flatMap((n) => [`Heading_20_${n}`, `Heading ${n}`])]);
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
  const w = px(frame.getAttribute("svg:width"));
  const h = px(frame.getAttribute("svg:height"));
  const alt = first(frame, "svg:desc")?.textContent ?? undefined;
  // A floating picture keeps its wrapping, its anchor and its position.
  const style = ctx.styles.get(frame.getAttribute("draw:style-name") ?? "")?.gfx ?? {};
  const tr = parseTransform(frame.getAttribute("draw:transform"));
  const pos = { x: tr.x ?? (frame.hasAttribute("svg:x") ? cmOf(frame.getAttribute("svg:x")) : null), y: tr.y ?? (frame.hasAttribute("svg:y") ? cmOf(frame.getAttribute("svg:y")) : null) };
  const place = odfPlacement(ctx, frame, style, w ?? 0, h ?? 0, pos);
  const floating = place.wrap !== "inline" ? { wrap: place.wrap === "topBottom" ? "square" : place.wrap, anchor: place.anchor, x: place.x, y: place.y, z: zOf(frame), ...(tr.rotation ? { rotation: tr.rotation } : {}) } : {};
  return { type: "image", attrs: { src, ...(alt ? { alt } : {}), ...(w && h ? { width: Math.round(w), height: Math.round(h) } : {}), ...floating } };
}


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
      case "text:bibliography-mark": {
        // LibreOffice, reading a Word CITATION field, makes the whole instruction the identifier (" CITATION Dupont2020 \\l 1036 "), and the text of the citation its title.
        const rawId = el.getAttribute("text:identifier") ?? "";
        const wordField = /^\s*CITATION\s+(\S+)/.exec(rawId);
        const tag = (wordField ? wordField[1] : rawId).replace(/[^\p{L}\p{N}_.:-]/gu, "");
        if (tag) {
          const type = ({ book: "book", article: "article", www: "web", techreport: "report", phdthesis: "report", mastersthesis: "report" } as Record<string, Source["type"]>)[el.getAttribute("text:bibliography-type") ?? ""] ?? "other";
          const authors = (el.getAttribute("text:author") ?? "").split(/;| and /).map((a) => a.trim()).filter(Boolean).map((a) => { const [last, ...rest] = a.split(","); return { last: last.trim(), first: rest.join(",").trim() }; });
          const src = cleanSource({ tag, type, authors, title: el.getAttribute("text:title"), year: el.getAttribute("text:year"), publisher: el.getAttribute("text:journal") || el.getAttribute("text:publisher"), city: el.getAttribute("text:address"), volume: el.getAttribute("text:volume"), issue: el.getAttribute("text:number"), pages: el.getAttribute("text:pages"), url: el.getAttribute("text:url") });
          if (src && !wordField && (src.title || src.authors.length) && !(ctx.sources ??= new Map()).has(tag)) ctx.sources.set(tag, src);
          const page = /^page:(.*)$/.exec(el.getAttribute("text:custom1") ?? "")?.[1] ?? "";
          out.push({ type: "citation", attrs: { tag, page: page.slice(0, 40), text: "" } });
        }
        break;
      }
      case "text:sequence": { const label = cleanLabel(el.getAttribute("text:name")) ?? "Figure"; out.push({ type: "seqField", attrs: { label, n: Math.max(1, parseInt(el.textContent ?? "", 10) || 1) } }); break; }
      case "text:page-number": if (ctx.fields) out.push({ type: "pageField", attrs: { kind: "page" } }); else inlineOf(ctx, el, base, out); break;
      case "text:page-count": if (ctx.fields) out.push({ type: "pageField", attrs: { kind: "pages" } }); else inlineOf(ctx, el, base, out); break;
      case "text:s": out.push(textNode(" ".repeat(+(el.getAttribute("text:c") ?? 1)), base)); break;
      case "text:tab": out.push(textNode("\t", base)); break;
      case "text:line-break": out.push({ type: "hardBreak" }); break;
      case "draw:custom-shape": out.push(shapeNode(ctx, el, false)); break;
      case "draw:line": case "draw:connector": out.push(lineNode(ctx, el)); break;
      case "draw:g": { const g = groupNode(ctx, el); if (g) out.push(g); break; }
      case "draw:frame": {
        const box = first(el, "draw:text-box");
        // A text box that holds a table is a layout trick: the table is put in the text, where the box is anchored.
        if (box && holdsBlocks(box)) { out.push({ type: "inlineBlocks", content: convertBlocks(ctx, box, null, 0) }); break; }
        if (box) { out.push(shapeNode(ctx, el, true)); break; }
        const img = frameImage(ctx, el);
        if (img) out.push(img);
        break;
      }
      case "text:note": {
        const kind = el.getAttribute("text:note-class") === "endnote" ? "end" : "foot";
        const body = first(el, "text:note-body");
        const paragraphs = body ? Array.from(body.getElementsByTagName("text:p")).slice(0, 20).map((p): NoteParagraph => ({ type: "paragraph", content: ((convertPara(ctx, p).node.content ?? []) as PM[]).map((c) => (c.type === "hardBreak" ? { type: "hardBreak" } : { type: "text", text: c.text ?? "", marks: (c.marks ?? []).map((m) => ({ type: m.type, ...(m.attrs ? { attrs: m.attrs } : {}) })) })) as never })) : [];
        const noteBody = cleanBody(paragraphs);
        out.push({ type: "footnote", attrs: { kind, text: bodyText(noteBody), body: noteBody, n: 1, label: "" } });
        break;
      }
      case "office:annotation": ctx.warnings.add("Commentaires : non pris en charge, ignorés."); break;
      case "text:soft-page-break": case "text:bookmark-end": case "text:change": case "text:change-start": case "text:change-end": break;
      default: if (el.nodeName.startsWith("text:")) inlineOf(ctx, el, base, out);
    }
  }
}

function convertPara(ctx: Ctx, el: Element): { node: PM; kind: Kind; before: boolean; after: boolean; column: boolean } {
  const styleName = el.getAttribute("text:style-name");
  let kind = kindOf(ctx, styleName);
  if (el.nodeName === "text:h") {
    const lvl = +(el.getAttribute("text:outline-level") ?? 1);
    if (lvl > 6) ctx.warnings.add("Titres de niveau 7 à 9 ramenés au niveau 6.");
    kind = { kind: "heading", level: Math.min(6, lvl) };
  }
  const st = chain(ctx, styleName);
  const align = [...st].reverse().find((s) => s.align)?.align;
  const lineHeight = [...st].reverse().find((s) => s.lineHeight && (s.automatic || !GENERIC.has(s.display)) && kind.kind === "normal")?.lineHeight;
  const base = paraRun(ctx, styleName, kind);
  if (lineHeight) base.lineHeight = lineHeight;
  const own = ctx.styles.get(styleName ?? "");
  // Only an automatic (direct) style decorates a paragraph; named styles such as Quote keep their own look.
  // Spacing and indents come down the style chain (Text body, List Contents, custom styles); the styles Loma Writer edits itself (Standard, headings, quote, code) are in the document styles.
  const layout = kind.kind === "heading" ? own?.automatic ? own.layout : undefined : st.filter((x) => x.automatic || !DOC_STYLE_NAMES.has(x.name)).reduce<Partial<ParagraphLayout>>((acc, x) => ({ ...acc, ...x.layout }), {});
  const deco = own?.automatic || (layout && Object.keys(layout).length) ? { shading: own?.automatic ? own.shading : undefined, borders: own?.automatic ? own.borders : undefined, layout: layout && Object.keys(layout).length ? layout : undefined } : undefined;
  const inline: PM[] = [];
  inlineOf(ctx, el, kind.kind === "heading" ? { ...base, bold: undefined, sizePt: undefined } : base, inline);
  const content = splitEquations(mergeText(inline));
  return { node: kind.kind === "heading" ? heading(kind.level, content, align, deco) : paragraph(content, align, deco), kind, before: false, after: !!own?.breakAfter, column: !!own?.columnAfter };
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
  if (node.type === "paragraph" && content.some((n) => n.type === "inlineBlocks")) {
    // Blocks that were in a frame anchored in this paragraph (a table, a picture): they stay where the anchor is when the paragraph
    // holds nothing else, and come before the paragraph when it has text (a caption under a picture).
    const blocks = content.filter((n) => n.type === "inlineBlocks").flatMap((n) => n.content ?? []);
    const rest = content.filter((n) => n.type !== "inlineBlocks");
    if (rest.some((n) => n.type !== "text" || n.text?.trim())) { out.push(...blocks, { ...node, content: rest }); return; }
    out.push(...blocks);
    if (rest.length) out.push({ ...node, content: rest });
    return;
  }
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

/** A text box that holds a table or a picture is a layout trick (a caption frame, a table in a frame): what is in it goes into the text. */
const holdsBlocks = (box: Element): boolean => !!first(box, "table:table") || !!first(box, "draw:frame");

const hasListedHeading = (list: Element): boolean =>
  Array.from(list.getElementsByTagName("text:list-item")).some((i) => kids(i).some((k) => k.nodeName === "text:h"));

/** The number written in front of an item of a list style at `depth`, once the counters are updated. */
function listLabel(ctx: Ctx, style: string, depth: number, item: Element): string {
  const levels = ctx.listLevels.get(style) ?? [];
  const counters = ctx.listCounters.get(style) ?? [];
  const sv = item.getAttribute("text:start-value");
  counters[depth] = sv !== null && Number.isFinite(+sv) ? +sv : (counters[depth] ?? (levels[depth]?.start ?? 1) - 1) + 1;
  for (let k = depth + 1; k < counters.length; k++) counters[k] = 0;
  ctx.listCounters.set(style, counters);
  const lv = levels[depth];
  if (!lv || lv.format === "none" && !lv.template) return "";
  const num = (level: number) => {
    const l = levels[level];
    return l && l.format !== "none" ? formatPageNumber(counters[level] ?? 1, l.format) : "";
  };
  let label: string;
  if (lv.template) label = lv.template.replace(/%(\d+)%/g, (_m, n: string) => num(+n - 1));
  else {
    const from = Math.max(0, depth - lv.displayLevels + 1);
    label = `${lv.prefix}${Array.from({ length: depth - from + 1 }, (_, i) => num(from + i)).join(".")}${lv.suffix}`;
  }
  label = label.trim();
  return label ? (lv.followed === "nothing" ? label : `${label} `) : "";
}

/** The items of a list holding headings: every heading gets the number its list style gives it (nesting depth = level). */
function numberedHeadings(ctx: Ctx, list: Element, style: string, depth: number, out: PM[]) {
  for (const item of kids(list).filter((i) => i.nodeName === "text:list-item" || i.nodeName === "text:list-header")) {
    const counted = kids(item).some((k) => k.nodeName === "text:h" || k.nodeName === "text:p");
    const label = counted && item.nodeName === "text:list-item" ? listLabel(ctx, style, depth, item) : "";
    for (const child of kids(item)) {
      if (child.nodeName === "text:list") {
        if (hasListedHeading(child)) numberedHeadings(ctx, child, child.getAttribute("text:style-name") ?? style, depth + 1, out);
        else out.push(...convertBlocks(ctx, wrap(child), style, depth + 1));
      } else if (child.nodeName === "text:h" && label) {
        const { node } = convertPara(ctx, child);
        const content = node.content ?? [];
        node.content = [textNode(label, {}), ...content];
        out.push(node);
      } else out.push(...convertBlocks(ctx, wrap(child), style, depth + 1));
    }
  }
}

/** A throwaway container for one element, so that it goes through the ordinary block conversion. */
function wrap(el: Element): Element {
  const w = el.ownerDocument.createElementNS(null, "x");
  w.appendChild(el.cloneNode(true));
  return w;
}

/** A paragraph holding a numbering field (text:sequence) is a caption of that label. */
function markCaption(n: PM): void {
  const seq = n.type === "paragraph" ? (n.content ?? []).find((c) => c.type === "seqField") : undefined;
  if (seq) n.attrs = { ...(n.attrs ?? {}), caption: String(seq.attrs?.label ?? "Figure") };
}

/** The level of a "Contents N" style, looking up the parents (LibreOffice writes automatic styles P1, P2… based on it). */
function contentsLevel(ctx: Ctx, name: string | null): RegExpExecArray | null {
  for (let n = name, guard = 0; n && guard < 8; guard++) {
    const style = ctx.styles.get(n);
    const m = /contents[\s_]*(?:20_)?(\d)/i.exec(n) ?? /contents\s*(\d)/i.exec(style?.display ?? "");
    if (m) return m;
    n = style?.parent ?? null;
  }
  return null;
}

/** True when a paragraph style is (or is based on) "Contents Heading". */
function isContentsHeading(ctx: Ctx, name: string | null): boolean {
  for (let n = name, guard = 0; n && guard < 8; guard++) {
    if (/contents[\s_]*(?:20_)?heading/i.test(n) || /contents\s*heading/i.test(ctx.styles.get(n)?.display ?? "")) return true;
    n = ctx.styles.get(n)?.parent ?? null;
  }
  return false;
}

/** A table of contents (index body: the title, then one paragraph per entry with its page number after a tab). */
function tocFromOdt(ctx: Ctx, el: Element): PM {
  const body = first(el, "text:index-body");
  const textOfEl = (n: Element): string => {
    let t = "";
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType === 3) t += c.textContent ?? "";
      else if (c instanceof Element) t += c.nodeName === "text:tab" ? "\t" : c.nodeName === "text:s" ? " ".repeat(+(c.getAttribute("text:c") ?? 1)) : c.nodeName === "text:line-break" ? " " : textOfEl(c);
    }
    return t;
  };
  let title = "";
  const lines: PM[] = [];
  for (const k of body ? kids(body) : []) {
    if (k.nodeName === "text:index-title") { title = Array.from(k.children).map((p) => textOfEl(p)).join(" ").trim(); continue; }
    if (k.nodeName !== "text:p" && k.nodeName !== "text:h") continue;
    const lvl = contentsLevel(ctx, k.getAttribute("text:style-name"));
    const raw = textOfEl(k);
    const at = raw.lastIndexOf("\t");
    const text = (at >= 0 ? raw.slice(0, at) : raw).replace(/\t/g, " ").trim();
    lines.push({ type: "tocEntry", attrs: { level: Math.min(6, Math.max(1, lvl ? +lvl[1] : 1)), target: null, page: (at >= 0 ? raw.slice(at + 1).trim() : "").slice(0, 12) }, content: text ? [{ type: "text", text }] : [] });
  }
  const captionsOf = el.nodeName === "text:illustration-index" ? first(el, "text:illustration-index-source")?.getAttribute("text:caption-sequence-name") ?? null : null;
  const levelAttr = +(first(el, "text:table-of-content-source")?.getAttribute("text:outline-level") ?? 3);
  const levels = Math.min(6, Math.max(1, Number.isFinite(levelAttr) ? levelAttr : 3, ...lines.map((l) => +(l.attrs?.level ?? 1))));
  return { type: "tableOfContents", attrs: { levels, kind: captionsOf ? "captions" : "headings", title, label: captionsOf, titleFound: !!title }, content: lines };
}

const tocResolved = (blocks: PM[]): PM[] => { const doc = { type: "doc", content: blocks } as JsonNode; resolveTocTargets(doc); return (doc.content ?? []) as PM[]; };

function convertBlocks(ctx: Ctx, container: Element, listStyle: string | null, depth: number): PM[] {
  const out: PM[] = [];
  let quote: PM | null = null;
  let code: PM | null = null;
  for (const el of kids(container)) {
    switch (el.nodeName) {
      case "text:h": case "text:p": {
        // A paragraph whose style names another master page starts a new section (the empty ones only carry the mark).
        if (container === ctx.body || container === ctx.sectionEl) {
          const mp = ctx.styles.get(el.getAttribute("text:style-name") ?? "")?.masterPage;
          const m = mp ? ctx.masters?.get(mp) : undefined;
          if (mp && m && mp !== ctx.currentMaster) {
            const hf = m.hf ?? ctx.currentHf ?? { header: {}, footer: {}, titlePage: false, evenOdd: false };
            const linked = JSON.stringify(hf) === JSON.stringify(ctx.currentHf ?? { header: {}, footer: {}, titlePage: false, evenOdd: false });
            quote = code = null;
            const restart = ctx.styles.get(el.getAttribute("text:style-name") ?? "")?.pageNumber;
            const pg: PageSetup = { ...m.page, ...(restart !== undefined ? { numberStart: restart } : {}), ...(ctx.openColumns ? { columns: ctx.openColumns } : {}) };
            ctx.openColumns = undefined;
            out.push({ type: "sectionBreak", attrs: { page: pg, hf: linked ? null : hf } });
            ctx.currentPage = pg;
            ctx.currentMaster = mp;
            ctx.currentHf = hf;
            ctx.page = { w: m.w, margins: m.margins }; // shapes of this section are placed against its own paper and margins
            if (!el.textContent?.trim() && !el.children.length) break;
          }
        }
        const { node, kind, before, after, column } = convertPara(ctx, el);
        markCaption(node);
        if (before) { quote = code = null; out.push({ type: "pageBreak" }); }
        if (after && !node.content?.length) { quote = code = null; out.push({ type: "pageBreak" }); break; }
        if (column && !node.content?.length) { quote = code = null; out.push({ type: "columnBreak" }); break; }
        if (kind.kind === "quote") { code = null; if (!quote) { quote = { type: "blockquote", content: [] }; out.push(quote); } quote.content!.push(node); }
        else if (kind.kind === "code") {
          quote = null;
          const text = (node.content ?? []).map((c) => c.text ?? "").join("");
          if (!code) { code = { type: "codeBlock", content: text ? [{ type: "text", text }] : [] }; out.push(code); }
          else code.content = [{ type: "text", text: `${(code.content ?? []).map((c) => c.text).join("")}\n${text}` }];
        } else { quote = code = null; hoistShapes(node, out); }
        if (after) { quote = code = null; out.push({ type: "pageBreak" }); }
        if (column) { quote = code = null; out.push({ type: "columnBreak" }); }
        break;
      }
      case "text:list": {
        quote = code = null;
        const style = el.getAttribute("text:style-name") ?? listStyle;
        // Headings numbered by a list (Chapitre 1 :, 1.1.) are headings with their number written in front, not lists.
        if (hasListedHeading(el)) {
          if (!(el.getAttribute("text:continue-numbering") === "true" || el.hasAttribute("text:continue-list")) && style) ctx.listCounters.delete(style);
          numberedHeadings(ctx, el, style ?? "", 0, out);
          break;
        }
        const kind = ctx.listKinds.get(style ?? "")?.[depth] ?? "bulletList";
        const items = kids(el)
          .filter((i) => i.nodeName === "text:list-item" || i.nodeName === "text:list-header")
          .map((i): PM => ({ type: "listItem", content: ensureBlocks(convertBlocks(ctx, i, style, depth + 1)) }));
        const listType = ctx.listTypes.get(style ?? "")?.[depth] ?? null;
        out.push({ type: kind, ...(listType ? { attrs: { listType } } : {}), content: items });
        break;
      }
      case "table:table": quote = code = null; out.push(convertTable(ctx, el)); break;
      case "text:section": {
        const cols = container === ctx.body ? ctx.sectionCols?.get(el.getAttribute("text:style-name") ?? "") : undefined;
        if (!cols) { quote = code = null; out.push(...convertBlocks(ctx, el, listStyle, depth)); break; }
        // A section with columns: a continuous break opens it (a new page when its first paragraph names a master page) and another closes it.
        quote = code = null;
        const firstP = Array.from(el.children).find((c) => c.nodeName === "text:p" || c.nodeName === "text:h");
        const mp = firstP ? ctx.styles.get(firstP.getAttribute("text:style-name") ?? "")?.masterPage : undefined;
        const opensPage = !!mp && mp !== ctx.currentMaster && !!ctx.masters?.get(mp);
        const base = ctx.currentPage ?? ({} as PageSetup);
        if (out.length === 0 && !opensPage) ctx.startColumns = cols;
        else if (!opensPage) { const pg = { ...base, columns: cols }; out.push({ type: "sectionBreak", attrs: { page: pg, hf: null, kind: "continuous" } }); ctx.currentPage = pg; }
        else ctx.openColumns = cols;
        ctx.sectionEl = el;
        out.push(...convertBlocks(ctx, el, listStyle, depth));
        ctx.sectionEl = undefined;
        ctx.openColumns = undefined;
        if (el.nextElementSibling) { const { columns, ...rest } = ctx.currentPage ?? ({} as PageSetup); void columns; ctx.currentPage = rest as PageSetup; out.push({ type: "sectionBreak", attrs: { page: ctx.currentPage, hf: null, kind: "continuous" } }); }
        break;
      }
      case "text:index-body": quote = code = null; out.push(...convertBlocks(ctx, el, listStyle, depth)); break;
      case "text:bibliography": {
        quote = code = null;
        const title = Array.from(first(el, "text:index-title")?.children ?? []).map((p) => p.textContent ?? "").join(" ").trim();
        out.push({ type: "bibliography", attrs: { title: title || "Bibliographie", mode: "cited" }, content: [] });
        break;
      }
      case "text:illustration-index": case "text:table-of-content": {
        quote = code = null;
        const toc = tocFromOdt(ctx, el);
        // The title may be an ordinary paragraph just before the table (style Contents Heading).
        const prev = el.previousElementSibling;
        const last = out[out.length - 1];
        if (!toc.attrs?.titleFound && prev && prev.nodeName === "text:p" && isContentsHeading(ctx, prev.getAttribute("text:style-name")) && last?.type === "paragraph") {
          toc.attrs = { ...toc.attrs, title: (last.content ?? []).map((c) => c.text ?? "").join("").trim() || toc.attrs?.title };
          out.pop();
        }
        if (toc.attrs) delete toc.attrs.titleFound;
        out.push(toc);
        break;
      }
      case "text:tracked-changes": ctx.warnings.add("Suivi des modifications : non pris en charge."); break;
      case "draw:frame": {
        const box = first(el, "draw:text-box");
        if (box && holdsBlocks(box)) { out.push(...convertBlocks(ctx, box, null, 0)); break; }
        if (box) { out.push(shapeNode(ctx, el, true)); break; }
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

const ODF_NUM_BACK: Record<string, PageNumberFormat> = { "1": "decimal", i: "lowerRoman", I: "upperRoman", a: "lowerLetter", A: "upperLetter" };

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
    assertSafeZip(zip);
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
  const ctx: Ctx = { styles: new Map(), listKinds: new Map(), listTypes: new Map(), listLevels: new Map(), listCounters: new Map(), columns: new Map(), images, formulas, warnings: new Set() };
  collectStyles(styles ? [styles, content] : [content], ctx);

  const text = first(content, "office:text");
  if (!text) throw corrupt("corps du document absent");

  // Master pages: paper, margins and headers/footers of each. A paragraph naming one of them starts a section.
  const readMaster = (m: Element) => {
    const layoutName = m.getAttribute("style:page-layout-name");
    const layout = styles ? Array.from(styles.getElementsByTagName("style:page-layout")).find((l) => l.getAttribute("style:name") === layoutName) ?? first(styles, "style:page-layout") : null;
    const props = layout ? first(layout, "style:page-layout-properties") : null;
    let page = pageFromDimensions(794, 1123, null, ctx.warnings);
    let w = 794;
    let margins = { top: 96, left: 96, right: 96 };
    if (props) {
      const pw = px(props.getAttribute("fo:page-width"));
      const ph = px(props.getAttribute("fo:page-height"));
      const side = (name: string) => px(props.getAttribute(name)) ?? 96;
      if (pw && ph) {
        page = pageFromDimensions(pw, ph, { top: side("fo:margin-top"), right: side("fo:margin-right"), bottom: side("fo:margin-bottom"), left: side("fo:margin-left") }, ctx.warnings, { mirrored: layout?.getAttribute("style:page-usage") === "mirrored" });
        w = pw;
        margins = { top: side("fo:margin-top"), left: side("fo:margin-left"), right: side("fo:margin-right") };
      }
    }
    // Page numbers: the format is a property of the page layout.
    const fmt = ODF_NUM_BACK[props?.getAttribute("style:num-format") ?? ""];
    if (fmt && fmt !== "decimal") page = { ...page, numberFormat: fmt };
    return { page, w, margins };
  };
  const masterEls = styles ? Array.from(styles.getElementsByTagName("style:master-page")) : [];
  ctx.masters = new Map();
  ctx.body = text;
  const infos = new Map<string, ReturnType<typeof readMaster>>();
  for (const m of masterEls) {
    const name = m.getAttribute("style:name") ?? "";
    const info = readMaster(m);
    infos.set(name, info);
    ctx.masters.set(name, { page: info.page, hf: readHeadersFooters(ctx, m), w: info.w, margins: info.margins });
  }
  // The section the document starts in: the master page of its first paragraph, else the first master page.
  const firstPara = Array.from(text.children).find((c) => c.nodeName === "text:p" || c.nodeName === "text:h");
  const firstMp = firstPara ? ctx.styles.get(firstPara.getAttribute("text:style-name") ?? "")?.masterPage : undefined;
  const startName = firstMp && ctx.masters.has(firstMp) ? firstMp : masterEls[0]?.getAttribute("style:name") ?? "";
  ctx.currentMaster = startName;
  const startInfo = infos.get(startName) ?? { page: pageFromDimensions(794, 1123, null, ctx.warnings), w: 794, margins: { top: 96, left: 96, right: 96 } };
  // The first paragraph may restart the numbering (`style:page-number`).
  const firstStart = firstPara ? ctx.styles.get(firstPara.getAttribute("text:style-name") ?? "")?.pageNumber : undefined;
  let page: PageSetup = firstStart !== undefined ? { ...startInfo.page, numberStart: firstStart } : startInfo.page;
  ctx.page = { w: startInfo.w, margins: startInfo.margins };
  ctx.currentPage = page;
  // Columns of `text:section`s (an automatic style of the section family).
  ctx.sectionCols = new Map();
  for (const st of [content, ...(styles ? [styles] : [])].flatMap((d) => Array.from(d.getElementsByTagName("style:style")))) {
    if (st.getAttribute("style:family") !== "section") continue;
    const c = first(st, "style:columns");
    const n = c ? +(c.getAttribute("fo:column-count") ?? 1) : 1;
    if (c && n >= 2) ctx.sectionCols.set(st.getAttribute("style:name") ?? "", { count: Math.min(MAX_COLUMNS, n), gapCm: Math.round(((px(c.getAttribute("fo:column-gap")) ?? DEFAULT_COLUMN_GAP_CM * 96 / 2.54) * 2.54 / 96) * 100) / 100, line: !!first(c, "style:column-sep") });
  }
  const headerFooter = ctx.masters.get(startName)?.hf;
  ctx.currentHf = headerFooter;
  const blocks = convertBlocks(ctx, text, null, 0);
  if (ctx.startColumns) page = { ...page, columns: ctx.startColumns };

  if (!hasVisibleContent(blocks)) {
    const hasSource = !!text.textContent?.trim() || text.getElementsByTagName("draw:image").length > 0 || text.getElementsByTagName("table:table").length > 0;
    if (hasSource) throw new DocumentError("unreadable-content", "Le contenu de ce document n'a pas pu être lu : il utilise des éléments que Loma Writer ne sait pas importer.");
  }
  // Sources: those kept in the metadata (all of them), completed by the ones the marks describe.
  const metaXml = zip.file("meta.xml") ? await zip.file("meta.xml")!.async("string") : "";
  const userDefined = (name: string) => { try { return Array.from(parseXml(metaXml, "meta.xml").getElementsByTagName("meta:user-defined")).find((e) => e.getAttribute("meta:name") === name)?.textContent ?? null; } catch { return null; } };
  let fromMeta: Source[] = [];
  try { const raw = userDefined("LomaSources") ?? "[]"; fromMeta = raw.length > 4_000_000 ? [] : cleanSources(JSON.parse(raw)); } catch { /* not ours */ }
  const merged = cleanSources([...fromMeta, ...(ctx.sources ? [...ctx.sources.values()] : [])]);
  const styleName = userDefined("LomaCitationStyle");
  // Numbering of the notes (`text:notes-configuration` in the styles).
  const noteConf = (cls: string, base: NoteNumbering): NoteNumbering => {
    const el = styles ? Array.from(styles.getElementsByTagName("text:notes-configuration")).find((e) => e.getAttribute("text:note-class") === cls) : null;
    if (!el) return base;
    const format = ({ "1": "decimal", i: "lowerRoman", I: "upperRoman", a: "lowerLetter", A: "upperLetter", "*": "symbols" } as Record<string, NoteNumbering["format"]>)[el.getAttribute("style:num-format") ?? ""] ?? base.format;
    const at = el.getAttribute("text:start-numbering-at");
    const start = parseInt(el.getAttribute("text:start-value") ?? "", 10);
    return { format, restart: at === "page" ? "page" : at === "chapter" ? "section" : "continuous", start: Number.isInteger(start) && start >= 0 ? start + 1 : base.start };
  };
  const noteOptions: NotesOptions = cleanNotesOptions({ foot: noteConf("footnote", DEFAULT_NOTES.foot), end: noteConf("endnote", DEFAULT_NOTES.end) });
  const notesAttr = JSON.stringify(noteOptions) === JSON.stringify(DEFAULT_NOTES) ? null : noteOptions;
  const sourceAttrs = merged.length || notesAttr ? { ...(merged.length ? { sources: merged, ...(isCitationStyle(styleName) ? { citationStyle: styleName as CitationStyle } : {}) } : {}), ...(notesAttr ? { notes: notesAttr } : {}) } : null;
  const docStyles = readDocStyles(styles, /<meta:generator>\s*Loma Writer/.test(metaXml));
  return { model: { content: { type: "doc", content: tocResolved(ensureBlocks(blocks)), ...(sourceAttrs ? { attrs: sourceAttrs } : {}) }, page, ...(headerFooter ? { headerFooter } : {}), ...(Object.keys(docStyles).length ? { styles: docStyles } : {}) }, warnings: [...ctx.warnings] };
}
