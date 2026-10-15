import { builtinStyle, cleanStyles, STYLE_IDS, type DocStyles, type StyleDef as EditedStyle, type StyleId } from "../../editor/docStyles";
import { bulletFromChar, numberFromFormat } from "./listFormats";
import JSZip from "jszip";
import { pageFromDimensions } from "./page";
import { mathmlOrOmmlLatex } from "./mathImport";
import { ListBuilder, ensureBlocks, hasVisibleContent, heading, mergeText, paragraph, splitEquations, textNode, type PM, type RunProps } from "./pm";
import { corrupt, DocumentError, type ImportResult } from "./types";
import { attr, child, first, kids, mimeForPath, parseXml, toDataUri } from "./xml";
import { DEFAULT_SHAPE_STYLE, isKnownShape, NONE, TEXT_BOX } from "../../editor/shapes/catalog";
import type { Gradient, Shadow } from "../../editor/shapes/types";
import { sanitizeHeaderFooter, type HeaderFooterSet, type HeaderFooterSettings } from "../../pagination/headerFooter";

const HIGHLIGHTS: Record<string, string> = {
  yellow: "#ffff00", green: "#00ff00", cyan: "#00ffff", magenta: "#ff00ff", blue: "#0000ff", red: "#ff0000",
  darkBlue: "#00008b", darkCyan: "#008b8b", darkGreen: "#006400", darkMagenta: "#8b008b", darkRed: "#8b0000",
  darkYellow: "#808000", darkGray: "#a9a9a9", lightGray: "#d3d3d3", black: "#000000",
};

interface StyleDef {
  name: string;
  basedOn: string | null;
  isDefault: boolean;
  rPr: Element | null;
  pPr: Element | null;
}

type Kind =
  | { kind: "normal" }
  | { kind: "heading"; level: number }
  | { kind: "quote" }
  | { kind: "code" };

interface Ctx {
  zip: JSZip;
  styles: Map<string, StyleDef>;
  /** numId -> bullet or ordered, from numbering.xml */
  numbering: Map<string, { type: "bulletList" | "orderedList"; listType: string | null }>;
  rels: Map<string, { target: string; external: boolean }>;
  warnings: Set<string>;
  /** True while reading a header/footer: page-number fields become nodes. */
  fields?: boolean;
  images: Map<string, string>;
  /** `w:pPrDefault` of styles.xml: paragraph defaults under every style. */
  docPPr?: Element | null;
  /** Default font of the document (`w:rPrDefault`). */
  docFont?: string | null;
}

const on = (el: Element | null): boolean => {
  if (!el) return false;
  const v = el.getAttribute("w:val");
  return v === null || !["0", "false", "off", "none"].includes(v);
};

function readRun(rPr: Element | null): RunProps {
  const p: RunProps = {};
  if (!rPr) return p;
  for (const e of kids(rPr)) {
    const v = e.getAttribute("w:val");
    switch (e.nodeName) {
      case "w:b": p.bold = on(e); break;
      case "w:i": p.italic = on(e); break;
      case "w:u": p.underline = on(e); break;
      case "w:strike": case "w:dstrike": p.strike = on(e); break;
      case "w:vertAlign": p.sup = v === "superscript"; p.sub = v === "subscript"; break;
      case "w:color": if (v && v !== "auto" && /^[0-9a-f]{6}$/i.test(v)) p.color = `#${v.toLowerCase()}`; break;
      case "w:sz": if (v && +v > 0) p.sizePt = +v / 2; break;
      case "w:rFonts": { const f = e.getAttribute("w:ascii") ?? e.getAttribute("w:hAnsi"); if (f) p.font = f; break; }
      case "w:highlight": if (v && HIGHLIGHTS[v]) p.highlight = HIGHLIGHTS[v]; break;
      case "w:shd": { const f = e.getAttribute("w:fill"); if (f && f !== "auto" && /^[0-9a-f]{6}$/i.test(f)) p.highlight = `#${f.toLowerCase()}`; break; }
    }
  }
  return p;
}

const merge = (base: RunProps, over: RunProps): RunProps => {
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
};

function parseStyles(zip: JSZip, xml: string | null): Map<string, StyleDef> {
  const map = new Map<string, StyleDef>();
  if (!xml) return map;
  for (const s of Array.from(parseXml(xml, "styles.xml").getElementsByTagName("w:style"))) {
    const id = s.getAttribute("w:styleId");
    if (!id || s.getAttribute("w:type") !== "paragraph" && s.getAttribute("w:type") !== "character") continue;
    map.set(id, {
      name: (attr(child(s, "w:name"), "w:val") ?? id).toLowerCase(),
      basedOn: attr(child(s, "w:basedOn"), "w:val"),
      isDefault: s.getAttribute("w:default") === "1",
      rPr: child(s, "w:rPr"),
      pPr: child(s, "w:pPr"),
    });
  }
  void zip;
  return map;
}

function parseNumbering(xml: string | null): Map<string, { type: "bulletList" | "orderedList"; listType: string | null }> {
  const out = new Map<string, { type: "bulletList" | "orderedList"; listType: string | null }>();
  if (!xml) return out;
  const doc = parseXml(xml, "numbering.xml");
  const abstracts = new Map<string, { type: "bulletList" | "orderedList"; listType: string | null }>();
  for (const a of Array.from(doc.getElementsByTagName("w:abstractNum"))) {
    const lvl0 = kids(a).find((k) => k.nodeName === "w:lvl");
    const fmt = attr(lvl0 ? child(lvl0, "w:numFmt") : null, "w:val");
    const bullet = fmt === "bullet" || fmt === "none";
    abstracts.set(a.getAttribute("w:abstractNumId") ?? "", bullet
      ? { type: "bulletList", listType: bulletFromChar(attr(lvl0 ? child(lvl0, "w:lvlText") : null, "w:val")) }
      : { type: "orderedList", listType: numberFromFormat(fmt, "docx") });
  }
  for (const n of Array.from(doc.getElementsByTagName("w:num"))) {
    const abs = attr(child(n, "w:abstractNumId"), "w:val") ?? "";
    out.set(n.getAttribute("w:numId") ?? "", abstracts.get(abs) ?? { type: "bulletList", listType: null });
  }
  return out;
}

function parseRels(xml: string | null): Map<string, { target: string; external: boolean }> {
  const out = new Map<string, { target: string; external: boolean }>();
  if (!xml) return out;
  for (const r of Array.from(parseXml(xml, "document.xml.rels").getElementsByTagName("Relationship")))
    out.set(r.getAttribute("Id") ?? "", { target: r.getAttribute("Target") ?? "", external: r.getAttribute("TargetMode") === "External" });
  return out;
}

function styleChain(ctx: Ctx, id: string | null): StyleDef[] {
  const chain: StyleDef[] = [];
  for (let cur = id, guard = 0; cur && guard < 12; guard++) {
    const s = ctx.styles.get(cur);
    if (!s) break;
    chain.unshift(s);
    cur = s.basedOn;
  }
  return chain;
}

/** The editable styles (Normal, headings, quote, code) as defined in the file, minus what equals the built-in look. */
function readDocStyles(ctx: Ctx): DocStyles {
  const ids: Record<StyleId, RegExp> = {
    normal: /^(normal|standard|par défaut)$/, h1: /^(?:heading|titre|überschrift)\s*1$/, h2: /^(?:heading|titre|überschrift)\s*2$/, h3: /^(?:heading|titre|überschrift)\s*3$/,
    quote: /^(quote|citation)$/, code: /^(code|source code|preformatted text|html preformatted)$/,
  };
  const out: DocStyles = {};
  for (const id of STYLE_IDS) {
    const found = [...ctx.styles.entries()].find(([, s]) => ids[id].test(s.name) || (id === "normal" && s.isDefault));
    if (!found) continue;
    const chain = styleChain(ctx, found[0]);
    // Under Normal sit the document defaults (that is where Loma Writer writes its paragraph spacing).
    const dpp = ctx.docPPr ? child(ctx.docPPr, "w:pPr") : null;
    if (dpp) chain.unshift({ name: "", basedOn: null, isDefault: false, rPr: null, pPr: dpp });
    const run = chain.reduce<RunProps>((acc, s) => merge(acc, readRun(s.rPr)), {});
    const read = (name: string, a: string) => { for (const s of [...chain].reverse()) { const v = s.pPr ? child(s.pPr, name)?.getAttribute(a) : null; if (v) return v; } return null; };
    const jc = read("w:jc", "w:val");
    const before = read("w:spacing", "w:before"), after = read("w:spacing", "w:after"), line = read("w:spacing", "w:line");
    const lineAuto = (() => { for (const s of [...chain].reverse()) { const sp = s.pPr ? child(s.pPr, "w:spacing") : null; if (sp?.getAttribute("w:line")) return (sp.getAttribute("w:lineRule") ?? "auto") === "auto"; } return false; })();
    const raw: EditedStyle = {
      ...(id !== "normal" && run.font && run.font !== ctx.docFont && !(id === "code" && /mono|courier|consolas/i.test(run.font)) ? { fontFamily: run.font } : {}),
      ...(id !== "normal" && run.sizePt ? { sizePt: run.sizePt } : {}),
      ...(run.color ? { color: run.color } : {}),
      ...(run.bold !== undefined ? { bold: run.bold } : {}),
      ...(run.italic !== undefined ? { italic: run.italic } : {}),
      ...(jc === "center" || jc === "right" ? { align: jc } : jc === "both" ? { align: "justify" as const } : {}),
      ...(before !== null ? { spaceBefore: +before / 20 } : {}),
      ...(after !== null ? { spaceAfter: +after / 20 } : {}),
      ...(line && lineAuto && +line > 0 ? { lineHeight: +line / 240 } : {}),
    };
    const base = builtinStyle(id, { fontFamily: "", sizePt: 11 }) as Record<string, unknown>;
    const diff = Object.fromEntries(Object.entries(raw).filter(([k, v]) => k === "fontFamily" || (typeof v === "number" ? Math.abs(v - (base[k] as number)) > 0.25 : v !== base[k])));
    if (Object.keys(diff).length) out[id] = diff;
  }
  return cleanStyles(out);
}

function kindOfStyle(ctx: Ctx, id: string | null): Kind {
  for (const s of [...styleChain(ctx, id)].reverse()) {
    const h = /^(?:heading|titre|überschrift)\s*(\d)$/.exec(s.name);
    if (h) return { kind: "heading", level: Math.min(3, +h[1]) };
    if (s.name === "title") return { kind: "heading", level: 1 };
    if (["quote", "intense quote", "citation", "block text"].includes(s.name)) return { kind: "quote" };
    if (["code", "source code", "preformatted text", "html preformatted", "texte préformaté"].includes(s.name)) return { kind: "code" };
  }
  return { kind: "normal" };
}

/** Run properties coming from non-default named styles (the document default style is left out on purpose). */
function styleRun(ctx: Ctx, id: string | null, kind: Kind): RunProps {
  if (kind.kind !== "normal") return {};
  return styleChain(ctx, id).filter((s) => !s.isDefault).reduce((acc, s) => merge(acc, readRun(s.rPr)), {} as RunProps);
}

function imageFromDrawing(ctx: Ctx, drawing: Element): PM | null {
  if (first(drawing, "wp:anchor")) ctx.warnings.add("Images flottantes : le positionnement n'est pas conservé, elles sont placées dans le texte.");
  const blip = first(drawing, "a:blip");
  const embed = blip?.getAttribute("r:embed");
  if (!embed) {
    ctx.warnings.add("Une image liée à un fichier externe n'a pas pu être importée.");
    return null;
  }
  const rel = ctx.rels.get(embed);
  if (!rel) return null;
  const path = rel.target.startsWith("/") ? rel.target.slice(1) : `word/${rel.target}`;
  const src = ctx.images.get(path);
  if (!src) {
    ctx.warnings.add("Une image du document est introuvable dans le fichier.");
    return null;
  }
  const extent = first(drawing, "wp:extent");
  const cx = +(extent?.getAttribute("cx") ?? 0);
  const cy = +(extent?.getAttribute("cy") ?? 0);
  const alt = first(drawing, "wp:docPr")?.getAttribute("descr") ?? undefined;
  return { type: "image", attrs: { src, ...(alt ? { alt } : {}), ...(cx ? { width: Math.round(cx / 9525), height: Math.round(cy / 9525) } : {}) } };
}

const EMU_PX = 9525;

/** Placement as written in the file, resolved once the page geometry is known (see `resolvePlacements`). */
interface RawPlacement {
  hRel: string;
  hOff: number | null;
  hAlign: string | null;
  vRel: string;
  vOff: number | null;
  vAlign: string | null;
  relativeHeight: number;
}

function readRawPlacement(anchor: Element): RawPlacement {
  const axis = (tag: string) => {
    const el = child(anchor, tag);
    const off = el ? child(el, "wp:posOffset") : null;
    const al = el ? child(el, "wp:align") : null;
    return { rel: el?.getAttribute("relativeFrom") ?? "page", off: off ? +(off.textContent ?? 0) / EMU_PX : null, align: al?.textContent?.trim() ?? null };
  };
  const h = axis("wp:positionH");
  const v = axis("wp:positionV");
  return { hRel: h.rel, hOff: h.off, hAlign: h.align, vRel: v.rel, vOff: v.off, vAlign: v.align, relativeHeight: +(anchor.getAttribute("relativeHeight") ?? 0) };
}

const colorOf = (holder: Element | null): string | null | undefined => {
  if (!holder) return undefined;
  if (child(holder, "a:noFill")) return null;
  const solid = child(holder, "a:solidFill");
  const rgb = attr(solid ? child(solid, "a:srgbClr") : null, "val");
  return rgb && /^[0-9a-f]{6}$/i.test(rgb) ? `#${rgb.toLowerCase()}` : undefined;
};

function gradientOf(spPr: Element | null): Gradient | null {
  const g = spPr ? child(spPr, "a:gradFill") : null;
  if (!g) return null;
  const stops = kids(child(g, "a:gsLst") ?? g)
    .filter((k) => k.nodeName === "a:gs")
    .map((gs) => ({ pos: +(gs.getAttribute("pos") ?? 0) / 1000, color: attr(child(gs, "a:srgbClr"), "val") }))
    .filter((s): s is { pos: number; color: string } => !!s.color && /^[0-9a-f]{6}$/i.test(s.color))
    .map((s) => ({ pos: s.pos, color: `#${s.color.toLowerCase()}` }));
  if (stops.length < 2) return null;
  return child(g, "a:path") ? { type: "radial", angle: 0, stops } : { type: "linear", angle: +(attr(child(g, "a:lin"), "ang") ?? 5400000) / 60000, stops };
}

function shadowOf(spPr: Element | null): Shadow | null {
  const sh = spPr ? child(child(spPr, "a:effectLst") ?? spPr, "a:outerShdw") : null;
  if (!sh) return null;
  const rgb = attr(child(sh, "a:srgbClr"), "val");
  if (!rgb || !/^[0-9a-f]{6}$/i.test(rgb)) return null;
  const alpha = attr(child(child(sh, "a:srgbClr")!, "a:alpha"), "val");
  const dist = +(sh.getAttribute("dist") ?? 0) / EMU_PX;
  const dir = (+(sh.getAttribute("dir") ?? 0) / 60000) * (Math.PI / 180);
  return { color: `#${rgb.toLowerCase()}`, opacity: alpha ? +alpha / 100000 : 1, blur: +(sh.getAttribute("blurRad") ?? 0) / EMU_PX, dx: Math.round(Math.cos(dir) * dist), dy: Math.round(Math.sin(dir) * dist) };
}

/** Everything about one `wps:wsp` except its place in the page: geometry, colours, effects and text. */
function parseWsp(ctx: Ctx, wsp: Element): { attrs: Record<string, unknown>; content: PM[]; width: number; height: number; x: number; y: number } {
  const spPr = child(wsp, "wps:spPr");
  const isBox = child(wsp, "wps:cNvSpPr")?.getAttribute("txBox") === "1";
  const xfrm = spPr ? child(spPr, "a:xfrm") : null;
  const ext = xfrm ? child(xfrm, "a:ext") : null;
  const off = xfrm ? child(xfrm, "a:off") : null;
  const prst = attr(spPr ? child(spPr, "a:prstGeom") : null, "prst") ?? "rect";
  let kind = isBox ? TEXT_BOX : prst;
  if (!isBox && !isKnownShape(prst)) {
    ctx.warnings.add(`Forme « ${prst} » non prise en charge : remplacée par un rectangle.`);
    kind = "rect";
  }
  const themed = !!child(wsp, "wps:style");
  const gradient = gradientOf(spPr);
  const fillC = colorOf(spPr);
  const ln = spPr ? child(spPr, "a:ln") : null;
  const lineC = colorOf(ln);
  const lineW = ln?.getAttribute("w") ? Math.round(Math.max(0.5, +(ln.getAttribute("w") as string) / EMU_PX) * 10) / 10 : undefined;
  const base = isBox ? { fill: "#ffffff", stroke: "#6b7280", strokeWidth: 1 } : DEFAULT_SHAPE_STYLE;
  const attrs: Record<string, unknown> = {
    kind,
    fill: gradient ? gradient.stops[0].color : fillC === null ? NONE : fillC ?? (themed ? "#4472c4" : NONE),
    stroke: lineC === null ? NONE : lineC ?? (themed ? "#2f528f" : NONE),
    strokeWidth: lineW ?? (themed ? 1 : base.strokeWidth),
    gradient,
    shadow: shadowOf(spPr),
    rotation: xfrm?.getAttribute("rot") ? +(xfrm.getAttribute("rot") as string) / 60000 : 0,
  };
  // Text: paragraphs of the text box, headings and lists flattened to paragraphs.
  const txbx = child(wsp, "wps:txbx");
  const root = txbx ? child(txbx, "w:txbxContent") : null;
  const defaultAlign = isBox ? "left" : "center";
  const paragraphs: PM[] = [];
  const collect = (n: PM) => {
    if (n.type === "paragraph" || n.type === "heading") {
      const a = { ...(n.attrs ?? {}) } as Record<string, unknown>;
      delete a.level;
      if (a.textAlign === defaultAlign) delete a.textAlign;
      paragraphs.push({ type: "paragraph", ...(Object.keys(a).length ? { attrs: a } : {}), ...(n.content?.length ? { content: n.content.filter((c) => c.type === "text" || c.type === "hardBreak") } : {}) });
    } else (n.content ?? []).forEach(collect);
  };
  if (root) {
    const converted = convertBlocks(ctx, root);
    converted.forEach(collect);
    if (converted.some((b) => b.type === "table")) ctx.warnings.add("Tableaux dans une zone de texte : non pris en charge, ignorés.");
  }
  return {
    attrs,
    content: kind === "line" ? [] : paragraphs.length ? paragraphs : [{ type: "paragraph" }],
    width: ext ? Math.round(+(ext.getAttribute("cx") ?? 0) / EMU_PX) : 0,
    height: ext ? Math.round(+(ext.getAttribute("cy") ?? 0) / EMU_PX) : 0,
    x: off ? +(off.getAttribute("x") ?? 0) / EMU_PX : 0,
    y: off ? +(off.getAttribute("y") ?? 0) / EMU_PX : 0,
  };
}

/** A DrawingML shape, text box or group as a node. Free placement is kept; it is resolved once the page is known. */
function shapeFromDrawing(ctx: Ctx, drawing: Element): PM | null {
  const wsp = first(drawing, "wps:wsp");
  const grp = first(drawing, "wpg:wgp");
  if (!wsp && !grp) return null;
  const extent = first(drawing, "wp:extent");
  const anchor = child(drawing, "wp:anchor");
  const docPr = first(drawing, "wp:docPr");
  let wrap: string = "inline";
  let raw: RawPlacement | null = null;
  if (anchor) {
    raw = readRawPlacement(anchor);
    const names = kids(anchor).map((k) => k.nodeName);
    if (names.includes("wp:wrapTopAndBottom")) wrap = "topBottom";
    else if (names.some((n) => ["wp:wrapSquare", "wp:wrapTight", "wp:wrapThrough"].includes(n))) wrap = "square";
    else wrap = anchor.getAttribute("behindDoc") === "1" ? "behind" : "front";
  }
  const width = Math.round(+(extent?.getAttribute("cx") ?? 0) / EMU_PX);
  const height = Math.round(+(extent?.getAttribute("cy") ?? 0) / EMU_PX);
  const place = { wrap, width, height, alt: docPr?.getAttribute("descr") ?? "", _raw: raw };

  if (wsp && !grp) {
    const p = parseWsp(ctx, wsp);
    return { type: "shape", attrs: { ...p.attrs, ...place, width: width || p.width || 160, height: height || p.height || 100, align: "left" }, content: p.content };
  }
  // Group: children live in the group's own coordinates (chOff/chExt), scaled to its real size.
  const gx = first(grp!, "wpg:grpSpPr") ? child(child(first(grp!, "wpg:grpSpPr")!, "a:xfrm") ?? grp!, "a:ext") : null;
  const cx = child(child(first(grp!, "wpg:grpSpPr")!, "a:xfrm") ?? grp!, "a:chExt");
  const co = child(child(first(grp!, "wpg:grpSpPr")!, "a:xfrm") ?? grp!, "a:chOff");
  const chW = +(cx?.getAttribute("cx") ?? gx?.getAttribute("cx") ?? 1) || 1;
  const chH = +(cx?.getAttribute("cy") ?? gx?.getAttribute("cy") ?? 1) || 1;
  const gw = width || Math.round(+(gx?.getAttribute("cx") ?? 0) / EMU_PX);
  const gh = height || Math.round(+(gx?.getAttribute("cy") ?? 0) / EMU_PX);
  const [sx, sy] = [(gw * EMU_PX) / chW, (gh * EMU_PX) / chH];
  const members: PM[] = [];
  const visit = (g: Element) => {
    for (const k of kids(g)) {
      if (k.nodeName === "wps:wsp") {
        const p = parseWsp(ctx, k);
        members.push({
          type: "shape",
          attrs: { ...p.attrs, wrap: "group", width: Math.max(8, Math.round((p.width * sx) / 1)), height: Math.max(8, Math.round((p.height * sy) / 1)), x: Math.round(((p.x * EMU_PX - +(co?.getAttribute("x") ?? 0)) * sx) / EMU_PX), y: Math.round(((p.y * EMU_PX - +(co?.getAttribute("y") ?? 0)) * sy) / EMU_PX), anchor: "paragraph", z: 0, align: "left", alt: "" },
          content: p.content,
        });
      } else if (k.nodeName === "wpg:grpSp") visit(k);
      else if (k.nodeName === "pic:pic" || k.nodeName === "wpg:graphicFrame") ctx.warnings.add("Images et objets dans un groupe de formes : ignorés.");
    }
  };
  visit(grp!);
  if (!members.length) return null;
  const rot = child(first(grp!, "wpg:grpSpPr")!, "a:xfrm")?.getAttribute("rot");
  return { type: "shapeGroup", attrs: { ...place, wrap: wrap === "inline" ? "inline" : wrap, width: gw, height: gh, rotation: rot ? +rot / 60000 : 0, align: "left" }, content: members };
}

/**
 * Turns Word's anchors (relative to page, margin, column, paragraph… with offsets or alignments) into our two
 * kinds of origin (page or paragraph) now that the page size and margins are known, and ranks the stacking order.
 */
export function resolvePlacements(blocks: PM[], pageW: number, margins: { top: number; left: number; right: number }): void {
  const contentW = pageW - margins.left - margins.right;
  const ranked: Array<{ node: PM; rh: number }> = [];
  const place = (node: PM) => {
    const a = node.attrs as Record<string, unknown> & { _raw?: RawPlacement | null };
    const raw = a._raw;
    delete a._raw;
    if (!raw) return;
    const w = Number(a.width) || 0;
    const h = Number(a.height) || 0;
    const xIn = (rel: string) => (rel === "page" ? pageW : contentW);
    let x = raw.hOff ?? (raw.hAlign === "center" ? (xIn(raw.hRel) - w) / 2 : raw.hAlign === "right" ? xIn(raw.hRel) - w : 0);
    let y = raw.vOff ?? (raw.vAlign === "center" ? 0 : 0);
    void h;
    const hPage = raw.hRel === "page";
    const vParagraph = raw.vRel === "paragraph" || raw.vRel === "line";
    if (vParagraph) {
      a.anchor = "paragraph";
      if (hPage) x -= margins.left; // from the page edge to the text edge
    } else {
      a.anchor = "page";
      if (!hPage) x += margins.left;
      if (raw.vRel !== "page") y += margins.top; // margin, top margin…
    }
    if (a.wrap === "square" || a.wrap === "topBottom") {
      // These follow the paragraph: only a horizontal offset and a small vertical one make sense.
      if (a.anchor === "page") { x -= margins.left; y = 0; a.anchor = "paragraph"; }
    }
    a.x = Math.round(x);
    a.y = Math.round(y);
    if (a.wrap === "front" || a.wrap === "behind") ranked.push({ node, rh: raw.relativeHeight });
  };
  for (const b of blocks) if (b.type === "shape" || b.type === "shapeGroup") place(b);
  for (const layer of ["front", "behind"]) {
    const inLayer = ranked.filter((r) => r.node.attrs!.wrap === layer).sort((p, q) => p.rh - q.rh);
    // Files written by Loma Writer encode z in relativeHeight; for any other writer only the order matters.
    const ours = inLayer.every((r) => r.rh >= 251658240 && (r.rh - 251658240) % 1024 === 0 && (r.rh - 251658240) / 1024 <= 100);
    inLayer.forEach((r, i) => { r.node.attrs!.z = ours ? (r.rh - 251658240) / 1024 - 50 : i; });
  }
}

interface FieldState {
  state: "instr" | "result" | null;
  instr: string;
  /** The field result is replaced by a node, so its text is skipped. */
  skip: boolean;
}

const pageFieldKind = (instr: string): "page" | "pages" | null => (/NUMPAGES/i.test(instr) ? "pages" : /\bPAGE\b/i.test(instr) ? "page" : null);

function convertRuns(ctx: Ctx, parent: Element, base: RunProps, out: PM[], fs: FieldState = { state: null, instr: "", skip: false }) {
  for (const node of kids(parent)) {
    switch (node.nodeName) {
      case "w:r": {
        const props = merge(base, readRun(child(node, "w:rPr")));
        // Character style on the run (e.g. "Strong", "Hyperlink").
        const rs = attr(child(child(node, "w:rPr") ?? node, "w:rStyle"), "w:val");
        const merged = rs ? merge(merge({}, readRun(ctx.styles.get(rs)?.rPr ?? null)), props) : props;
        for (const c of kids(node)) {
          switch (c.nodeName) {
            case "w:fldChar":
              if (ctx.fields) {
                const t = c.getAttribute("w:fldCharType");
                if (t === "begin") { fs.state = "instr"; fs.instr = ""; fs.skip = false; }
                else if (t === "separate") {
                  const kind = pageFieldKind(fs.instr);
                  if (kind) { out.push({ type: "pageField", attrs: { kind } }); fs.skip = true; }
                  fs.state = "result";
                } else if (t === "end") { fs.state = null; fs.skip = false; }
              }
              break;
            case "w:instrText": if (ctx.fields && fs.state === "instr") fs.instr += c.textContent ?? ""; break;
            case "w:t": if (c.textContent && !(fs.skip && fs.state === "result") && fs.state !== "instr") out.push(textNode(c.textContent, merged)); break;
            case "w:tab": out.push(textNode("\t", merged)); break;
            case "w:noBreakHyphen": out.push(textNode("-", merged)); break;
            case "w:br":
            case "w:cr":
              if (c.getAttribute("w:type") === "page") out.push({ type: "pageBreak" });
              else out.push({ type: "hardBreak" });
              break;
            case "w:drawing": { const node2 = shapeFromDrawing(ctx, c) ?? imageFromDrawing(ctx, c); if (node2) out.push(node2); break; }
            case "mc:AlternateContent": {
              // Word writes modern shapes inside Choice (with a legacy VML Fallback that is ignored).
              const choice = kids(c).find((k) => k.nodeName === "mc:Choice");
              const drawing = choice ? kids(choice).find((k) => k.nodeName === "w:drawing") : null;
              const node2 = drawing ? shapeFromDrawing(ctx, drawing) ?? imageFromDrawing(ctx, drawing) : null;
              if (node2) out.push(node2); else ctx.warnings.add("Formes, zones de texte ou objets incorporés : ignorés.");
              break;
            }
            case "w:pict": ctx.warnings.add("Formes, zones de texte ou objets incorporés : ignorés."); break;
            case "w:footnoteReference": case "w:endnoteReference": ctx.warnings.add("Notes de bas de page et de fin : non prises en charge, ignorées."); break;
            case "w:commentReference": ctx.warnings.add("Commentaires : non pris en charge, ignorés."); break;
          }
        }
        break;
      }
      case "w:hyperlink": {
        const rid = node.getAttribute("r:id");
        const anchor = node.getAttribute("w:anchor");
        const href = anchor ? `#${encodeURIComponent(anchor)}` : rid ? ctx.rels.get(rid)?.target : null;
        convertRuns(ctx, node, href ? { ...base, link: href } : base, out, fs);
        break;
      }
      case "w:bookmarkStart": { const name = node.getAttribute("w:name"); if (name && name !== "_GoBack") out.push({ type: "bookmark", attrs: { name } }); break; }
      case "w:fldSimple": {
        const kind = ctx.fields ? pageFieldKind(node.getAttribute("w:instr") ?? "") : null;
        if (kind) out.push({ type: "pageField", attrs: { kind } }); else convertRuns(ctx, node, base, out, fs);
        break;
      }
      case "w:ins": case "w:smartTag": case "w:sdt": case "w:sdtContent": convertRuns(ctx, node, base, out, fs); break;
      case "w:del": ctx.warnings.add("Suivi des modifications : les suppressions suivies sont ignorées."); break;
      case "m:oMath": out.push({ type: "equation", attrs: { latex: mathmlOrOmmlLatex(node) } }); break;
      case "m:oMathPara": for (const m of kids(node).filter((k) => k.nodeName === "m:oMath")) out.push({ type: "equation", attrs: { latex: mathmlOrOmmlLatex(m) } }); break;
    }
  }
}

const JC: Record<string, string> = { left: "left", start: "left", center: "center", right: "right", end: "right", both: "justify", distribute: "justify" };

interface ParaInfo {
  /** Usually one block; several when the paragraph contains manual page breaks. */
  nodes: PM[];
  kind: Kind;
  list: { type: "bulletList" | "orderedList"; level: number; listType?: string | null } | null;
}

function convertParagraph(ctx: Ctx, p: Element): ParaInfo {
  const pPr = child(p, "w:pPr");
  const styleId = attr(pPr ? child(pPr, "w:pStyle") : null, "w:val");
  let kind = kindOfStyle(ctx, styleId);
  const outline = attr(pPr ? child(pPr, "w:outlineLvl") : null, "w:val");
  if (kind.kind === "normal" && outline !== null && +outline <= 2) kind = { kind: "heading", level: +outline + 1 };
  if (kind.kind === "heading" && /^(?:heading|titre)\s*([4-9])$/.test(styleChain(ctx, styleId).at(-1)?.name ?? "")) ctx.warnings.add("Titres de niveau 4 à 9 ramenés au niveau 3.");

  // Alignment, from the paragraph or its styles.
  let jc = attr(pPr ? child(pPr, "w:jc") : null, "w:val");
  if (!jc) for (const s of [...styleChain(ctx, styleId)].reverse()) { const v = attr(s.pPr ? child(s.pPr, "w:jc") : null, "w:val"); if (v) { jc = v; break; } }
  const align = jc ? JC[jc] : undefined;

  // Line spacing (auto rule only).
  let lineHeight: string | undefined;
  const sp = pPr ? child(pPr, "w:spacing") : null;
  const line = sp?.getAttribute("w:line");
  if (line && (sp?.getAttribute("w:lineRule") ?? "auto") === "auto" && Math.abs(+line - 240) > 6) lineHeight = String(+(+line / 240).toFixed(2));

  const base = merge(styleRun(ctx, styleId, kind), readRun(pPr ? child(pPr, "w:rPr") : null));
  if (lineHeight) base.lineHeight = lineHeight;
  const inline: PM[] = [];
  convertRuns(ctx, p, kind.kind === "heading" ? { ...base, bold: undefined, sizePt: undefined } : base, inline);
  const content = splitEquations(mergeText(inline));

  // Lists: numbering on the paragraph or inherited from its style.
  let numPr = pPr ? child(pPr, "w:numPr") : null;
  if (!numPr) for (const s of [...styleChain(ctx, styleId)].reverse()) { const n = s.pPr ? child(s.pPr, "w:numPr") : null; if (n) { numPr = n; break; } }
  let list: ParaInfo["list"] = null;
  if (numPr && kind.kind === "normal") {
    const numId = attr(child(numPr, "w:numId"), "w:val");
    if (numId && numId !== "0") { const nm = ctx.numbering.get(numId); list = { type: nm?.type ?? "bulletList", listType: nm?.listType ?? null, level: +(attr(child(numPr, "w:ilvl"), "w:val") ?? 0) }; }
  }
  if (!list && kind.kind === "normal") {
    const name = styleChain(ctx, styleId).at(-1)?.name ?? "";
    if (/^list bullet/.test(name)) list = { type: "bulletList", level: 0 };
    else if (/^list number/.test(name)) list = { type: "orderedList", level: 0 };
  }

  // Background and borders set directly on the paragraph.
  const fill = attr(pPr ? child(pPr, "w:shd") : null, "w:fill");
  const bdr = pPr ? child(pPr, "w:pBdr") : null;
  const borders: Record<string, boolean> = {};
  if (bdr) for (const [tag, side] of [["w:top", "top"], ["w:right", "right"], ["w:bottom", "bottom"], ["w:left", "left"]] as const) {
    const v = attr(child(bdr, tag), "w:val");
    if (v && v !== "none" && v !== "nil") borders[side] = true;
  }
  const deco = { shading: fill && fill !== "auto" && /^[0-9a-f]{6}$/i.test(fill) ? `#${fill.toLowerCase()}` : null, borders: Object.keys(borders).length ? borders : null };

  // Manual page breaks and shapes split the paragraph into blocks.
  const nodes: PM[] = [];
  if (pPr && child(pPr, "w:pageBreakBefore")) nodes.push({ type: "pageBreak" });
  let current: PM[] = [];
  const floating: PM[] = []; // free shapes anchored here: they come before the paragraph, which is not split
  let firstBlock = true;
  const flush = (force = false) => {
    if (current.length || force) {
      nodes.push(kind.kind === "heading" && firstBlock ? heading(kind.level, current, align, deco) : paragraph(current, align, firstBlock ? deco : undefined));
      firstBlock = false;
    }
    current = [];
  };
  for (const n of content) {
    if (n.type === "pageBreak") { flush(); nodes.push(n); }
    else if ((n.type === "shape" || n.type === "shapeGroup") && n.attrs?.wrap !== "inline") floating.push({ ...n, attrs: { ...n.attrs, align: "left" } });
    else if (n.type === "shape" || n.type === "shapeGroup") { flush(); nodes.push({ ...n, attrs: { ...n.attrs, align: n.attrs?.wrap === "inline" && (align === "center" || align === "right") ? align : "left" } }); }
    else current.push(n);
  }
  flush();
  if (!nodes.length && !floating.length) nodes.push(paragraph([], align, deco));
  nodes.unshift(...floating);
  return { nodes, kind, list };
}

function convertTable(ctx: Ctx, tbl: Element): PM {
  const grid = Array.from(first(tbl, "w:tblGrid")?.getElementsByTagName("w:gridCol") ?? []).map((g) => Math.round(+(g.getAttribute("w:w") ?? 0) / 15));
  const rows: PM[] = [];
  /** column index -> restarting cell that continues downwards */
  const open = new Map<number, PM>();

  for (const tr of kids(tbl).filter((k) => k.nodeName === "w:tr")) {
    const isHeader = !!child(child(tr, "w:trPr") ?? tr, "w:tblHeader");
    const cells: PM[] = [];
    let col = 0;
    for (const tc of kids(tr).filter((k) => k.nodeName === "w:tc")) {
      const tcPr = child(tc, "w:tcPr");
      const span = +(attr(tcPr ? child(tcPr, "w:gridSpan") : null, "w:val") ?? 1);
      const vm = tcPr ? child(tcPr, "w:vMerge") : null;
      if (vm && vm.getAttribute("w:val") !== "restart") {
        const owner = open.get(col);
        if (owner) owner.attrs!.rowspan = (owner.attrs!.rowspan as number) + 1;
        col += span;
        continue;
      }
      const widths = grid.slice(col, col + span);
      const cellFill = attr(tcPr ? child(tcPr, "w:shd") : null, "w:fill");
      const cb = tcPr ? child(tcPr, "w:tcBorders") : null;
      const borderless = !!cb && ["w:top", "w:left", "w:bottom", "w:right"].every((t) => ["none", "nil"].includes(attr(child(cb, t), "w:val") ?? ""));
      // The default grey of header cells is not an explicit shading.
      const explicit = cellFill && cellFill !== "auto" && /^[0-9a-f]{6}$/i.test(cellFill) && !(isHeader && cellFill.toUpperCase() === "F3F4F6");
      const cell: PM = {
        type: isHeader ? "tableHeader" : "tableCell",
        attrs: { colspan: span, rowspan: 1, ...(explicit ? { shading: `#${cellFill!.toLowerCase()}` } : {}), ...(borderless ? { borderless: true } : {}), ...(widths.length === span && widths.every((w) => w > 0) ? { colwidth: widths } : {}) },
        content: ensureBlocks(convertBlocks(ctx, tc)),
      };
      if (vm) open.set(col, cell); else open.delete(col);
      cells.push(cell);
      col += span;
    }
    rows.push({ type: "tableRow", content: cells });
  }
  return { type: "table", content: rows };
}

function convertBlocks(ctx: Ctx, container: Element): PM[] {
  const out: PM[] = [];
  const lists = new ListBuilder(out);
  let quote: PM | null = null;
  let code: PM | null = null;
  const flush = () => { quote = null; code = null; };

  const visit = (el: Element) => {
    switch (el.nodeName) {
      case "w:p": {
        const { nodes, kind, list } = convertParagraph(ctx, el);
        if (nodes.length !== 1 || nodes[0].type === "pageBreak") { flush(); lists.close(); out.push(...nodes); return; }
        const node = nodes[0];
        if (list) { flush(); lists.add(list.type, list.level, [node], list.listType); return; }
        lists.close();
        if (kind.kind === "quote") {
          code = null;
          if (!quote) { quote = { type: "blockquote", content: [] }; out.push(quote); }
          (quote as PM).content!.push(node);
        } else if (kind.kind === "code") {
          quote = null;
          const text = (node.content ?? []).map((c) => c.text ?? "").join("");
          if (!code) { code = { type: "codeBlock", content: text ? [{ type: "text", text }] : [] }; out.push(code); }
          else (code as PM).content = [{ type: "text", text: `${((code as PM).content ?? []).map((c) => c.text).join("")}\n${text}` }];
        } else { flush(); out.push(node); }
        return;
      }
      case "w:tbl": flush(); lists.close(); out.push(convertTable(ctx, el)); return;
      case "w:sdt": case "w:sdtContent": case "w:customXml": kids(el).forEach(visit); return;
    }
  };
  kids(container).forEach(visit);
  return out;
}

async function readHeadersFooters(ctx: Ctx, sectPr: Element, text: (path: string) => Promise<string | null>): Promise<HeaderFooterSettings | undefined> {
  const result: HeaderFooterSettings = { header: {}, footer: {}, titlePage: !!child(sectPr, "w:titlePg"), evenOdd: false };
  const settings = await text("word/settings.xml");
  if (settings) {
    const flag = first(parseXml(settings, "settings.xml"), "w:evenAndOddHeaders");
    result.evenOdd = !!flag && !["0", "false", "off"].includes(flag.getAttribute("w:val") ?? "");
  }
  for (const ref of kids(sectPr).filter((k) => k.nodeName === "w:headerReference" || k.nodeName === "w:footerReference")) {
    const rel = ctx.rels.get(ref.getAttribute("r:id") ?? "");
    if (!rel) continue;
    const name = rel.target.replace(/^\/?(word\/)?/, "");
    const xml = await text(`word/${name}`);
    if (!xml) continue;
    // The part has its own relationships (its images).
    const partCtx: Ctx = { ...ctx, fields: true, rels: parseRels(await text(`word/_rels/${name}.rels`)) };
    const blocks = convertBlocks(partCtx, parseXml(xml, "en-tête/pied de page").documentElement);
    const set: HeaderFooterSet = ref.nodeName === "w:headerReference" ? result.header : result.footer;
    const type = ref.getAttribute("w:type");
    const content = { blocks };
    if (type === "first") set.first = content; else if (type === "even") set.even = content; else set.default = content;
  }
  const clean = sanitizeHeaderFooter(result);
  const any = (s: HeaderFooterSet) => !!(s.default || s.first || s.even);
  if (!any(clean.header) && !any(clean.footer)) return undefined;
  // Variants only count when their content exists.
  clean.titlePage = result.titlePage && !!(clean.header.first || clean.footer.first);
  clean.evenOdd = result.evenOdd && !!(clean.header.even || clean.footer.even);
  return clean;
}

export async function importDocx(bytes: Uint8Array): Promise<ImportResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw corrupt("archive ZIP illisible");
  }
  const text = async (path: string) => (await zip.file(path)?.async("string")) ?? null;
  const docXml = await text("word/document.xml");
  if (!docXml) throw corrupt("word/document.xml est absent : ce n'est pas un document DOCX");

  const warnings = new Set<string>();
  const images = new Map<string, string>();
  for (const path of Object.keys(zip.files).filter((p) => p.startsWith("word/media/"))) {
    const mime = mimeForPath(path);
    if (mime) images.set(path, toDataUri(await zip.file(path)!.async("uint8array"), mime));
  }
  const stylesXml = await text("word/styles.xml");
  const ctx: Ctx = {
    zip,
    styles: parseStyles(zip, stylesXml),
    docFont: stylesXml ? (() => { const f = first(parseXml(stylesXml, "styles.xml"), "w:rPrDefault"); return f ? readRun(child(f, "w:rPr")).font ?? null : null; })() : null,
    docPPr: stylesXml ? first(parseXml(stylesXml, "styles.xml"), "w:pPrDefault") : null,
    numbering: parseNumbering(await text("word/numbering.xml")),
    rels: parseRels(await text("word/_rels/document.xml.rels")),
    warnings,
    images,
  };

  const doc = parseXml(docXml, "document.xml");
  const body = first(doc, "w:body");
  if (!body) throw corrupt("corps du document absent");
  const blocks = convertBlocks(ctx, body);

  // Page setup from the last section.
  const sectPr = child(body, "w:sectPr") ?? Array.from(doc.getElementsByTagName("w:sectPr")).pop() ?? null;
  const sz = sectPr ? child(sectPr, "w:pgSz") : null;
  const mar = sectPr ? child(sectPr, "w:pgMar") : null;
  let w = +(sz?.getAttribute("w:w") ?? 11906) / 15;
  let h = +(sz?.getAttribute("w:h") ?? 16838) / 15;
  if (sz?.getAttribute("w:orient") === "landscape" && w < h) [w, h] = [h, w];
  const twip = (name: string) => +(mar?.getAttribute(name) ?? 1440) / 15;
  const settings = await text("word/settings.xml");
  const mirrored = !!settings && /<w:mirrorMargins\b(?![^>]*w:val="(?:0|false|off)")/.test(settings);
  const gutterTop = !!settings && /<w:gutterAtTop\b(?![^>]*w:val="(?:0|false|off)")/.test(settings);
  const gutterPx = mar ? +(mar.getAttribute("w:gutter") ?? 0) / 15 : 0;
  const page = pageFromDimensions(w, h, mar ? { top: twip("w:top"), right: twip("w:right"), bottom: twip("w:bottom"), left: twip("w:left") } : null, warnings, { mirrored, gutterPx, gutterTop });

  resolvePlacements(blocks, w, { top: mar ? +(mar.getAttribute("w:top") ?? 1440) / 15 : 96, left: mar ? +(mar.getAttribute("w:left") ?? 1440) / 15 : 96, right: mar ? +(mar.getAttribute("w:right") ?? 1440) / 15 : 96 });

  // Headers and footers (first line of text, with page-number fields).
  const headerFooter = sectPr ? await readHeadersFooters(ctx, sectPr, text) : undefined;
  const footnotes = await text("word/footnotes.xml");
  if (footnotes && Array.from(parseXml(footnotes, "footnotes.xml").getElementsByTagName("w:footnote")).some((f) => !f.getAttribute("w:type") && f.textContent?.trim()))
    warnings.add("Notes de bas de page : non prises en charge, ignorées.");
  if (zip.file("word/comments.xml")) warnings.add("Commentaires : non pris en charge, ignorés.");

  // Never present an unreadable document as an empty one.
  if (!hasVisibleContent(blocks)) {
    const sourceHasContent = Array.from(doc.getElementsByTagName("w:t")).some((t) => t.textContent?.trim()) || doc.getElementsByTagName("w:drawing").length > 0 || doc.getElementsByTagName("w:tbl").length > 0;
    if (sourceHasContent) throw new DocumentError("unreadable-content", "Le contenu de ce document n'a pas pu être lu : il utilise des éléments que Loma Writer ne sait pas importer.");
  }
  const styles = readDocStyles(ctx);
  return { model: { content: { type: "doc", content: ensureBlocks(blocks) }, page, ...(headerFooter ? { headerFooter } : {}), ...(Object.keys(styles).length ? { styles } : {}) }, warnings: [...warnings] };
}
