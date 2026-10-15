import { resolveStyle, type StyleId } from "../../editor/docStyles";
import { ALL_BULLET_IDS, ALL_NUMBER_IDS, BULLET_CHARS, levelType } from "./listFormats";
import { cleanListType } from "../../editor/ListTypes";
import {
  AlignmentType, Bookmark, BorderStyle, Document, ExternalHyperlink, Footer, Header, InternalHyperlink, PageNumber, HeadingLevel, ImageRun, LevelFormat, Packer, PageOrientation, Paragraph,
  PageBreak as DocxPageBreak, ShadingType, Table, TableCell, TableRow, TextRun, WidthType, type ParagraphChild,
} from "docx";
import { marginsPx, pageDimensions } from "../../state/types";
import { imageSize, parseDataUri } from "./xml";
import type { PM, Mark } from "./pm";
import { RawXml } from "./docxPost";
import { groupRunXml, shapeRunXml } from "./docxShapes";
import { latexToMathml, parseMathml } from "../math/mathml";
import { mathmlElementToOmml } from "../math/omml";
import { hasContent, type HeaderFooterContent, type HeaderFooterSet } from "../../pagination/headerFooter";
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

function inline(ctx: Ctx, nodes: PM[] = []): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const n of nodes) {
    if (n.type === "hardBreak") out.push(new TextRun({ break: 1 }));
    else if (n.type === "pageField") out.push(new TextRun({ children: [n.attrs?.kind === "pages" ? PageNumber.TOTAL_PAGES : PageNumber.CURRENT] }));
    else if (n.type === "bookmark") out.push(new Bookmark({ id: String(n.attrs?.name ?? "signet"), children: [] }));
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
  return new ImageRun({ type, data: data.bytes, transformation: { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) }, altText: { name: "image", description: String(n.attrs?.alt ?? ""), title: "image" } });
}

type ListCtx = { ref: string; level: number; instance: number } | null;

function paragraphFor(ctx: Ctx, n: PM, extra: Record<string, unknown> = {}, list: ListCtx = null, lead: ParagraphChild[] = []): Paragraph {
  const line = lineHeightOf(n.content ?? []);
  const shading = n.attrs?.shading ? { type: ShadingType.CLEAR, fill: hex(String(n.attrs.shading)), color: "auto" } : undefined;
  const b = n.attrs?.borders as { top?: boolean; right?: boolean; bottom?: boolean; left?: boolean } | null | undefined;
  const side = { style: BorderStyle.SINGLE, size: 6, color: "6B7280", space: 4 };
  const border = b ? { ...(b.top ? { top: side } : {}), ...(b.right ? { right: side } : {}), ...(b.bottom ? { bottom: side } : {}), ...(b.left ? { left: side } : {}) } : undefined;
  return new Paragraph({
    children: [...lead, ...inline(ctx, n.content)],
    ...(n.attrs?.textAlign && n.attrs.textAlign !== "left" ? { alignment: ALIGN[String(n.attrs.textAlign)] } : {}),
    ...(shading ? { shading } : {}),
    ...(border && Object.keys(border).length ? { border } : {}),
    ...(line ? { spacing: { line, lineRule: "auto" as const } } : {}),
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
      case "paragraph": case "heading": out.push(paragraphFor(ctx, n, {}, null, takeAnchored())); break;
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
    }
  }
  flushAnchored();
  return out;
}

function table(ctx: Ctx, n: PM): Table {
  const cols = Math.max(1, ...((n.content ?? []).map((r) => (r.content ?? []).reduce((s, c) => s + +(c.attrs?.colspan ?? 1), 0))));
  const first = n.content?.[0]?.content ?? [];
  const known = first.length === cols && first.every((c) => Array.isArray(c.attrs?.colwidth));
  const widths = known ? first.map((c) => (c.attrs!.colwidth as number[]).reduce((a, b) => a + b, 0) * TWIPS_PER_PX) : Array(cols).fill(Math.floor((9000) / cols));
  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths,
    rows: (n.content ?? []).map(
      (row) =>
        new TableRow({
          tableHeader: row.content?.every((c) => c.type === "tableHeader") || undefined,
          children: (row.content ?? []).map((cell) => {
            const span = +(cell.attrs?.colspan ?? 1);
            const body = blocks(ctx, cell.content);
            return new TableCell({
              columnSpan: span > 1 ? span : undefined,
              rowSpan: +(cell.attrs?.rowspan ?? 1) > 1 ? +(cell.attrs!.rowspan as number) : undefined,
              children: (body.length ? body : [new Paragraph("")]) as Paragraph[],
              // Header cells carry a default grey; an explicit shading replaces it.
              ...(cell.attrs?.shading || cell.type === "tableHeader" ? { shading: { type: ShadingType.CLEAR, fill: cell.attrs?.shading ? hex(String(cell.attrs.shading)) : "F3F4F6", color: "auto" } } : {}),
              borders: Object.fromEntries(["top", "bottom", "left", "right"].map((s) => [s, cell.attrs?.borderless ? { style: BorderStyle.NONE, size: 0, color: "auto" } : { style: BorderStyle.SINGLE, size: 4, color: "D1D5DB" }])),
            });
          }),
        }),
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

export async function exportDocx(model: DocumentModel): Promise<ExportResult> {
  const ctx: Ctx = { warnings: new Set(), raw: new RawXml(), shapeId: 1000, orderedInstances: 0, defaults: model.defaults ?? { fontFamily: "Calibri", fontSizePt: 11 } };
  const children = blocks(ctx, model.content.content);
  const { w, h } = pageDimensions({ ...model.page, orientation: "portrait" });
  const m = marginsPx(model.page);
  const twips = (px: number) => Math.round(px * TWIPS_PER_PX);

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
      paragraphStyles: [
        { id: "Quote", name: "Quote", basedOn: "Normal", ...look("quote", !!model.styles?.quote?.fontFamily), paragraph: { ...look("quote").paragraph, indent: { left: 720 }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: "2563EB", space: 10 } } } },
        { id: "CodeBlock", name: "Code", basedOn: "Normal", run: { ...look("code").run, font: st("code").fontFamily === "JetBrains Mono" ? "Courier New" : st("code").fontFamily }, paragraph: { ...look("code").paragraph, shading: { type: ShadingType.CLEAR, fill: "F3F4F6", color: "auto" } } },
      ],
    },
    ...(model.headerFooter?.evenOdd ? { evenAndOddHeaderAndFooters: true } : {}),
    numbering: { config: numberingConfig },
    sections: [
      {
        ...(model.headerFooter && hasContent(model.headerFooter.header) ? { headers: wrappers(model.headerFooter.header, (c) => new Header({ children: hfChildren(ctx, c) }), model.headerFooter.titlePage, model.headerFooter.evenOdd) } : {}),
        ...(model.headerFooter && hasContent(model.headerFooter.footer) ? { footers: wrappers(model.headerFooter.footer, (c) => new Footer({ children: hfChildren(ctx, c) }), model.headerFooter.titlePage, model.headerFooter.evenOdd) } : {}),
        properties: {
          ...(model.headerFooter?.titlePage ? { titlePage: true } : {}),
          page: {
            size: { width: w * TWIPS_PER_PX, height: h * TWIPS_PER_PX, orientation: model.page.orientation === "landscape" ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
            margin: { top: twips(m.top), bottom: twips(m.bottom), left: twips(m.left), right: twips(m.right) },
          },
        },
        children: children.length ? children : [new Paragraph("")],
      },
    ],
  });
  const bytes = await ctx.raw.apply(new Uint8Array(await Packer.toArrayBuffer(doc)));
  return { bytes, warnings: [...ctx.warnings] };
}
