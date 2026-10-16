import { SECTION_BREAK } from "../../editor/Sections";
import { sanitizePage } from "./sanitize";
import { cleanWatermark, type Watermark } from "../../editor/watermark";
import { cleanLayout } from "../../editor/ParagraphFormat";
import { cleanRowHeight } from "../../editor/TableRowResize";
import { cleanPlace } from "../../editor/TableLook";
import { cellLook, cleanLook, tint, type Line } from "../../editor/tableStyles";
import { resolveStyle, type StyleId } from "../../editor/docStyles";
import { ALL_BULLET_IDS, ALL_NUMBER_IDS, BULLET_CHARS, levelType } from "./listFormats";
import { cleanListType } from "../../editor/ListTypes";
import {
  AlignmentType, NumberFormat, HeightRule, SectionType, HorizontalPositionRelativeFrom, TextWrappingSide, TextWrappingType, VerticalPositionRelativeFrom, Bookmark, BorderStyle, Document, ExternalHyperlink, Footer, Header, InternalHyperlink, PageNumber, HeadingLevel, ImageRun, LevelFormat, Packer, PageOrientation, Paragraph,
  PageBreak as DocxPageBreak, ColumnBreak as DocxColumnBreak, SimpleField, FootnoteReferenceRun, ShadingType, Table, TableCell, TableRow, TextRun, WidthType, type ParagraphChild,
} from "docx";
import { marginsPx, pageDimensions, type PageSetup } from "../../state/types";
import { baseMarginsCm, cmToPx, gutterOf, isMirrored } from "../../state/page";
import { imageSize, parseDataUri } from "./xml";
import type { PM, Mark } from "./pm";
import { addEndnotes, RawXml } from "./docxPost";
import { bodyOf, type NoteParagraph } from "../../editor/references/noteBody";
import { cleanNotesOptions } from "../../editor/references/notesNumbering";
import { tocBookmark, tocXml } from "./docxToc";
import { addSourcesPart, bibliographyXml } from "./docxBib";
import { cleanSources, isCitationStyle, type CitationStyle, type Source } from "../../editor/references/sources";
import { groupRunXml, shapeRunXml } from "./docxShapes";
import { latexToMathml, parseMathml } from "../math/mathml";
import { mathmlElementToOmml } from "../math/omml";
import { hasContent, sanitizeHeaderFooter, type HeaderFooterContent, type HeaderFooterSet, type HeaderFooterSettings } from "../../pagination/headerFooter";
import type { DocumentModel, ExportResult } from "./types";

const TWIPS_PER_PX = 15;
const ALIGN: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED,
};
const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3];
const MAX_IMAGE_WIDTH_PX = 600;
const hex = (c: string) => c.replace("#", "").toUpperCase();

function toPt(size: unknown): number | undefined {
  const m = /^([\d.]+)\s*(pt|px)?$/.exec(String(size ?? ""));
  return m ? (m[2] === "px" ? +m[1] * 0.75 : +m[1]) : undefined;
}

interface Ctx {
  warnings: Set<string>;
  raw: RawXml;
  shapeId: number;
  orderedInstances: number;
  /** The sources and the style of the citations. */
  sources: Source[];
  citationStyle: CitationStyle;
  /** Footnotes (the docx library writes them) and endnote texts (written by `addEndnotes`). */
  footnotes: Record<number, { children: Paragraph[] }>;
  endnotes: NoteParagraph[][];
  /** The document has a table of contents: headings get the bookmark its entries link to. */
  hasToc: boolean;
  /** Rank of the next heading. */
  headings: number;
  /** Position of the right tab of the table of contents lines (twips). */
  tocTab: number;
  defaults: { fontFamily: string; fontSizePt: number };
}

function runOptions(marks: Mark[] = []) {
  const o: Record<string, unknown> = {};
  for (const m of marks) {
    switch (m.type) {
      case "bold": o.bold = true; break;
      case "italic": o.italics = true; break;
      case "underline": o.underline = {}; break;
      case "strike": o.strike = true; break;
      case "subscript": o.subScript = true; break;
      case "superscript": o.superScript = true; break;
      case "highlight": if (m.attrs?.color) o.shading = { type: ShadingType.CLEAR, fill: hex(String(m.attrs.color)), color: "auto" }; break;
      case "textStyle": {
        const a = m.attrs ?? {};
        if (a.fontFamily) o.font = String(a.fontFamily);
        const pt = toPt(a.fontSize);
        if (pt) o.size = Math.round(pt * 2);
        if (a.color) o.color = hex(String(a.color));
        break;
      }
    }
  }
  return o;
}

const lineHeightOf = (content: PM[]): number | undefined => {
  for (const n of content) {
    const lh = n.marks?.find((m) => m.type === "textStyle")?.attrs?.lineHeight;
    if (lh && +String(lh) > 0) return Math.round(+String(lh) * 240);
  }
  return undefined;
};

/** Word's rules for a bookmark name: at most 40 characters, a letter or an underscore first, no spaces or punctuation. */
const wordBookmarkName = (name: string) => {
  const clean = name.normalize("NFC").replace(/[^\p{L}\p{N}_]/gu, "_").slice(0, 40);
  return /^[\p{L}_]/u.test(clean) ? clean : `_${clean}`.slice(0, 40);
};

function inline(ctx: Ctx, nodes: PM[] = []): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const n of nodes) {
    if (n.type === "hardBreak") out.push(new TextRun({ break: 1 }));
    else if (n.type === "pageField") out.push(new TextRun({ children: [n.attrs?.kind === "pages" ? PageNumber.TOTAL_PAGES : PageNumber.CURRENT] }));
    else if (n.type === "seqField") out.push(new SimpleField(`SEQ ${String(n.attrs?.label ?? "Figure")} \\* ARABIC`, String(n.attrs?.n ?? 1)))
    else if (n.type === "citation") {
      const tag = String(n.attrs?.tag ?? "").replace(/[^\p{L}\p{N}_.:-]/gu, "");
      const page = String(n.attrs?.page ?? "").replace(/[^\p{L}\p{N}.,-]/gu, "");
      const instr = `CITATION ${tag} \\l 1036${page ? ` \\p ${page}` : ""}`;
      const t = String(n.attrs?.text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      // a complex field, as Word writes it
      out.push(new TextRun({ text: ctx.raw.add("CITE", `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t xml:space="preserve">${t}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`) }));
    }
    else if (n.type === "footnote") {
      const body = bodyOf((n.attrs ?? {}) as { body?: unknown; text?: unknown });
      if (n.attrs?.kind === "end") {
        ctx.endnotes.push(body);
        out.push(new TextRun({ text: ctx.raw.add("ENDREF", `<w:r><w:rPr><w:rStyle w:val="EndnoteReference"/></w:rPr><w:endnoteReference w:id="${ctx.endnotes.length}"/></w:r>`) }));
      } else {
        const id = Object.keys(ctx.footnotes).length + 1;
        ctx.footnotes[id] = { children: (body.length ? body : [{ type: "paragraph" as const, content: [] }]).map((p) => new Paragraph({ style: "FootnoteText", children: inline(ctx, p.content as PM[]) })) };
        out.push(new FootnoteReferenceRun(id));
      }
    }
    else if (n.type === "bookmark") out.push(new Bookmark({ id: wordBookmarkName(String(n.attrs?.name ?? "signet")), children: [] }));
    else if (n.type === "equation") {
      // A native Word equation (OMML), built from the KaTeX MathML of the formula.
      const omml = mathmlElementToOmml(parseMathml(latexToMathml(String(n.attrs?.latex ?? ""))).documentElement);
      out.push(new TextRun({ text: ctx.raw.add("MATH", omml) }));
    }
    else if (n.type === "image") {
      const img = imageRun(ctx, n);
      if (img) out.push(img);
    } else if (n.type === "text" && n.text !== undefined) {
      const link = n.marks?.find((m) => m.type === "link")?.attrs?.href;
      const parts = n.text.split("\t");
      const runs = parts.flatMap((part, i) => [...(i ? [new TextRun({ ...runOptions(n.marks), children: ["\t"] })] : []), ...(part ? [new TextRun({ ...runOptions(n.marks), text: part })] : [])]);
      if (link && String(link).startsWith("#")) out.push(new InternalHyperlink({ anchor: decodeURIComponent(String(link).slice(1)), children: runs }));
      else if (link) out.push(new ExternalHyperlink({ link: String(link), children: runs.map((r) => r) }));
      else out.push(...runs);
    }
  }
  return out;
}

function imageRun(ctx: Ctx, n: PM): ImageRun | null {
  const data = parseDataUri(String(n.attrs?.src ?? ""));
  if (!data) { ctx.warnings.add("Une image qui n'est pas intégrée au document n'a pas pu être exportée."); return null; }
  const type = ({ "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/bmp": "bmp" } as const)[data.mime as "image/png"];
  if (!type) { ctx.warnings.add(`Une image ${data.mime.replace("image/", "").toUpperCase()} n'est pas exportable en DOCX et a été omise.`); return null; }
  const natural = imageSize(data.bytes) ?? { w: 300, h: 200 };
  let w = +(n.attrs?.width ?? natural.w);
  let h = +(n.attrs?.height ?? natural.h);
  if (w > MAX_IMAGE_WIDTH_PX) { h = (h * MAX_IMAGE_WIDTH_PX) / w; w = MAX_IMAGE_WIDTH_PX; }
  const wrap = String(n.attrs?.wrap ?? "inline");
  const rotation = Number(n.attrs?.rotation) || 0;
  const emu = (px: number) => Math.round(px * 9525);
  const x = Number(n.attrs?.x) || 0, y = Number(n.attrs?.y) || 0;
  const floating =
    wrap === "front" || wrap === "behind"
      ? { horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: emu(x) }, verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: emu(y) }, behindDocument: wrap === "behind", allowOverlap: true, zIndex: 251658240 + (Number(n.attrs?.z) || 0) + 50, wrap: { type: TextWrappingType.NONE } }
      : wrap === "square"
        ? { horizontalPosition: { relative: HorizontalPositionRelativeFrom.COLUMN, offset: emu(x) }, verticalPosition: { relative: VerticalPositionRelativeFrom.PARAGRAPH, offset: emu(y) }, allowOverlap: false, wrap: { type: TextWrappingType.SQUARE, side: TextWrappingSide.BOTH_SIDES } }
        : undefined;
  return new ImageRun({ type, data: data.bytes, transformation: { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)), ...(rotation ? { rotation } : {}) }, ...(floating ? { floating } : {}), altText: { name: "image", description: String(n.attrs?.alt ?? ""), title: "image" } });
}

const NUMBER_FORMATS = { decimal: NumberFormat.DECIMAL, upperRoman: NumberFormat.UPPER_ROMAN, lowerRoman: NumberFormat.LOWER_ROMAN, upperLetter: NumberFormat.UPPER_LETTER, lowerLetter: NumberFormat.LOWER_LETTER } as const;

const cmTw = (cm: number) => Math.round(cm * 567);

type ListCtx = { ref: string; level: number; instance: number } | null;

function paragraphFor(ctx: Ctx, n: PM, extra: Record<string, unknown> = {}, list: ListCtx = null, lead: ParagraphChild[] = []): Paragraph {
  const line = lineHeightOf(n.content ?? []);
  const L = cleanLayout(n.attrs as never);
  const shading = n.attrs?.shading ? { type: ShadingType.CLEAR, fill: hex(String(n.attrs.shading)), color: "auto" } : undefined;
  const b = n.attrs?.borders as { top?: boolean; right?: boolean; bottom?: boolean; left?: boolean } | null | undefined;
  const side = { style: BorderStyle.SINGLE, size: 6, color: "6B7280", space: 4 };
  const border = b ? { ...(b.top ? { top: side } : {}), ...(b.right ? { right: side } : {}), ...(b.bottom ? { bottom: side } : {}), ...(b.left ? { left: side } : {}) } : undefined;
  return new Paragraph({
    children: [...lead, ...(n.type === "heading" && ctx.hasToc ? [new Bookmark({ id: tocBookmark(ctx.headings++), children: inline(ctx, n.content) as never })] : inline(ctx, n.content))],
    ...(n.attrs?.textAlign && n.attrs.textAlign !== "left" ? { alignment: ALIGN[String(n.attrs.textAlign)] } : {}),
    ...(shading ? { shading } : {}),
    ...(border && Object.keys(border).length ? { border } : {}),
    ...(line || L.spaceBefore !== null || L.spaceAfter !== null ? { spacing: { ...(line ? { line, lineRule: "auto" as const } : {}), ...(L.spaceBefore !== null ? { before: Math.round(L.spaceBefore * 20) } : {}), ...(L.spaceAfter !== null ? { after: Math.round(L.spaceAfter * 20) } : {}) } } : {}),
    // Indents in a list come from the list's own numbering levels.
    ...(!list && (L.indentLeft || L.indentRight || L.firstLine) ? { indent: { ...(L.indentLeft ? { left: cmTw(L.indentLeft) } : {}), ...(L.indentRight ? { right: cmTw(L.indentRight) } : {}), ...(L.firstLine > 0 ? { firstLine: cmTw(L.firstLine) } : L.firstLine < 0 ? { hanging: cmTw(-L.firstLine) } : {}) } } : {}),
    ...(L.pageBreakBefore ? { pageBreakBefore: true } : {}),
    ...(L.keepWithNext ? { keepNext: true } : {}),
    ...(L.keepLines ? { keepLines: true } : {}),
    ...(n.type === "heading" ? { heading: HEADINGS[Math.min(3, Math.max(1, +(n.attrs?.level ?? 1))) - 1] } : {}),
    ...(list ? { numbering: { reference: list.ref, level: list.level, instance: list.instance } } : {}),
    ...extra,
  });
}

type Block = Paragraph | Table;

function blocks(ctx: Ctx, nodes: PM[] = [], list: ListCtx = null): Block[] {
  const out: Block[] = [];
  // Floating objects are anchored in the paragraph that follows them, as Word does (no empty carrier paragraph).
  let anchored: ParagraphChild[] = [];
  const takeAnchored = () => { const a = anchored; anchored = []; return a; };
  const flushAnchored = () => { if (anchored.length) out.push(new Paragraph({ children: takeAnchored() })); };
  for (const n of nodes) {
    if (n.type !== "paragraph" && n.type !== "heading" && n.type !== "shape" && n.type !== "shapeGroup") flushAnchored();
    switch (n.type) {
      case "paragraph": case "heading": out.push(paragraphFor(ctx, n, typeof n.attrs?.caption === "string" ? { style: "Caption" } : {}, null, takeAnchored())); break;
      case "bibliography": out.push(new Paragraph({ children: [new TextRun({ text: ctx.raw.addBlock("BIB", bibliographyXml(n)) })] })); break;
      case "endnotes": break; // generated from the references: Word builds its own endnotes
      case "tableOfContents": out.push(new Paragraph({ children: [new TextRun({ text: ctx.raw.addBlock("TOC", tocXml(n, ctx.tocTab)) })] })); break;
      case "blockquote":
        for (const c of n.content ?? []) {
          if (c.type === "paragraph") out.push(paragraphFor(ctx, c, { style: "Quote" }));
          else out.push(...blocks(ctx, [c]));
        }
        break;
      case "codeBlock": for (const line of (n.content?.map((c) => c.text).join("") ?? "").split("\n")) out.push(new Paragraph({ style: "CodeBlock", children: [new TextRun(line)] })); break;
      case "horizontalRule": out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } } })); break;
      case "bulletList": case "orderedList": {
        const ref = listRef(n.type === "bulletList" ? "bullet" : "ordered", n.attrs?.listType, list);
        const instance = list ? list.instance : ++ctx.orderedInstances;
        for (const item of n.content ?? []) {
          const level = list ? list.level + 1 : 0;
          const here: ListCtx = { ref, level: Math.min(level, 5), instance };
          (item.content ?? []).forEach((child, i) => {
            if (child.type === "paragraph" || child.type === "heading") out.push(paragraphFor(ctx, child, i === 0 ? {} : { indent: { left: 720 * (here.level + 1) } }, i === 0 ? here : null));
            else out.push(...blocks(ctx, [child], here));
          });
        }
        break;
      }
      case "table": out.push(table(ctx, n)); break;
      case "shape": case "shapeGroup": {
        // A real DrawingML shape, text box or group (not a picture).
        const attrs = n.attrs ?? {};
        const id = ++ctx.shapeId;
        ctx.shapeId += n.type === "shapeGroup" ? (n.content?.length ?? 0) : 0;
        const run = n.type === "shape" ? shapeRunXml(attrs, n.content ?? [], id) : groupRunXml(attrs, n.content ?? [], id);
        const placeholder = new TextRun({ text: ctx.raw.add("SHAPE", run) });
        if (attrs.wrap === "inline" || !attrs.wrap) {
          flushAnchored();
          out.push(new Paragraph({ alignment: ALIGN[String(attrs.align ?? "left")], children: [placeholder] }));
        } else anchored.push(placeholder);
        break;
      }
      case "image": out.push(new Paragraph({ children: inline(ctx, [n]) })); break;
      case "pageBreak": out.push(new Paragraph({ children: [new DocxPageBreak()] })); break;
      case "columnBreak": out.push(new Paragraph({ children: [new DocxColumnBreak()] })); break;
    }
  }
  flushAnchored();
  return out;
}

function table(ctx: Ctx, n: PM): Table {
  const look = cleanLook(n.attrs?.look);
  const cols = Math.max(1, ...((n.content ?? []).map((r) => (r.content ?? []).reduce((s, c) => s + +(c.attrs?.colspan ?? 1), 0))));
  const first = n.content?.[0]?.content ?? [];
  const known = first.length === cols && first.every((c) => Array.isArray(c.attrs?.colwidth));
  const place = cleanPlace(n.attrs?.place);
  const widths = known ? first.map((c) => (c.attrs!.colwidth as number[]).reduce((a, b) => a + b, 0) * TWIPS_PER_PX) : Array(cols).fill(Math.floor((place ? place.w * TWIPS_PER_PX : 9000) / cols));
  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths,
    // A table moved freely keeps its offset from the text column (negative: into the margin).
    ...(place ? { indent: { size: Math.round(place.x * TWIPS_PER_PX), type: WidthType.DXA } } : {}),
    rows: (n.content ?? []).map(
      (row, r) => {
        let col = 0;
        return new TableRow({
          tableHeader: row.content?.every((c) => c.type === "tableHeader") || undefined,
          // A dragged row height is a minimum: the row still grows with its content.
          ...(cleanRowHeight(row.attrs?.rowHeight) ? { height: { value: Math.round(cleanRowHeight(row.attrs?.rowHeight)! * TWIPS_PER_PX), rule: HeightRule.ATLEAST } } : {}),
          children: (row.content ?? []).map((cell) => {
            const span = +(cell.attrs?.colspan ?? 1);
            const c0 = col;
            col += span;
            const cl = cellLook(look, { row: r, col: c0, rows: (n.content ?? []).length, cols, header: cell.type === "tableHeader", explicitFill: cell.attrs?.shading as string | undefined });
            const body = blocks(ctx, tint(cell.content, cl.textColor, cl.bold));
            const side = (l: Line | null) => (l ? { style: BorderStyle.SINGLE, size: Math.max(2, Math.round(l.width * 6)), color: hex(l.color) } : { style: BorderStyle.NONE, size: 0, color: "auto" });
            return new TableCell({
              columnSpan: span > 1 ? span : undefined,
              rowSpan: +(cell.attrs?.rowspan ?? 1) > 1 ? +(cell.attrs!.rowspan as number) : undefined,
              children: (body.length ? body : [new Paragraph("")]) as Paragraph[],
              // The table style's fill (header, banded rows); a shading chosen by the user replaces it.
              ...(cl.fill ? { shading: { type: ShadingType.CLEAR, fill: hex(cl.fill), color: "auto" } } : {}),
              borders: cell.attrs?.borderless ? { top: side(null), bottom: side(null), left: side(null), right: side(null) } : { top: side(cl.top), bottom: side(cl.bottom), left: side(cl.left), right: side(cl.right) },
            });
          }),
        });
      },
    ),
  });
}

/** Numbering reference of a list: nested lists keep the reference of the list they sit in (typed or not). */
const listRef = (kind: "bullet" | "ordered", type: unknown, parent: ListCtx | null) =>
  parent ? parent.ref : `${kind}-${kind === "bullet" ? (cleanListType("bulletList", type) ?? "disc") : (cleanListType("orderedList", type) ?? "decimal")}`;

const LEVEL_FORMATS: Record<string, (typeof LevelFormat)[keyof typeof LevelFormat]> = {
  decimal: LevelFormat.DECIMAL, "lower-alpha": LevelFormat.LOWER_LETTER, "upper-alpha": LevelFormat.UPPER_LETTER, "lower-roman": LevelFormat.LOWER_ROMAN, "upper-roman": LevelFormat.UPPER_ROMAN,
};
const indent = (level: number) => ({ paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } });
const typedBullets = (type: string) => Array.from({ length: 6 }, (_, level) => ({
  level, format: LevelFormat.BULLET, text: BULLET_CHARS[levelType("bullet", level, type)], alignment: AlignmentType.LEFT, style: indent(level),
}));
const typedNumbers = (type: string) => Array.from({ length: 6 }, (_, level) => ({
  level, format: LEVEL_FORMATS[levelType("number", level, type)], text: `%${level + 1}.`, alignment: AlignmentType.LEFT, style: indent(level),
}));
const numberingConfig = [
  ...ALL_BULLET_IDS.map((id) => ({ reference: `bullet-${id}`, levels: typedBullets(id) })),
  ...ALL_NUMBER_IDS.map((id) => ({ reference: `ordered-${id}`, levels: typedNumbers(id) })),
];

/** Header or footer part: the same blocks as the body (paragraphs, images, tables), page numbers as fields. */
function hfChildren(ctx: Ctx, c: HeaderFooterContent): Paragraph[] {
  const out = blocks(ctx, c.blocks as PM[]);
  return (out.length ? out : [new Paragraph("")]) as Paragraph[];
}

function wrappers(set: HeaderFooterSet, make: (c: HeaderFooterContent) => Header | Footer, titlePage: boolean, evenOdd: boolean) {
  const out: { default?: Header | Footer; first?: Header | Footer; even?: Header | Footer } = {};
  if (set.default) out.default = make(set.default);
  if (titlePage && set.first) out.first = make(set.first);
  if (evenOdd && set.even) out.even = make(set.even);
  return out;
}

/**
 * The watermark is Word's own: a VML WordArt shape named PowerPlusWaterMarkObject in the first paragraph of every header
 * (the docx library has no API for it, so it is added to the header parts after packing).
 */
async function addWatermark(bytes: Uint8Array, w: Watermark): Promise<Uint8Array> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);
  // Word stretches the text to the shape: keep it within the text width, with the same proportions.
  const natural = Math.max(60, Math.round(w.text.length * w.size * 0.6));
  const fit = Math.min(1, 460 / natural);
  const widthPt = Math.round(natural * fit);
  const heightPt = Math.round(w.size * 1.1 * fit);
  const style = (n: number) => `position:absolute;margin-left:0;margin-top:0;width:${widthPt}pt;height:${heightPt}pt;rotation:${w.layout === "diagonal" ? 315 : 0};z-index:-${251658240 + n};mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;mso-position-vertical-relative:margin`;
  const shapeType = '<v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136" adj="10800" path="m@7,l@8,m@5,21600l@6,21600e"><v:formulas><v:f eqn="sum #0 0 10800"/><v:f eqn="prod #0 2 1"/><v:f eqn="sum 21600 0 @1"/><v:f eqn="sum 0 0 @2"/><v:f eqn="sum 21600 0 @3"/><v:f eqn="if @0 @3 0"/><v:f eqn="if @0 21600 @1"/><v:f eqn="if @0 0 @2"/><v:f eqn="if @0 @4 21600"/><v:f eqn="mid @5 @6"/><v:f eqn="mid @8 @5"/><v:f eqn="mid @7 @8"/><v:f eqn="mid @6 @7"/><v:f eqn="sum @6 0 @5"/></v:formulas><v:path textpathok="t" o:connecttype="custom" o:connectlocs="@9,0;@10,10800;@11,21600;@12,10800" o:connectangles="270,180,90,0"/><v:textpath on="t" fitshape="t"/><v:handles><v:h position="#0,bottomRight" xrange="6629,14971"/></v:handles><o:lock v:ext="edit" text="t" shapetype="t"/></v:shapetype>';
  let n = 0;
  for (const name of Object.keys(zip.files).filter((f) => /^word\/header\d*\.xml$/.test(f))) {
    let xml = await zip.file(name)!.async("string");
    if (xml.includes("PowerPlusWaterMarkObject")) continue;
    n++;
    const text = w.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
    const run = `<w:r><w:rPr><w:noProof/></w:rPr><w:pict>${shapeType}<v:shape id="PowerPlusWaterMarkObject${n}" o:spid="_x0000_s${2048 + n}" type="#_x0000_t136" alt="loma-size:${w.size}" style="${style(n)}" o:allowincell="f" fillcolor="${w.color}" stroked="f"><v:fill opacity="${w.opacity}"/><v:textpath style="font-family:&quot;Calibri&quot;;font-size:1pt;font-weight:bold" string="${text}"/><w10:wrap anchorx="margin" anchory="margin"/></v:shape></w:pict></w:r>`;
    // Into the first paragraph (after its properties) so the header does not grow.
    const patched = xml.replace(/(<w:p(?: [^>]*)?>)(<w:pPr>[\s\S]*?<\/w:pPr>)?/, (_m, open, props) => `${open}${props ?? ""}${run}`);
    // The VML namespaces must be declared on the root.
    xml = patched.replace(/<w:hdr([^>]*)>/, (_m, attrs: string) => `<w:hdr${["xmlns:v=\"urn:schemas-microsoft-com:vml\"", "xmlns:o=\"urn:schemas-microsoft-com:office:office\"", "xmlns:w10=\"urn:schemas-microsoft-com:office:word\""].filter((d) => !attrs.includes(d.split("=")[0])).map((d) => " " + d).join("")}${attrs}>`);
    zip.file(name, xml);
  }
  return n ? zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }) : bytes;
}

/** `w:mirrorMargins` (facing pages) is a document setting the docx library does not write. */
async function addMirrorMargins(bytes: Uint8Array): Promise<Uint8Array> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);
  const file = zip.file("word/settings.xml");
  if (!file) return bytes;
  const xml = await file.async("string");
  if (xml.includes("w:mirrorMargins")) return bytes;
  // Schema order: after w:zoom (and before the compatibility settings).
  const patched = /<w:zoom[^>]*\/>/.test(xml) ? xml.replace(/(<w:zoom[^>]*\/>)/, "$1<w:mirrorMargins/>") : xml.replace(/(<w:settings[^>]*>)/, "$1<w:mirrorMargins/>");
  zip.file("word/settings.xml", patched);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

export async function exportDocx(model: DocumentModel): Promise<ExportResult> {
  const ctx: Ctx = { warnings: new Set(), raw: new RawXml(), shapeId: 1000, orderedInstances: 0, sources: cleanSources(model.content.attrs?.sources), citationStyle: isCitationStyle(model.content.attrs?.citationStyle) ? model.content.attrs.citationStyle : "apa", footnotes: {}, endnotes: [], hasToc: JSON.stringify(model.content).includes('"tableOfContents"'), headings: 0, tocTab: 9000, defaults: model.defaults ?? { fontFamily: "Calibri", fontSizePt: 11 } };
  const wm0 = cleanWatermark(model.watermark);
  const twips = (px: number) => Math.round(px * TWIPS_PER_PX);
  ctx.tocTab = twips(pageDimensions(model.page).w - marginsPx(model.page).left - marginsPx(model.page).right);
  /** Paper, margins and orientation of a section (`w:pgSz`, `w:pgMar`). */
  const pageProps = (page: PageSetup) => {
    const { w, h } = pageDimensions({ ...page, orientation: "portrait" });
    const base = baseMarginsCm(page);
    const gutter = gutterOf(page);
    // A binding margin at the top is folded into the top margin (the docx library only writes the left one).
    const m = { top: cmToPx(base.top + (gutter.pos === "top" ? gutter.cm : 0)), bottom: cmToPx(base.bottom), left: cmToPx(base.left), right: cmToPx(base.right) };
    return {
      size: { width: w * TWIPS_PER_PX, height: h * TWIPS_PER_PX, orientation: page.orientation === "landscape" ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
      margin: { top: twips(m.top), bottom: twips(m.bottom), left: twips(m.left), right: twips(m.right), ...(gutter.cm && gutter.pos === "left" ? { gutter: twips(cmToPx(gutter.cm)) } : {}) },
      // Page numbers of the section (`w:pgNumType`): format and restart.
      ...(page.numberFormat || page.numberStart !== undefined ? { pageNumbers: { ...(page.numberStart !== undefined ? { start: page.numberStart } : {}), ...(page.numberFormat ? { formatType: NUMBER_FORMATS[page.numberFormat] } : {}) } } : {}),
    };
  };
  // Sections: the first one is the document's own setup, every section break starts the next one (with its paper, margins and, when
  // it has its own, headers and footers: a section without any takes the previous ones, as in Word).
  const segments: Array<{ page: PageSetup; hf: HeaderFooterSettings | null; nodes: PM[]; continuous: boolean }> = [{ page: model.page, hf: model.headerFooter ?? null, nodes: [], continuous: false }];
  for (const n of model.content.content ?? []) {
    if (n.type === SECTION_BREAK) {
      const continuous = n.attrs?.kind === "continuous";
      const own = sanitizePage(n.attrs?.page as Partial<PageSetup>);
      const prev = segments[segments.length - 1];
      // A continuous section stays on the page of the previous one: same paper and margins, only the columns are its own.
      let page = own;
      if (continuous) { const { columns, ...rest } = prev.page; void columns; page = { ...rest, ...(own.columns ? { columns: own.columns } : {}) }; }
      segments.push({ page, hf: continuous || !n.attrs?.hf ? null : sanitizeHeaderFooter(n.attrs.hf), nodes: [], continuous });
    }
    else segments[segments.length - 1].nodes.push(n);
  }

  // The editable styles are written in full, so other editors show what Loma Writer shows.
  const def = ctx.defaults.fontFamily;
  const st = (id: StyleId) => resolveStyle(id, model.styles ?? {}, { fontFamily: def, sizePt: ctx.defaults.fontSizePt });
  const look = (id: StyleId, withFont = true) => {
    const s = st(id);
    return {
      run: { ...(withFont ? { font: s.fontFamily } : {}), size: Math.round(s.sizePt * 2), color: hex(s.color), bold: s.bold, italics: s.italic },
      paragraph: { alignment: ALIGN[s.align], spacing: { before: Math.round(s.spaceBefore * 20), after: Math.round(s.spaceAfter * 20), line: Math.round(s.lineHeight * 240), lineRule: "auto" as const } },
    };
  };
  const doc = new Document({
    creator: "Loma Writer",
    styles: {
      default: {
        document: { run: { font: ctx.defaults.fontFamily, size: Math.round(ctx.defaults.fontSizePt * 2), ...(model.styles?.normal ? { color: hex(st("normal").color) } : {}) }, ...(model.styles?.normal ? { paragraph: look("normal").paragraph } : {}) },
        heading1: look("h1", !!model.styles?.h1?.fontFamily),
        heading2: look("h2", !!model.styles?.h2?.fontFamily),
        heading3: look("h3", !!model.styles?.h3?.fontFamily),
      },
      characterStyles: [{ id: "EndnoteReference", name: "endnote reference", run: { superScript: true } }],
      paragraphStyles: [
        { id: "Quote", name: "Quote", basedOn: "Normal", ...look("quote", !!model.styles?.quote?.fontFamily), paragraph: { ...look("quote").paragraph, indent: { left: 720 }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: "2563EB", space: 10 } } } },
        { id: "Caption", name: "caption", basedOn: "Normal", next: "Normal", run: { italics: true, size: 18, color: "44546A" }, paragraph: { spacing: { before: 60, after: 160 } } },
        { id: "Bibliography", name: "Bibliography", basedOn: "Normal", next: "Normal", paragraph: { spacing: { after: 120 }, indent: { left: 480, hanging: 480 } } },
        { id: "EndnoteText", name: "endnote text", basedOn: "Normal", run: { size: 20 }, paragraph: { spacing: { after: 40 } } },
        { id: "TableofFigures", name: "table of figures", basedOn: "Normal", next: "Normal", paragraph: { spacing: { after: 60 } } },
        { id: "TOCHeading", name: "TOC Heading", basedOn: "Normal", next: "Normal", run: { bold: true, size: 32, color: "1D4ED8" }, paragraph: { spacing: { before: 120, after: 160 } } },
        { id: "TOC1", name: "toc 1", basedOn: "Normal", next: "Normal", run: { bold: true }, paragraph: { spacing: { after: 80 } } },
        { id: "TOC2", name: "toc 2", basedOn: "Normal", next: "Normal", paragraph: { spacing: { after: 60 }, indent: { left: 240 } } },
        { id: "TOC3", name: "toc 3", basedOn: "Normal", next: "Normal", paragraph: { spacing: { after: 60 }, indent: { left: 480 } } },
        { id: "CodeBlock", name: "Code", basedOn: "Normal", run: { ...look("code").run, font: st("code").fontFamily === "JetBrains Mono" ? "Courier New" : st("code").fontFamily }, paragraph: { ...look("code").paragraph, shading: { type: ShadingType.CLEAR, fill: "F3F4F6", color: "auto" } } },
      ],
    },
    ...(model.headerFooter?.evenOdd ? { evenAndOddHeaderAndFooters: true } : {}),
    numbering: { config: numberingConfig },
    footnotes: ctx.footnotes,
    sections: segments.map((seg, si) => {
      const hf = seg.hf;
      const children = blocks(ctx, seg.nodes);
      return {
        // A watermark lives in a header: one is created when the document has none.
        ...(si === 0 && wm0 && !(hf && hasContent(hf.header)) ? { headers: { default: new Header({ children: [new Paragraph("")] }) } } : {}),
        ...(hf && hasContent(hf.header) ? { headers: wrappers(hf.header, (c) => new Header({ children: hfChildren(ctx, c) }), hf.titlePage, hf.evenOdd) } : {}),
        ...(hf && hasContent(hf.footer) ? { footers: wrappers(hf.footer, (c) => new Footer({ children: hfChildren(ctx, c) }), hf.titlePage, hf.evenOdd) } : {}),
        properties: {
          type: seg.continuous ? SectionType.CONTINUOUS : SectionType.NEXT_PAGE,
          ...(seg.page.columns ? { column: { count: seg.page.columns.count, space: twips(cmToPx(seg.page.columns.gapCm)), equalWidth: true, separate: seg.page.columns.line } } : {}),
          ...(hf?.titlePage ? { titlePage: true } : {}),
          page: pageProps(seg.page),
        },
        children: children.length ? children : [new Paragraph("")],
      };
    }),
  });
  let bytes = await ctx.raw.apply(new Uint8Array(await Packer.toArrayBuffer(doc)));
  bytes = await addEndnotes(bytes, ctx.endnotes, cleanNotesOptions(model.content.attrs?.notes));
  bytes = await addSourcesPart(bytes, ctx.sources, ctx.citationStyle);
  if (isMirrored(model.page)) bytes = await addMirrorMargins(bytes);
  const wm = cleanWatermark(model.watermark);
  if (wm) bytes = await addWatermark(bytes, wm);
  return { bytes, warnings: [...ctx.warnings] };
}
