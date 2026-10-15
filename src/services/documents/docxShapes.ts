import { isKnownShape, NONE, TEXT_BOX } from "../../editor/shapes/catalog";
import type { Gradient, Shadow } from "../../editor/shapes/types";
import type { PM, Mark } from "./pm";
import { esc } from "./xml";

const EMU = 9525; // per CSS px
export const emu = (px: number) => Math.round(px * EMU);
const hex = (c: string) => c.replace("#", "").toUpperCase();
const toPt = (size: unknown): number | undefined => {
  const m = /^([\d.]+)\s*(pt|px)?$/.exec(String(size ?? ""));
  return m ? (m[2] === "px" ? +m[1] * 0.75 : +m[1]) : undefined;
};

function runProps(marks: Mark[] = []): string {
  let out = "";
  for (const m of marks) {
    if (m.type === "bold") out += "<w:b/>";
    else if (m.type === "italic") out += "<w:i/>";
    else if (m.type === "underline") out += '<w:u w:val="single"/>';
    else if (m.type === "strike") out += "<w:strike/>";
    else if (m.type === "subscript") out += '<w:vertAlign w:val="subscript"/>';
    else if (m.type === "superscript") out += '<w:vertAlign w:val="superscript"/>';
    else if (m.type === "highlight" && m.attrs?.color) out += `<w:shd w:val="clear" w:color="auto" w:fill="${hex(String(m.attrs.color))}"/>`;
    else if (m.type === "textStyle") {
      const a = m.attrs ?? {};
      if (a.fontFamily) out += `<w:rFonts w:ascii="${esc(String(a.fontFamily))}" w:hAnsi="${esc(String(a.fontFamily))}"/>`;
      if (a.color) out += `<w:color w:val="${hex(String(a.color))}"/>`;
      const pt = toPt(a.fontSize);
      if (pt) out += `<w:sz w:val="${Math.round(pt * 2)}"/>`;
    }
  }
  return out ? `<w:rPr>${out}</w:rPr>` : "";
}

const JC: Record<string, string> = { left: "left", center: "center", right: "right", justify: "both" };

/** A paragraph of a text box, as WordprocessingML. Inline images and equations are not carried inside shapes. */
function paragraphXml(p: PM, kind: string): string {
  const align = String(p.attrs?.textAlign ?? (kind === TEXT_BOX ? "left" : "center"));
  const runs = (p.content ?? [])
    .map((n) => {
      if (n.type === "hardBreak") return "<w:r><w:br/></w:r>";
      if (n.type !== "text" || !n.text) return "";
      return n.text.split("\t").map((part, i) => `${i ? "<w:r><w:tab/></w:r>" : ""}${part ? `<w:r>${runProps(n.marks)}<w:t xml:space="preserve">${esc(part)}</w:t></w:r>` : ""}`).join("");
    })
    .join("");
  return `<w:p><w:pPr><w:jc w:val="${JC[align] ?? "left"}"/></w:pPr>${runs}</w:p>`;
}

// ----------------------------------------------------------------------------------------------- DrawingML pieces

const rgb = (c: string) => `<a:srgbClr val="${hex(c)}"/>`;

export function fillXml(fill: unknown, gradient: Gradient | null | undefined): string {
  if (gradient) {
    const stops = gradient.stops.map((s) => `<a:gs pos="${Math.round(s.pos * 1000)}">${rgb(s.color)}</a:gs>`).join("");
    const shade = gradient.type === "radial" ? '<a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path>' : `<a:lin ang="${Math.round(((gradient.angle % 360) + 360) % 360 * 60000)}" scaled="0"/>`;
    return `<a:gradFill rotWithShape="1"><a:gsLst>${stops}</a:gsLst>${shade}</a:gradFill>`;
  }
  return fill === NONE || !fill ? "<a:noFill/>" : `<a:solidFill>${rgb(String(fill))}</a:solidFill>`;
}

export function shadowXml(s: Shadow | null | undefined): string {
  if (!s) return "";
  const dist = Math.hypot(s.dx, s.dy);
  const dir = ((Math.atan2(s.dy, s.dx) * 180) / Math.PI + 360) % 360;
  return `<a:effectLst><a:outerShdw blurRad="${emu(s.blur)}" dist="${emu(dist)}" dir="${Math.round(dir * 60000)}" algn="ctr" rotWithShape="0"><a:srgbClr val="${hex(s.color)}"><a:alpha val="${Math.round(s.opacity * 100000)}"/></a:srgbClr></a:outerShdw></a:effectLst>`;
}

interface Pos {
  x?: number;
  y?: number;
}

/** `wps:wsp`: one shape. `at` gives its offset inside a group (EMU are computed from px). */
function wspXml(a: Record<string, unknown>, paragraphs: PM[], id: number, at: Pos = {}): string {
  const kind = String(a.kind ?? "rect");
  const box = kind === TEXT_BOX;
  const prst = box || !isKnownShape(kind) ? "rect" : kind;
  const w = emu(Number(a.width) || 160);
  const h = emu(Number(a.height) || 100);
  const line = a.stroke === NONE || !a.stroke ? "<a:ln><a:noFill/></a:ln>" : `<a:ln w="${emu(Number(a.strokeWidth) || 1)}"><a:solidFill>${rgb(String(a.stroke))}</a:solidFill></a:ln>`;
  const rot = Number(a.rotation) ? ` rot="${Math.round(Number(a.rotation) * 60000)}"` : "";
  const text = paragraphs.length ? `<wps:txbx><w:txbxContent>${paragraphs.map((p) => paragraphXml(p, kind)).join("")}</w:txbxContent></wps:txbx>` : "";
  const body = `<wps:bodyPr rot="0" vert="horz" wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="${box ? "t" : "ctr"}" anchorCtr="0">${box ? "<a:spAutoFit/>" : "<a:noAutofit/>"}</wps:bodyPr>`;
  return (
    `<wps:wsp>${at.x !== undefined ? `<wps:cNvPr id="${id}" name="${box ? "Zone de texte" : "Forme"} ${id}"/>` : ""}<wps:cNvSpPr${box ? ' txBox="1"' : ""}/>` +
    `<wps:spPr><a:xfrm${rot}><a:off x="${emu(at.x ?? 0)}" y="${emu(at.y ?? 0)}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>` +
    `${fillXml(a.fill, a.gradient as Gradient | null)}${line}${shadowXml(a.shadow as Shadow | null)}</wps:spPr>${text}${body}</wps:wsp>`
  );
}

const REL_HEIGHT_BASE = 251658240;

/** Wraps graphic data in `wp:inline` or `wp:anchor` according to the placement of the object. */
function drawingRun(a: Record<string, unknown>, graphicUri: string, graphic: string, id: number, label: string): string {
  const w = emu(Number(a.width) || 160);
  const h = emu(Number(a.height) || 100);
  const wrap = String(a.wrap ?? "inline");
  const common =
    `<wp:effectExtent l="0" t="0" r="0" b="0"/>`;
  const doc = `<wp:docPr id="${id}" name="${esc(label)} ${id}"${a.alt ? ` descr="${esc(String(a.alt))}"` : ""}/><wp:cNvGraphicFramePr/>`;
  const gfx = `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="${graphicUri}">${graphic}</a:graphicData></a:graphic>`;
  if (wrap === "inline" || wrap === "group") {
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${w}" cy="${h}"/>${common}${doc}${gfx}</wp:inline></w:drawing></w:r>`;
  }
  const page = a.anchor === "page";
  const relH = page ? "page" : "column";
  const relV = page ? "page" : "paragraph";
  const wrapXml = wrap === "square" ? '<wp:wrapSquare wrapText="bothSides"/>' : wrap === "topBottom" ? "<wp:wrapTopAndBottom/>" : "<wp:wrapNone/>";
  const z = Math.max(-49, Math.min(49, Number(a.z) || 0));
  return (
    `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="${emu(12)}" distR="${emu(12)}" simplePos="0" relativeHeight="${REL_HEIGHT_BASE + (z + 50) * 1024}" behindDoc="${wrap === "behind" ? 1 : 0}" locked="0" layoutInCell="1" allowOverlap="1">` +
    `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="${relH}"><wp:posOffset>${emu(Number(a.x) || 0)}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="${relV}"><wp:posOffset>${emu(Number(a.y) || 0)}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${w}" cy="${h}"/>${common}${wrapXml}${doc}${gfx}</wp:anchor></w:drawing></w:r>`
  );
}

/** The whole `w:r` that draws a shape or text box: a real DrawingML shape that Word and LibreOffice edit natively. */
export function shapeRunXml(attrs: Record<string, unknown>, paragraphs: PM[], id: number): string {
  const box = attrs.kind === TEXT_BOX;
  return drawingRun(attrs, "http://schemas.microsoft.com/office/word/2010/wordprocessingShape", wspXml(attrs, paragraphs, id), id, box ? "Zone de texte" : "Forme");
}

/** A group of shapes (`wpg:wgp`): children are positioned inside the group's box. */
export function groupRunXml(attrs: Record<string, unknown>, children: PM[], id: number): string {
  const w = emu(Number(attrs.width) || 160);
  const h = emu(Number(attrs.height) || 100);
  const rot = Number(attrs.rotation) ? ` rot="${Math.round(Number(attrs.rotation) * 60000)}"` : "";
  const parts = children.map((c, i) => wspXml(c.attrs ?? {}, c.content ?? [], id + 1 + i, { x: Number(c.attrs?.x) || 0, y: Number(c.attrs?.y) || 0 })).join("");
  const grp = `<wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm${rot}><a:off x="0" y="0"/><a:ext cx="${w}" cy="${h}"/><a:chOff x="0" y="0"/><a:chExt cx="${w}" cy="${h}"/></a:xfrm></wpg:grpSpPr>${parts}</wpg:wgp>`;
  return drawingRun(attrs, "http://schemas.microsoft.com/office/word/2010/wordprocessingGroup", grp, id, "Groupe");
}
