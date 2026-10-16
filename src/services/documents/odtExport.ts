import { SECTION_BREAK } from "../../editor/Sections";
import { sanitizeHeaderFooter, type HeaderFooterSettings } from "../../pagination/headerFooter";
import { sanitizePage } from "./sanitize";
import type { PageSetup } from "../../state/types";
import { cleanWatermark } from "../../editor/watermark";
import { cleanLayout, type ParagraphLayout } from "../../editor/ParagraphFormat";
import { cleanRowHeight } from "../../editor/TableRowResize";
import { cleanPlace } from "../../editor/TableLook";
import { cellLook, cleanLook, tint, type Line } from "../../editor/tableStyles";
import { resolveStyle, type StyleId } from "../../editor/docStyles";
import { ALL_BULLET_IDS, ALL_NUMBER_IDS, BULLET_CHARS, levelType, NUMBER_FORMATS } from "./listFormats";
import { cleanListType } from "../../editor/ListTypes";
import JSZip from "jszip";
import { marginsPx, pageDimensions } from "../../state/types";
import { effectiveMarginsCm, isMirrored, paperCm } from "../../state/page";
import { pxToCm } from "./page";
import { formatPageNumber } from "../../pagination/pageNumber";
import { cleanSources, isCitationStyle, type Source, type SourceType } from "../../editor/references/sources";
import type { PM, Mark } from "./pm";
import { latexToMathml } from "../math/mathml";
import { isKnownShape, NONE, TEXT_BOX } from "../../editor/shapes/catalog";
import type { Gradient, Shadow } from "../../editor/shapes/types";
import { hasContent, type HeaderFooterContent, type HeaderFooterSet } from "../../pagination/headerFooter";
import type { DocumentModel, ExportResult } from "./types";
import { esc, imageSize, parseDataUri } from "./xml";

export const ODT_MIME = "application/vnd.oasis.opendocument.text";
const NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:loext="urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0"';
const MAX_IMAGE_WIDTH_PX = 600;
const ALIGN: Record<string, string> = { left: "start", center: "center", right: "end", justify: "justify" };

function toPt(size: unknown): number | undefined {
  const m = /^([\d.]+)\s*(pt|px)?$/.exec(String(size ?? ""));
  return m ? (m[2] === "px" ? +m[1] * 0.75 : +m[1]) : undefined;
}

class Ctx {
  /** Prefix of the style and picture names, so header/footer content (written in styles.xml) never clashes with the body. */
  constructor(readonly prefix = "") {}
  warnings = new Set<string>();
  textStyles = new Map<string, string>();
  paraStyles = new Map<string, string>();
  /** Master page the next top-level paragraph must start (a new section), consumed by `para`. */
  pendingMaster: string | null = null;
  /** Page number the next top-level paragraph restarts at (`style:page-number`). */
  pendingStart: number | null = null;
  sectionStyles: string[] = [];
  /** Sources of the document, by tag (what the bibliography marks are written from). */
  sources = new Map<string, Source>();
  /** Tables of contents written so far (their names), and the width of the text for their right tab. */
  tocs = 0;
  /** Numbering sequences used by the captions (declared at the start of the text), and a counter of their references. */
  seqLabels = new Set<string>();
  seqRefs = 0;
  noteIds = 0;
  tocWidth = "16cm";
  takeMaster(): string | null { const m = this.pendingMaster; this.pendingMaster = null; return m; }
  takeStart(): number | null { const s = this.pendingStart; this.pendingStart = null; return s; }
  pictures: Array<{ name: string; bytes: Uint8Array }> = [];
  colStyles: string[] = [];
  graphicStyles: string[] = [];
  shapes = 0;
  /** `draw:gradient` definitions (they live in styles.xml). */
  gradients: string[] = [];
  /** Floating objects waiting for the paragraph they are anchored in. */
  anchored: string[] = [];
  formulas: Array<{ dir: string; mathml: string }> = [];
  frames = 0;
  tables = 0;

  textStyle(marks: Mark[] = []): string | null {
    const props: string[] = [];
    for (const m of marks) {
      switch (m.type) {
        case "bold": props.push('fo:font-weight="bold"'); break;
        case "italic": props.push('fo:font-style="italic"'); break;
        case "underline": props.push('style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"'); break;
        case "strike": props.push('style:text-line-through-style="solid"'); break;
        case "subscript": props.push('style:text-position="sub 58%"'); break;
        case "superscript": props.push('style:text-position="super 58%"'); break;
        case "highlight": if (m.attrs?.color) props.push(`fo:background-color="${esc(String(m.attrs.color))}"`); break;
        case "textStyle": {
          const a = m.attrs ?? {};
          if (a.fontFamily) props.push(`fo:font-family="${esc(String(a.fontFamily))}"`);
          const pt = toPt(a.fontSize);
          if (pt) props.push(`fo:font-size="${pt}pt"`);
          if (a.color) props.push(`fo:color="${esc(String(a.color))}"`);
          break;
        }
      }
    }
    if (!props.length) return null;
    const key = props.join(" ");
    if (!this.textStyles.has(key)) this.textStyles.set(key, `${this.prefix}T${this.textStyles.size + 1}`);
    return this.textStyles.get(key)!;
  }

  cellStyles = new Map<string, string>();
  rowStyles = 0;

  /** Automatic table-cell style: fill and the four borders (`none` or `0.5pt solid #rrggbb`). */
  cellStyle(spec: { fill: string | null; top: string; bottom: string; left: string; right: string }): string {
    const key = JSON.stringify(spec);
    if (!this.cellStyles.has(key)) this.cellStyles.set(key, `${this.prefix}Cx${this.cellStyles.size + 1}`);
    return this.cellStyles.get(key)!;
  }

  paraStyle(parent: string, align?: string, lineHeight?: string, deco?: { shading?: unknown; borders?: Record<string, boolean> | null; layout?: ParagraphLayout }, master?: string | null, pageNumber?: number | null): string {
    const sides = deco?.borders ? (["top", "right", "bottom", "left"] as const).filter((s) => deco.borders![s]).map((s) => `fo:border-${s}="0.75pt solid #6b7280"`) : [];
    const props = [
      align && align !== "left" ? `fo:text-align="${ALIGN[align] ?? "start"}"` : "",
      lineHeight ? `fo:line-height="${Math.round(+lineHeight * 100)}%"` : "",
      deco?.shading ? `fo:background-color="${esc(String(deco.shading))}"` : "",
      ...sides,
      deco?.shading || sides.length ? 'fo:padding="0.08cm"' : "",
      ...layoutProps(deco?.layout),
      // Restarts the page numbering at this paragraph (a property of the paragraph, not of the style element).
      pageNumber ? `style:page-number="${pageNumber}"` : "",
    ].filter(Boolean).join(" ");
    const key = `${parent}|${props}|${master ?? ""}`;
    if (!this.paraStyles.has(key)) this.paraStyles.set(key, `${this.prefix}P${this.paraStyles.size + 1}`);
    return this.paraStyles.get(key)!;
  }
}

/** `style:paragraph-properties` attributes of a paragraph's indents, spacing and page-flow options. */
function layoutProps(l?: ParagraphLayout): string[] {
  if (!l) return [];
  return [
    l.indentLeft ? `fo:margin-left="${+l.indentLeft.toFixed(3)}cm"` : "",
    l.indentRight ? `fo:margin-right="${+l.indentRight.toFixed(3)}cm"` : "",
    l.firstLine ? `fo:text-indent="${+l.firstLine.toFixed(3)}cm"` : "",
    l.spaceBefore !== null ? `fo:margin-top="${l.spaceBefore}pt"` : "",
    l.spaceAfter !== null ? `fo:margin-bottom="${l.spaceAfter}pt"` : "",
    l.pageBreakBefore ? 'fo:break-before="page"' : "",
    l.keepWithNext ? 'fo:keep-with-next="always"' : "",
    l.keepLines ? 'fo:keep-together="always"' : "",
  ];
}

function inline(ctx: Ctx, nodes: PM[] = []): string {
  let out = "";
  for (const n of nodes) {
    if (n.type === "hardBreak") out += "<text:line-break/>";
    else if (n.type === "pageField") out += n.attrs?.kind === "pages" ? "<text:page-count>1</text:page-count>" : '<text:page-number text:select-page="current">1</text:page-number>';
    else if (n.type === "citation") {
      const tag = String(n.attrs?.tag ?? "");
      const s = ctx.sources.get(tag);
      const ODF_TYPE: Record<SourceType, string> = { book: "book", article: "article", web: "www", report: "techreport", other: "misc" };
      const attrs = s
        ? ` text:bibliography-type="${ODF_TYPE[s.type]}" text:author="${esc(s.authors.map((p) => (p.first ? `${p.last}, ${p.first}` : p.last)).join("; "))}" text:title="${esc(s.title)}" text:year="${esc(s.year)}" ${s.type === "article" ? "text:journal" : "text:publisher"}="${esc(s.publisher)}" text:address="${esc(s.city)}" text:volume="${esc(s.volume)}" text:pages="${esc(s.pages)}" text:url="${esc(s.url)}"`
        : ' text:bibliography-type="misc"';
      out += `<text:bibliography-mark text:identifier="${esc(tag)}"${attrs}${n.attrs?.page ? ` text:custom1="${esc(`page:${n.attrs.page}`)}"` : ""}>${esc(String(n.attrs?.text ?? ""))}</text:bibliography-mark>`;
    }
    else if (n.type === "footnote") {
      const end = n.attrs?.kind === "end";
      const id = `${end ? "edn" : "ftn"}${++ctx.noteIds}`;
      const label = end ? formatPageNumber(Math.max(1, +n.attrs?.n || 1), "lowerRoman") : String(Math.max(1, +n.attrs?.n || 1));
      out += `<text:note text:id="${id}" text:note-class="${end ? "endnote" : "footnote"}"><text:note-citation>${label}</text:note-citation><text:note-body><text:p text:style-name="Standard">${esc(String(n.attrs?.text ?? ""))}</text:p></text:note-body></text:note>`;
    }
    else if (n.type === "seqField") {
      const label = String(n.attrs?.label ?? "Figure");
      ctx.seqLabels.add(label);
      out += `<text:sequence text:ref-name="ref${esc(label)}${ctx.seqRefs++}" text:name="${esc(label)}" text:formula="ooow:${esc(label)}+1" style:num-format="1">${Math.max(1, Math.trunc(Number(n.attrs?.n)) || 1)}</text:sequence>`;
    }
    else if (n.type === "bookmark") out += `<text:bookmark text:name="${esc(String(n.attrs?.name ?? "signet"))}"/>`;
    else if (n.type === "equation") {
      // An embedded formula object (MathML), the way LibreOffice Math stores equations.
      const mathml = latexToMathml(String(n.attrs?.latex ?? ""));
      const dir = `Object ${ctx.formulas.length + 1}`;
      ctx.formulas.push({ dir, mathml });
      const chars = mathml.replace(/<annotation[\s\S]*<\/annotation>/, "").replace(/<[^>]+>/g, "").length;
      out += `<draw:frame draw:name="Formule${ctx.formulas.length}" text:anchor-type="as-char" svg:width="${pxToCm(Math.max(24, chars * 9 + 10))}cm" svg:height="${pxToCm(26)}cm"><draw:object xlink:href="./${dir}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame>`;
    }
    else if (n.type === "image") out += image(ctx, n);
    else if (n.type === "text" && n.text !== undefined) {
      const style = ctx.textStyle(n.marks);
      const href = n.marks?.find((m) => m.type === "link")?.attrs?.href;
      // Preserve runs of spaces and tabs, which ODF would otherwise collapse.
      let body = esc(n.text).replace(/\t/g, "<text:tab/>").replace(/ {2,}/g, (m) => ` <text:s text:c="${m.length - 1}"/>`);
      if (style) body = `<text:span text:style-name="${style}">${body}</text:span>`;
      out += href ? `<text:a xlink:type="simple" xlink:href="${esc(String(href))}">${body}</text:a>` : body;
    }
  }
  return out;
}

function image(ctx: Ctx, n: PM): string {
  const data = parseDataUri(String(n.attrs?.src ?? ""));
  if (!data) { ctx.warnings.add("Une image qui n'est pas intégrée au document n'a pas pu être exportée."); return ""; }
  const ext = ({ "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/bmp": "bmp", "image/svg+xml": "svg" } as Record<string, string>)[data.mime];
  if (!ext) { ctx.warnings.add(`Une image de type ${data.mime} n'est pas exportable et a été omise.`); return ""; }
  const natural = imageSize(data.bytes) ?? { w: 300, h: 200 };
  let w = +(n.attrs?.width ?? natural.w);
  let h = +(n.attrs?.height ?? natural.h);
  if (w > MAX_IMAGE_WIDTH_PX) { h = (h * MAX_IMAGE_WIDTH_PX) / w; w = MAX_IMAGE_WIDTH_PX; }
  const name = `Pictures/${ctx.prefix.toLowerCase()}image${ctx.pictures.length + 1}.${ext}`;
  ctx.pictures.push({ name, bytes: data.bytes });
  const alt = n.attrs?.alt ? `<svg:desc>${esc(String(n.attrs.alt))}</svg:desc>` : "";
  const wrap = String(n.attrs?.wrap ?? "inline");
  const rotation = Number(n.attrs?.rotation) || 0;
  let anchor = "as-char";
  let place = "";
  let style = "";
  if (wrap !== "inline") {
    const x = Number(n.attrs?.x) || 0, y = Number(n.attrs?.y) || 0;
    const onPage = wrap === "front" || wrap === "behind";
    anchor = onPage ? "paragraph" : "paragraph";
    const sname = `${ctx.prefix}Pic${ctx.graphicStyles.length + 1}`;
    ctx.graphicStyles.push(`<style:style style:name="${sname}" style:family="graphic"><style:graphic-properties style:wrap="${onPage ? "run-through" : "parallel"}"${onPage ? ` style:run-through="${wrap === "behind" ? "background" : "foreground"}"` : ""} style:horizontal-pos="from-left" style:horizontal-rel="${onPage ? "page" : "paragraph"}" style:vertical-pos="from-top" style:vertical-rel="${onPage ? "page" : "paragraph"}"/></style:style>`);
    style = ` draw:style-name="${sname}" draw:z-index="${Math.max(0, 50 + (Number(n.attrs?.z) || 0))}"`;
    place = rotation ? ` draw:transform="rotate (${(-rotation * Math.PI / 180).toFixed(6)}) translate (${pxToCm(x)}cm ${pxToCm(y)}cm)"` : ` svg:x="${pxToCm(x)}cm" svg:y="${pxToCm(y)}cm"`;
  } else if (rotation) place = ` draw:transform="rotate (${(-rotation * Math.PI / 180).toFixed(6)})"`;
  return `<draw:frame draw:name="Image${++ctx.frames}"${style} text:anchor-type="${anchor}"${place} svg:width="${pxToCm(w)}cm" svg:height="${pxToCm(h)}cm"><draw:image xlink:href="${name}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>${alt}</draw:frame>`;
}

const lineHeightOf = (content: PM[] = []): string | undefined =>
  content.map((n) => n.marks?.find((m) => m.type === "textStyle")?.attrs?.lineHeight).find((v) => v && +String(v) > 0) as string | undefined;

function para(ctx: Ctx, n: PM, parent = "Standard"): string {
  const lead = ctx.anchored.join("");
  ctx.anchored = [];
  const style = ctx.paraStyle(n.type === "heading" ? `Heading_20_${n.attrs?.level ?? 1}` : parent, n.attrs?.textAlign as string | undefined, lineHeightOf(n.content), { shading: n.attrs?.shading, borders: n.attrs?.borders as Record<string, boolean> | null, layout: cleanLayout(n.attrs as never) }, ctx.takeMaster(), ctx.takeStart());
  const body = lead + inline(ctx, n.content);
  return n.type === "heading"
    ? `<text:h text:style-name="${style}" text:outline-level="${n.attrs?.level ?? 1}">${body}</text:h>`
    : `<text:p text:style-name="${style}">${body}</text:p>`;
}

const cm = (px: number) => `${pxToCm(px)}cm`;

/** `draw:gradient` for a gradient fill: ODF has two colours, so more stops are reduced to the first and last. */
function gradientName(ctx: Ctx, g: Gradient): string {
  const first = g.stops[0].color;
  const last = g.stops[g.stops.length - 1].color;
  const name = `${ctx.prefix}Grad${ctx.gradients.length + 1}`;
  // ODF angle: 0 = start colour at the top, turning counter-clockwise. Ours: 0 = left to right, clockwise.
  const angle = Math.round((((90 - g.angle) % 360) + 360) % 360);
  const attrs = g.type === "radial"
    ? `draw:style="radial" draw:cx="50%" draw:cy="50%" draw:start-color="${last}" draw:end-color="${first}"`
    : `draw:style="linear" draw:start-color="${first}" draw:end-color="${last}" draw:angle="${angle}deg"`;
  ctx.gradients.push(`<draw:gradient draw:name="${name}" draw:display-name="${name}" ${attrs} draw:start-intensity="100%" draw:end-intensity="100%" draw:border="0%"/>`);
  if (g.stops.length > 2) ctx.warnings.add("Dégradés à plus de deux couleurs : réduits à deux couleurs en ODT.");
  return name;
}

/** Graphic style of a shape: fill, outline, shadow, wrap and anchoring. */
function graphicStyle(ctx: Ctx, a: Record<string, unknown>, box: boolean): string {
  const id = ++ctx.shapes;
  const name = `${ctx.prefix}gr${id}`;
  const wrap = String(a.wrap ?? "inline");
  const rel = a.anchor === "page" ? "page" : "paragraph";
  const place = wrap === "inline" || wrap === "group" ? "" : ` style:horizontal-pos="from-left" style:horizontal-rel="${rel}" style:vertical-pos="from-top" style:vertical-rel="${rel}"`;
  const wrapAttrs =
    wrap === "front" ? 'style:wrap="run-through" style:run-through="foreground"'
    : wrap === "behind" ? 'style:wrap="run-through" style:run-through="background"'
    : wrap === "square" ? 'style:wrap="parallel" style:number-wrapped-paragraphs="no-limit"'
    : 'style:wrap="none"';
  const stroke = a.stroke === NONE || !a.stroke;
  const gradient = a.gradient as Gradient | null | undefined;
  const fillNone = (a.fill === NONE || !a.fill) && !gradient;
  const sh = a.shadow as Shadow | null | undefined;
  const shadow = sh ? ` draw:shadow="visible" draw:shadow-offset-x="${cm(sh.dx)}" draw:shadow-offset-y="${cm(sh.dy)}" draw:shadow-color="${esc(sh.color)}" draw:shadow-opacity="${Math.round(sh.opacity * 100)}%" loext:shadow-blur="${cm(sh.blur)}"` : "";
  const sw = pxToCm(Number(a.strokeWidth) || 1);
  let props: string;
  if (box) {
    props = `fo:padding="0.2cm" ${stroke ? 'fo:border="none"' : `fo:border="${(Number(a.strokeWidth) || 1) * 0.75}pt solid ${esc(String(a.stroke))}"`} ${fillNone ? "" : gradient ? `draw:fill="gradient" draw:fill-gradient-name="${gradientName(ctx, gradient)}"` : `fo:background-color="${esc(String(a.fill))}"`}`;
  } else {
    props = `draw:fill="${fillNone ? "none" : gradient ? "gradient" : "solid"}" ${gradient ? `draw:fill-gradient-name="${gradientName(ctx, gradient)}"` : fillNone ? "" : `draw:fill-color="${esc(String(a.fill))}"`} draw:stroke="${stroke ? "none" : "solid"}" ${stroke ? "" : `svg:stroke-color="${esc(String(a.stroke))}" svg:stroke-width="${sw}cm"`} draw:textarea-vertical-align="middle" draw:textarea-horizontal-align="center" fo:padding-top="0.1cm" fo:padding-bottom="0.1cm" fo:padding-left="0.2cm" fo:padding-right="0.2cm"`;
  }
  ctx.graphicStyles.push(`<style:style style:name="${name}" style:family="graphic"><style:graphic-properties ${props} ${wrapAttrs}${place}${shadow}/></style:style>`);
  return name;
}

/** Position attributes of a drawing element (an element rotated by `draw:transform` carries its position in the transform). */
function positionAttrs(a: Record<string, unknown>, x: number, y: number): string {
  const w = Number(a.width) || 0;
  const h = Number(a.height) || 0;
  const rot = Number(a.rotation) || 0;
  const wrap = String(a.wrap ?? "inline");
  if (rot) {
    // Rotation about the centre of the shape, then placement of its top-left corner.
    const rad = (-rot * Math.PI) / 180;
    return ` draw:transform="rotate (${+rad.toFixed(6)}) translate (${cm(x)} ${cm(y)})"`;
  }
  void w; void h;
  return wrap === "inline" ? "" : ` svg:x="${cm(x)}" svg:y="${cm(y)}"`;
}

const zAttr = (a: Record<string, unknown>) => ` draw:z-index="${Math.max(0, 50 + (Number(a.z) || 0))}"`;
const anchorAttr = (a: Record<string, unknown>) => (a.wrap === "inline" || !a.wrap ? "as-char" : "paragraph");

/** One shape (or text box) as an ODF drawing element. `at` overrides the position (inside a group, in the group's frame). */
function shapeElement(ctx: Ctx, n: PM, at?: { x: number; y: number }, inheritWrap?: Record<string, unknown>): string {
  const a = { ...(n.attrs ?? {}), ...(inheritWrap ?? {}) };
  const kind = String(a.kind ?? "rect");
  const rotated = !!Number(a.rotation);
  // A text box that is rotated or has no frame equivalent becomes a rectangle holding text (its name restores the type).
  const box = kind === TEXT_BOX && !rotated;
  const style = graphicStyle(ctx, a, box);
  const label = kind === TEXT_BOX ? "Zone de texte" : "Forme";
  const w = cm(Number(a.width) || 160);
  const h = cm(Number(a.height) || 100);
  const x = at ? at.x : Number(a.x) || 0;
  const y = at ? at.y : Number(a.y) || 0;
  const common = `draw:style-name="${style}" draw:name="${label} ${ctx.shapes}" text:anchor-type="${anchorAttr(a)}"${zAttr(a)}`;
  const title = a.alt ? `<svg:title>${esc(String(a.alt))}</svg:title>` : "";
  const pending = ctx.anchored; // paragraphs inside a shape must not adopt the floating objects waiting for the body
  ctx.anchored = [];
  const paragraphs = (n.content ?? []).map((p) => para(ctx, { ...p, attrs: { ...(p.attrs ?? {}), textAlign: p.attrs?.textAlign ?? (kind === TEXT_BOX ? "left" : "center") } })).join("");
  ctx.anchored = pending;
  if (box) return `<draw:frame ${common}${positionAttrs(a, x, y)} svg:width="${w}" fo:min-height="${h}">${title}<draw:text-box>${paragraphs}</draw:text-box></draw:frame>`;
  const prst = kind === TEXT_BOX || !isKnownShape(kind) ? "rect" : kind;
  return `<draw:custom-shape ${common}${positionAttrs(a, x, y)} svg:width="${w}" svg:height="${h}">${title}${paragraphs}<draw:enhanced-geometry svg:viewBox="0 0 21600 21600" draw:type="ooxml-${prst}" draw:enhanced-path="M 0 0 L 21600 0 21600 21600 0 21600 0 0 Z N"/></draw:custom-shape>`;
}

/** A shape or group: inline ones get their own paragraph, floating ones wait for the next paragraph (their anchor). */
function shapeOdt(ctx: Ctx, n: PM): string {
  const a = n.attrs ?? {};
  let xml: string;
  if (n.type === "shapeGroup") {
    if (Number(a.rotation)) ctx.warnings.add("Rotation d'un groupe de formes : non conservée en ODT.");
    const g: Record<string, unknown> = { ...a, rotation: 0 };
    const children = (n.content ?? []).map((c) => shapeElement(ctx, c, { x: (Number(g.x) || 0) + (Number(c.attrs?.x) || 0), y: (Number(g.y) || 0) + (Number(c.attrs?.y) || 0) }, { wrap: g.wrap, anchor: g.anchor, z: g.z })).join("");
    xml = `<draw:g text:anchor-type="${anchorAttr(g)}"${zAttr(g)}>${children}</draw:g>`;
  } else xml = shapeElement(ctx, n);
  if (a.wrap === "inline" || !a.wrap) return `<text:p text:style-name="${ctx.paraStyle("Standard", String(a.align ?? "left"))}">${xml}</text:p>`;
  ctx.anchored.push(xml);
  return "";
}

const tocText = (n: PM): string => (n.text ?? "") + (n.content ?? []).map(tocText).join("");

/** A table of contents as OpenDocument has it: the source (what LibreOffice regenerates it from) and the lines as last generated. */
function tocBlock(ctx: Ctx, n: PM): string {
  const levels = Math.min(3, Math.max(1, Math.trunc(Number(n.attrs?.levels)) || 3));
  const title = esc(String(n.attrs?.title ?? ""));
  if (n.attrs?.kind === "captions" && typeof n.attrs.label === "string") {
    // A list of figures / tables: LibreOffice's illustration index of the sequence.
    const label = esc(n.attrs.label);
    const name = `Illustration_Index${++ctx.tocs}`;
    const lines = (n.content ?? []).filter((e) => e.type === "tocEntry").map((e) => `<text:p text:style-name="Illustration_20_Index_20_1">${esc(tocText(e))}<text:tab/>${esc(String(e.attrs?.page ?? ""))}</text:p>`).join("");
    return `<text:illustration-index text:protected="false" text:name="${name}"><text:illustration-index-source text:caption-sequence-name="${label}" text:caption-sequence-format="text" text:use-caption="true">${title ? `<text:index-title-template text:style-name="Contents_20_Heading">${title}</text:index-title-template>` : ""}<text:illustration-index-entry-template text:style-name="Illustration_20_Index_20_1"><text:index-entry-text/><text:index-entry-tab-stop style:type="right" style:leader-char="."/><text:index-entry-page-number/></text:illustration-index-entry-template></text:illustration-index-source><text:index-body>${title ? `<text:index-title text:name="${name}_Head"><text:p text:style-name="Contents_20_Heading">${title}</text:p></text:index-title>` : ""}${lines}</text:index-body></text:illustration-index>`;
  }
  const templates = Array.from({ length: levels }, (_, i) => `<text:table-of-content-entry-template text:outline-level="${i + 1}" text:style-name="Contents_20_${i + 1}"><text:index-entry-chapter/><text:index-entry-text/><text:index-entry-tab-stop style:type="right" style:leader-char="."/><text:index-entry-page-number/></text:table-of-content-entry-template>`).join("");
  const lines = (n.content ?? []).filter((e) => e.type === "tocEntry").map((e) => `<text:p text:style-name="Contents_20_${Math.min(3, Math.max(1, Math.trunc(Number(e.attrs?.level)) || 1))}">${esc(tocText(e))}<text:tab/>${esc(String(e.attrs?.page ?? ""))}</text:p>`).join("");
  const name = `Table_of_Contents${++ctx.tocs}`;
  return `<text:table-of-content text:protected="false" text:name="${name}"><text:table-of-content-source text:outline-level="${levels}">${title ? `<text:index-title-template text:style-name="Contents_20_Heading">${title}</text:index-title-template>` : ""}${templates}</text:table-of-content-source><text:index-body>${title ? `<text:index-title text:name="${name}_Head"><text:p text:style-name="Contents_20_Heading">${title}</text:p></text:index-title>` : ""}${lines}</text:index-body></text:table-of-content>`;
}

/** A bibliography: its entries as last generated (LibreOffice rewrites them from the marks when it updates the index). */
function bibliographyBlock(n: PM): string {
  const title = esc(String(n.attrs?.title ?? ""));
  const entries = (n.content ?? []).filter((e) => e.type === "bibEntry").map((e) => `<text:p text:style-name="Bibliography_20_1">${(e.content ?? []).map((c) => esc(c.text ?? "")).join("")}</text:p>`).join("");
  return `<text:bibliography text:protected="false" text:name="Bibliography1"><text:bibliography-source>${title ? `<text:index-title-template text:style-name="Contents_20_Heading">${title}</text:index-title-template>` : ""}</text:bibliography-source><text:index-body>${title ? `<text:index-title text:name="Bibliography1_Head"><text:p text:style-name="Contents_20_Heading">${title}</text:p></text:index-title>` : ""}${entries}</text:index-body></text:bibliography>`;
}

function blocks(ctx: Ctx, nodes: PM[] = [], listStyle?: string): string {
  let out = "";
  const flush = () => { if (ctx.anchored.length) { out += `<text:p text:style-name="${ctx.paraStyle("Standard")}">${ctx.anchored.join("")}</text:p>`; ctx.anchored = []; } };
  for (const n of nodes) {
    // A section starts with a paragraph carrying its master page; when it starts with something else, an empty one carries it.
    if ((ctx.pendingMaster || ctx.pendingStart !== null) && n.type !== "paragraph" && n.type !== "heading") out += `<text:p text:style-name="${ctx.paraStyle("Standard", undefined, undefined, undefined, ctx.takeMaster(), ctx.takeStart())}"/>`;
    if (n.type !== "paragraph" && n.type !== "heading" && n.type !== "shape" && n.type !== "shapeGroup") flush();
    switch (n.type) {
      case "paragraph": case "heading": out += para(ctx, n, typeof n.attrs?.caption === "string" ? "Caption" : "Standard"); break;
      case "bibliography": out += bibliographyBlock(n); break;
      case "endnotes": break; // generated from the references (LibreOffice and Word place their own)
      case "tableOfContents": out += tocBlock(ctx, n); break;
      case "blockquote": for (const c of n.content ?? []) out += c.type === "paragraph" ? para(ctx, c, "Quote") : blocks(ctx, [c]); break;
      case "codeBlock":
        for (const line of (n.content?.map((c) => c.text).join("") ?? "").split("\n"))
          out += `<text:p text:style-name="${ctx.paraStyle("Preformatted_20_Text")}">${esc(line).replace(/ {2,}/g, (m) => ` <text:s text:c="${m.length - 1}"/>`)}</text:p>`;
        break;
      case "horizontalRule": out += `<text:p text:style-name="${ctx.paraStyle("Horizontal_20_Line")}"/>`; break;
      case "bulletList": case "orderedList": {
        const style = listStyle ?? (n.type === "bulletList" ? `LBullet_${cleanListType("bulletList", n.attrs?.listType) ?? "disc"}` : `LNumber_${cleanListType("orderedList", n.attrs?.listType) ?? "decimal"}`);
        const attr = listStyle ? "" : ` text:style-name="${style}"`;
        out += `<text:list${attr}>${(n.content ?? []).map((item) => `<text:list-item>${blocks(ctx, item.content, style)}</text:list-item>`).join("")}</text:list>`;
        break;
      }
      case "table": out += table(ctx, n); break;
      case "shape": case "shapeGroup": out += shapeOdt(ctx, n); break;
      case "pageBreak": out += `<text:p text:style-name="PgBreak"/>`; break;
      case "columnBreak": out += `<text:p text:style-name="ColBreak"/>`; break;
      case "image": out += `<text:p text:style-name="${ctx.paraStyle("Standard")}">${image(ctx, n)}</text:p>`; break;
    }
  }
  flush();
  return out;
}

function table(ctx: Ctx, n: PM): string {
  const id = ++ctx.tables;
  const rows = n.content ?? [];
  const cols = Math.max(1, ...rows.map((r) => (r.content ?? []).reduce((s, c) => s + +(c.attrs?.colspan ?? 1), 0)));
  const pending: number[] = Array(cols).fill(0); // remaining rows covered by a row-span, per column
  const look = cleanLook(n.attrs?.look);
  const place = cleanPlace(n.attrs?.place);
  if (place) ctx.colStyles.push(`<style:style style:name="${ctx.prefix}TblP${id}" style:family="table"><style:table-properties style:width="${pxToCm(place.w)}cm" table:align="left" fo:margin-left="${pxToCm(place.x)}cm"/></style:style>`);
  const renderRow = (row: PM, r: number): string => {
    let col = 0;
    const rh = cleanRowHeight(row.attrs?.rowHeight);
    let rowStyle = "";
    if (rh) { const name = `${ctx.prefix}Row${++ctx.rowStyles}`; ctx.colStyles.push(`<style:style style:name="${name}" style:family="table-row"><style:table-row-properties style:min-row-height="${pxToCm(rh)}cm"/></style:style>`); rowStyle = ` table:style-name="${name}"`; }
    let out = `<table:table-row${rowStyle}>`;
    const cover = () => { while (col < cols && pending[col] > 0) { out += "<table:covered-table-cell/>"; pending[col]--; col++; } };
    for (const cell of row.content ?? []) {
      cover();
      const cs = +(cell.attrs?.colspan ?? 1);
      const rs = +(cell.attrs?.rowspan ?? 1);
      const head = cell.type === "tableHeader";
      const cl = cellLook(look, { row: r, col, rows: rows.length, cols, header: head, explicitFill: cell.attrs?.shading as string | undefined });
      const line = (l: Line | null) => (l && !cell.attrs?.borderless ? `${+(l.width * 0.75).toFixed(2)}pt solid ${l.color}` : "none");
      const body = blocks(ctx, tint(cell.content, cl.textColor, cl.bold)) || `<text:p text:style-name="${ctx.paraStyle("Standard")}"/>`;
      out += `<table:table-cell table:style-name="${ctx.cellStyle({ fill: cl.fill, top: line(cl.top), bottom: line(cl.bottom), left: line(cl.left), right: line(cl.right) })}" office:value-type="string"${cs > 1 ? ` table:number-columns-spanned="${cs}"` : ""}${rs > 1 ? ` table:number-rows-spanned="${rs}"` : ""}>${body}</table:table-cell>`;
      for (let i = 1; i < cs; i++) out += "<table:covered-table-cell/>";
      for (let i = 0; i < cs; i++) pending[col + i] = rs > 1 ? rs - 1 : 0;
      col += cs;
    }
    cover();
    return out + "</table:table-row>";
  };
  const headerRows = rows.filter((r) => r.content?.length && r.content.every((c) => c.type === "tableHeader"));
  const leading = headerRows.length && rows.slice(0, headerRows.length).every((r) => headerRows.includes(r)) ? headerRows.length : 0;
  const head = rows.slice(0, leading).map((r, i) => renderRow(r, i)).join("");
  const rest = rows.slice(leading).map((r, i) => renderRow(r, i + leading)).join("");
  const widths = (rows[0]?.content ?? []).map((c) => (Array.isArray(c.attrs?.colwidth) ? (c.attrs!.colwidth as number[]).reduce((a, b) => a + b, 0) : 0));
  const known = widths.length === cols && widths.every((w) => w > 0);
  if (known) widths.forEach((w, i) => ctx.colStyles.push(`<style:style style:name="${ctx.prefix}TblCol${i + 1}_${id}" style:family="table-column"><style:table-column-properties style:column-width="${pxToCm(w)}cm"/></style:style>`));
  const colDefs = known ? widths.map((_, i) => `<table:table-column table:style-name="${ctx.prefix}TblCol${i + 1}_${id}"/>`).join("") : `<table:table-column table:number-columns-repeated="${cols}"/>`;
  return `<table:table table:name="Table${id}" table:style-name="${place ? `${ctx.prefix}TblP${id}` : "Tbl"}">${colDefs}${leading ? `<table:table-header-rows>${head}</table:table-header-rows>` : ""}${rest}</table:table>`;
}

function listStyles(): string {
  const levels = (kind: "bullet" | "number", type: string) =>
    Array.from({ length: 6 }, (_, i) => {
      const l = i + 1;
      const geometry = `<style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="${(1.27 * l).toFixed(2)}cm" fo:text-indent="-0.635cm" fo:margin-left="${(1.27 * l).toFixed(2)}cm"/></style:list-level-properties>`;
      const t = levelType(kind, i, type);
      return kind === "bullet"
        ? `<text:list-level-style-bullet text:level="${l}" text:bullet-char="${BULLET_CHARS[t]}">${geometry}</text:list-level-style-bullet>`
        : `<text:list-level-style-number text:level="${l}" style:num-suffix="." style:num-format="${NUMBER_FORMATS[t].odf}">${geometry}</text:list-level-style-number>`;
    }).join("");
  return [
    ...ALL_BULLET_IDS.map((id) => `<text:list-style style:name="LBullet_${id}">${levels("bullet", id)}</text:list-style>`),
    ...ALL_NUMBER_IDS.map((id) => `<text:list-style style:name="LNumber_${id}">${levels("number", id)}</text:list-style>`),
  ].join("");
}

/** Header or footer elements of the master page, written with their own style context (they live in styles.xml). */
function hfElements(ctx: Ctx, kind: "header" | "footer", set: HeaderFooterSet, titlePage: boolean, evenOdd: boolean): string {
  if (!hasContent(set)) return "";
  const wrap = (tag: string, c?: HeaderFooterContent) => {
    if (!c) return "";
    const body = blocks(ctx, c.blocks as PM[]) || `<text:p text:style-name="${ctx.paraStyle("Standard")}"/>`;
    return `<style:${tag}>${body}</style:${tag}>`;
  };
  return [wrap(kind, set.default), titlePage ? wrap(`${kind}-first`, set.first) : "", evenOdd ? wrap(`${kind}-left`, set.even) : ""].join("");
}

/** Every automatic style a context produced, plus the fixed ones (tables, page breaks), as XML. */
function automaticStyles(ctx: Ctx, model: DocumentModel): string {
  const textStyles = [...ctx.textStyles].map(([props, name]) => `<style:style style:name="${name}" style:family="text"><style:text-properties ${props}/></style:style>`).join("");
  const paraStyles = [...ctx.paraStyles]
    .map(([key, name]) => {
      const [parent, props, master] = key.split("|");
      return `<style:style style:name="${name}" style:family="paragraph" style:parent-style-name="${parent}"${master ? ` style:master-page-name="${master}"` : ""}>${props ? `<style:paragraph-properties ${props}/>` : ""}</style:style>`;
    })
    .join("");
  const sectionStyles = ctx.sectionStyles.join("");
  const cellStyles = [...ctx.cellStyles]
    .map(([key, name]) => {
      const c = JSON.parse(key) as { fill: string | null; top: string; bottom: string; left: string; right: string };
      const border = c.top === c.bottom && c.top === c.left && c.top === c.right ? `fo:border="${c.top}"` : `fo:border-top="${c.top}" fo:border-bottom="${c.bottom}" fo:border-left="${c.left}" fo:border-right="${c.right}"`;
      return `<style:style style:name="${name}" style:family="table-cell"><style:table-cell-properties fo:padding="0.1cm" ${border}${c.fill ? ` fo:background-color="${esc(c.fill)}"` : ""}/></style:style>`;
    })
    .join("");
  return `${textStyles}${paraStyles}${sectionStyles}${listStyles()}${ctx.colStyles.join("")}${cellStyles}${ctx.graphicStyles.join("")}
<style:style style:name="PgBreak" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:break-after="page"/></style:style>
<style:style style:name="ColBreak" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:break-after="column"/></style:style>
<style:style style:name="Tbl" style:family="table"><style:table-properties style:width="${pxToCm(pageDimensions(model.page).w - marginsPx(model.page).left - marginsPx(model.page).right)}cm" table:align="margins"/></style:style>
<style:style style:name="Cell" style:family="table-cell"><style:table-cell-properties fo:padding="0.1cm" fo:border="0.5pt solid #000000"/></style:style>
<style:style style:name="CellHead" style:family="table-cell"><style:table-cell-properties fo:padding="0.1cm" fo:border="0.5pt solid #000000" fo:background-color="#f3f4f6"/></style:style>`;
}

/** One section as ODF sees it: a page layout and a master page (with its headers and footers). */
interface OdtSection {
  page: PageSetup;
  hf: HeaderFooterSettings | null;
  hfXml: string;
  nodes: PM[];
  /** Starts on the page of the previous section (no master page of its own). */
  continuous: boolean;
}

const ODF_NUM: Record<string, string> = { decimal: "1", lowerRoman: "i", upperRoman: "I", lowerLetter: "a", upperLetter: "A" };

const masterName = (i: number) => (i === 0 ? "Standard" : `Section_${i + 1}`);

/** `style:page-layout` of a section: exact centimetres (not rounded through pixels); ODF has no binding margin, it is added to its margin. */
function pageLayout(sec: OdtSection, i: number): string {
  const paper = paperCm(sec.page);
  const [pw, ph] = sec.page.orientation === "landscape" ? [paper.height, paper.width] : [paper.width, paper.height];
  const mg = effectiveMarginsCm(sec.page);
  const usage = isMirrored(sec.page) ? ' style:page-usage="mirrored"' : "";
  const numFormat = sec.page.numberFormat && sec.page.numberFormat !== "decimal" ? ` style:num-format="${ODF_NUM[sec.page.numberFormat]}"` : "";
  const hf = sec.hf;
  return `<style:page-layout style:name="pm${i + 1}"${usage}><style:page-layout-properties fo:page-width="${+pw.toFixed(3)}cm" fo:page-height="${+ph.toFixed(3)}cm" style:print-orientation="${sec.page.orientation}"${numFormat} fo:margin-top="${+mg.top.toFixed(3)}cm" fo:margin-bottom="${+mg.bottom.toFixed(3)}cm" fo:margin-left="${+mg.left.toFixed(3)}cm" fo:margin-right="${+mg.right.toFixed(3)}cm"/>${hf && hasContent(hf.header) ? '<style:header-style><style:header-footer-properties fo:min-height="0.6cm" fo:margin-bottom="0.3cm"/></style:header-style>' : ""}${hf && hasContent(hf.footer) ? '<style:footer-style><style:header-footer-properties fo:min-height="0.6cm" fo:margin-top="0.3cm"/></style:footer-style>' : ""}</style:page-layout>`;
}

function namedStyles(model: DocumentModel, sections: OdtSection[], hfStyles: string, gradients: string): string {
  // The right tab of a table of contents line is at the right edge of the text of the first section.
  const tocWidth = (() => { const paper = paperCm(model.page); const w = model.page.orientation === "landscape" ? paper.height : paper.width; const mg = effectiveMarginsCm(model.page); return `${(w - mg.left - mg.right).toFixed(2)}cm`; })();
  const font = esc(model.defaults?.fontFamily ?? "Liberation Serif");
  const size = model.defaults?.fontSizePt ?? 12;
  // Paragraph styles in full (the built-in look plus the user's edits), so other editors show the same.
  const look = (id: StyleId) => {
    const r = resolveStyle(id, model.styles ?? {}, { fontFamily: model.defaults?.fontFamily ?? "Liberation Serif", sizePt: size });
    const para = `fo:margin-top="${r.spaceBefore}pt" fo:margin-bottom="${r.spaceAfter}pt" fo:line-height="${Math.round(r.lineHeight * 100)}%" fo:text-align="${{ left: "start", center: "center", right: "end", justify: "justify" }[r.align]}"`;
    const text = (withSize: boolean) => `${withSize ? `fo:font-size="${r.sizePt}pt" ` : ""}${id === "code" || model.styles?.[id]?.fontFamily ? `fo:font-family="${esc(r.fontFamily)}" ` : ""}fo:font-weight="${r.bold ? "bold" : "normal"}" fo:font-style="${r.italic ? "italic" : "normal"}" fo:color="${r.color}"`;
    return { para, text };
  };
  const heading = (n: 1 | 2 | 3) => {
    const l = look(`h${n}` as StyleId);
    return `<style:style style:name="Heading_20_${n}" style:display-name="Heading ${n}" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Standard" style:default-outline-level="${n}"><style:paragraph-properties ${l.para} fo:keep-with-next="always"/><style:text-properties ${l.text(true)}/></style:style>`;
  };
  const normal = look("normal");
  const quoteLook = look("quote");
  const codeLook = look("code");
  const codeFont = resolveStyle("code", model.styles ?? {}, { fontFamily: "", sizePt: size }).fontFamily;
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles ${NS} office:version="1.3">
<office:styles>
<style:default-style style:family="paragraph"><style:paragraph-properties fo:orphans="2" fo:widows="2"/><style:text-properties fo:font-family="${font}" fo:font-size="${size}pt" fo:language="fr" fo:country="FR"/></style:default-style>
<style:style style:name="Bibliography_20_1" style:display-name="Bibliography 1" style:family="paragraph" style:parent-style-name="Standard" style:class="index"><style:paragraph-properties fo:margin-left="0.85cm" fo:text-indent="-0.85cm" fo:margin-bottom="0.2cm"/></style:style>
<style:style style:name="Caption" style:family="paragraph" style:parent-style-name="Standard" style:class="extra"><style:paragraph-properties fo:margin-top="0.1cm" fo:margin-bottom="0.28cm"/><style:text-properties fo:font-size="9pt" fo:font-style="italic" fo:color="#44546a"/></style:style>
<style:style style:name="Illustration_20_Index_20_1" style:display-name="Illustration Index 1" style:family="paragraph" style:parent-style-name="Standard" style:class="index"><style:paragraph-properties fo:margin-bottom="0.1cm"><style:tab-stops><style:tab-stop style:position="${tocWidth}" style:type="right" style:leader-style="dotted" style:leader-text="."/></style:tab-stops></style:paragraph-properties></style:style>
<style:style style:name="Contents_20_Heading" style:display-name="Contents Heading" style:family="paragraph" style:parent-style-name="Standard" style:class="index"><style:paragraph-properties fo:margin-top="0.42cm" fo:margin-bottom="0.3cm"/><style:text-properties fo:font-size="16pt" fo:font-weight="bold" fo:color="#1d4ed8"/></style:style>
${[1, 2, 3].map((l) => `<style:style style:name="Contents_20_${l}" style:display-name="Contents ${l}" style:family="paragraph" style:parent-style-name="Standard" style:class="index"><style:paragraph-properties fo:margin-left="${(l - 1) * 0.42}cm" fo:margin-bottom="0.1cm"><style:tab-stops><style:tab-stop style:position="${tocWidth}" style:type="right" style:leader-style="dotted" style:leader-text="."/></style:tab-stops></style:paragraph-properties>${l === 1 ? '<style:text-properties fo:font-weight="bold"/>' : ""}</style:style>`).join("\n")}
<style:style style:name="Standard" style:family="paragraph" style:class="text"><style:paragraph-properties ${normal.para}/>${model.styles?.normal ? `<style:text-properties ${normal.text(false).replace(/fo:font-family="[^"]*" /, "")}/>` : ""}</style:style>
${heading(1)}${heading(2)}${heading(3)}
<style:style style:name="Quote" style:display-name="Quote" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties ${quoteLook.para} fo:margin-left="1cm" fo:border-left="1.5pt solid #2563eb" fo:padding-left="0.3cm"/><style:text-properties ${quoteLook.text(true)}/></style:style>
<style:style style:name="Preformatted_20_Text" style:display-name="Preformatted Text" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties ${codeLook.para} fo:background-color="#f3f4f6"/><style:text-properties ${codeLook.text(true).replace(/fo:font-family="[^"]*"/, `fo:font-family="${codeFont === "JetBrains Mono" ? "Liberation Mono" : esc(codeFont)}"`)}/></style:style>
<style:style style:name="Horizontal_20_Line" style:display-name="Horizontal Line" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:border-bottom="0.5pt solid #999999" fo:margin-bottom="0.3cm"/></style:style>
${gradients}
</office:styles>
<office:automatic-styles>
${hfStyles}
${sections.map((sec, i) => pageLayout(sec, i)).join("\n")}
</office:automatic-styles>
<office:master-styles>${sections.map((sec, i) => `<style:master-page style:name="${masterName(i)}" style:page-layout-name="pm${i + 1}">${sec.hfXml}</style:master-page>`).join("")}</office:master-styles>
</office:document-styles>`;
}

export async function exportOdt(model: DocumentModel): Promise<ExportResult> {
  const ctx = new Ctx();
  if (cleanWatermark(model.watermark)) ctx.warnings.add("Filigrane : non écrit dans les fichiers ODT (il est conservé en DOCX et dans les documents Loma).");
  // Sections: the document's own setup, then one per section break (each with its master page; a section without headers of its own
  // repeats the previous ones, which is what ODF needs).
  const hfCtx = new Ctx("H"); // headers and footers live in styles.xml: they need their own style and picture namespace
  const sections: OdtSection[] = [{ page: model.page, hf: model.headerFooter ?? null, hfXml: "", nodes: [], continuous: false }];
  for (const n of model.content.content ?? []) {
    if (n.type === SECTION_BREAK) {
      const prev = sections[sections.length - 1];
      const continuous = n.attrs?.kind === "continuous";
      const own = sanitizePage(n.attrs?.page as Partial<PageSetup>);
      let page = own;
      if (continuous) { const { columns, ...rest } = prev.page; void columns; page = { ...rest, ...(own.columns ? { columns: own.columns } : {}) }; }
      sections.push({ page, hf: !continuous && n.attrs?.hf ? sanitizeHeaderFooter(n.attrs.hf) : prev.hf, hfXml: "", nodes: [], continuous });
    } else sections[sections.length - 1].nodes.push(n);
  }
  ctx.sources = new Map(cleanSources(model.content.attrs?.sources).map((s) => [s.tag, s]));
  let body = "";
  sections.forEach((sec, i) => {
    // A restart needs the paragraph to name its master page (that is how ODF ties a page number change to a page).
    ctx.pendingMaster = sec.continuous ? null : i > 0 || sec.page.numberStart !== undefined ? masterName(i) : null;
    ctx.pendingStart = sec.continuous ? null : sec.page.numberStart ?? null;
    let inner = blocks(ctx, sec.nodes);
    if (ctx.pendingMaster || ctx.pendingStart !== null) inner += `<text:p text:style-name="${ctx.paraStyle("Standard", undefined, undefined, undefined, ctx.takeMaster(), ctx.takeStart())}"/>`; // an empty section still starts its page
    // Columns are an ODF `text:section` around the blocks (a section without columns needs no wrapper).
    const cols = sec.page.columns;
    if (cols && inner) {
      const name = `Sect${ctx.sectionStyles.length + 1}`;
      ctx.sectionStyles.push(`<style:style style:name="${name}" style:family="section"><style:section-properties text:dont-balance-text-columns="false"><style:columns fo:column-count="${cols.count}" fo:column-gap="${+cols.gapCm.toFixed(3)}cm">${cols.line ? '<style:column-sep style:width="0.5pt" style:color="#808080" style:style="solid" style:height="100%"/>' : ""}${Array.from({ length: cols.count }, () => `<style:column style:rel-width="${Math.round(65535 / cols.count)}*" fo:start-indent="0cm" fo:end-indent="0cm"/>`).join("")}</style:columns></style:section-properties></style:style>`);
      inner = `<text:section text:style-name="${name}" text:name="Section${ctx.sectionStyles.length}">${inner}</text:section>`;
    }
    body += inner;
    const hf = sec.hf;
    sec.hfXml = hf ? hfElements(hfCtx, "header", hf.header, hf.titlePage, hf.evenOdd) + hfElements(hfCtx, "footer", hf.footer, hf.titlePage, hf.evenOdd) : "";
  });
  body = body || `<text:p text:style-name="${ctx.paraStyle("Standard")}"/>`;

  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content ${NS} office:version="1.3">
<office:automatic-styles>
${automaticStyles(ctx, model)}
</office:automatic-styles>
<office:body><office:text>${[...ctx.seqLabels].length ? `<text:sequence-decls>${[...ctx.seqLabels].map((l) => `<text:sequence-decl text:display-outline-level="0" text:name="${esc(l)}"/>`).join("")}</text:sequence-decls>` : ""}${body}</office:text></office:body>
</office:document-content>`;

  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
<manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="${ODT_MIME}"/>
<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>
${ctx.formulas.map((f) => `<manifest:file-entry manifest:full-path="${f.dir}/" manifest:media-type="application/vnd.oasis.opendocument.formula"/>\n<manifest:file-entry manifest:full-path="${f.dir}/content.xml" manifest:media-type="text/xml"/>`).join("\n")}
${[...ctx.pictures, ...hfCtx.pictures].map((p) => `<manifest:file-entry manifest:full-path="${p.name}" manifest:media-type="${p.name.endsWith(".png") ? "image/png" : p.name.endsWith(".jpg") ? "image/jpeg" : "image/" + p.name.split(".").pop()}"/>`).join("\n")}
</manifest:manifest>`;
  // The sources and the style of the citations travel in the metadata (uncited sources have no mark to hold them).
  const sourceList = cleanSources(model.content.attrs?.sources);
  const meta = `<?xml version="1.0" encoding="UTF-8"?>\n<office:document-meta ${NS} office:version="1.3"><office:meta><meta:generator>Loma Writer</meta:generator>${sourceList.length ? `<meta:user-defined meta:name="LomaSources" meta:value-type="string">${esc(JSON.stringify(sourceList))}</meta:user-defined><meta:user-defined meta:name="LomaCitationStyle" meta:value-type="string">${isCitationStyle(model.content.attrs?.citationStyle) ? model.content.attrs.citationStyle : "apa"}</meta:user-defined>` : ""}</office:meta></office:document-meta>`;

  const zip = new JSZip();
  zip.file("mimetype", ODT_MIME, { compression: "STORE" }); // must be first and uncompressed
  zip.file("META-INF/manifest.xml", manifest);
  zip.file("content.xml", content);
  zip.file("styles.xml", namedStyles(model, sections, automaticStyles(hfCtx, model), ctx.gradients.join("")));
  zip.file("meta.xml", meta);
  for (const p of [...ctx.pictures, ...hfCtx.pictures]) zip.file(p.name, p.bytes);
  for (const f of ctx.formulas) zip.file(`${f.dir}/content.xml`, `<?xml version="1.0" encoding="UTF-8"?>\n${f.mathml}`);
  return { bytes: await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }), warnings: [...ctx.warnings, ...hfCtx.warnings] };
}
