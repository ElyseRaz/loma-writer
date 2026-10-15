import type { PM } from "../pm";
import type { DocumentModel } from "../types";

// 1×1 transparent PNG
export const PNG_1x1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const t = (text: string, marks?: PM["marks"]): PM => (marks ? { type: "text", text, marks } : { type: "text", text });
const p = (...content: PM[]): PM => ({ type: "paragraph", content });
const li = (...content: PM[]): PM => ({ type: "listItem", content });

/** A document that exercises every feature the adapters claim to support. */
export function richModel(): DocumentModel {
  return {
    page: { size: "A4", orientation: "portrait", margins: "normal" },
    defaults: { fontFamily: "Inter", fontSizePt: 11 },
    content: {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [t("Rapport de stage")] },
        p(t("Texte "), t("gras", [{ type: "bold" }]), t(" "), t("italique", [{ type: "italic" }]), t(" "), t("souligné", [{ type: "underline" }]), t(" "), t("barré", [{ type: "strike" }]), t(" et "), t("rouge 16pt Georgia", [{ type: "textStyle", attrs: { color: "#dc2626", fontSize: "16pt", fontFamily: "Georgia" } }]), t(".")),
        { type: "paragraph", attrs: { textAlign: "center" }, content: [t("Centré")] },
        { type: "paragraph", attrs: { shading: "#fef08a", borders: { top: true, bottom: true } }, content: [t("Paragraphe surligné et encadré")] },
        { type: "paragraph", attrs: { textAlign: "justify" }, content: [t("Justifié avec un "), t("lien", [{ type: "link", attrs: { href: "https://exemple.org/page" } }]), t(" et de l'exposant"), t("2", [{ type: "superscript" }])] },
        { type: "heading", attrs: { level: 2 }, content: [t("Listes")] },
        { type: "bulletList", content: [li(p(t("Puce A")), { type: "bulletList", content: [li(p(t("Sous-puce A1")))] }), li(p(t("Puce B")))] },
        { type: "orderedList", content: [li(p(t("Premier"))), li(p(t("Deuxième")), { type: "orderedList", content: [li(p(t("Deuxième.un")))] })] },
        { type: "heading", attrs: { level: 3 }, content: [t("Tableau")] },
        {
          type: "table",
          content: [
            { type: "tableRow", content: [{ type: "tableHeader", attrs: { colspan: 1, rowspan: 1 }, content: [p(t("Module"))] }, { type: "tableHeader", attrs: { colspan: 1, rowspan: 1 }, content: [p(t("Statut"))] }] },
            { type: "tableRow", content: [{ type: "tableCell", attrs: { colspan: 1, rowspan: 1, shading: "#bbf7d0" }, content: [p(t("Noyau"))] }, { type: "tableCell", attrs: { colspan: 1, rowspan: 1, borderless: true }, content: [p(t("Actif", [{ type: "bold" }]))] }] },
            { type: "tableRow", content: [{ type: "tableCell", attrs: { colspan: 2, rowspan: 1 }, content: [p(t("Cellule fusionnée"))] }] },
          ],
        },
        { type: "blockquote", content: [p(t("Une citation importante."))] },
        { type: "codeBlock", content: [t("let x = 1;\nlet y = 2;")] },
        p({ type: "image", attrs: { src: PNG_1x1, alt: "pixel", width: 40, height: 40 } }),
        { type: "pageBreak" },
        p({ type: "bookmark", attrs: { name: "Intro" } }, t("Ancre, "), t("renvoi", [{ type: "link", attrs: { href: "#Intro" } }]), t(" et "), { type: "equation", attrs: { latex: "E=mc^{2}" } }),
        { type: "shape", attrs: { kind: "roundRect", width: 200, height: 80, fill: "#bbf7d0", stroke: "#16a34a", strokeWidth: 2, align: "center" }, content: [p(t("Dans la forme", [{ type: "bold" }]))] },
        { type: "shape", attrs: { kind: "textbox", width: 300, height: 60, fill: "#ffffff", stroke: "#6b7280", strokeWidth: 1, align: "left" }, content: [p(t("Ligne 1 de la zone")), { type: "paragraph", attrs: { textAlign: "right" }, content: [t("Ligne 2")] }] },
        { type: "shape", attrs: { kind: "star5", width: 120, height: 120, fill: "none", stroke: "#dc2626", strokeWidth: 3, align: "right" }, content: [{ type: "paragraph" }] },
        { type: "shape", attrs: { kind: "line", width: 200, height: 24, fill: "none", stroke: "#242424", strokeWidth: 3, align: "left" }, content: [] },
        { type: "shape", attrs: { kind: "cloud", width: 150, height: 90, fill: "#bfdbfe", stroke: "#2563eb", strokeWidth: 2, wrap: "front", anchor: "page", x: 300, y: 600, z: 3, rotation: 15, align: "left", alt: "Nuage", gradient: { type: "linear", angle: 45, stops: [{ pos: 0, color: "#bfdbfe" }, { pos: 100, color: "#2563eb" }] }, shadow: { color: "#000000", opacity: 0.4, blur: 6, dx: 4, dy: 4 } }, content: [p(t("Nuage"))] },
        { type: "shape", attrs: { kind: "rect", width: 140, height: 80, fill: "#fef08a", stroke: "#ca8a04", strokeWidth: 1, wrap: "square", anchor: "paragraph", x: 380, y: 0, z: 0, align: "left" }, content: [p(t("Habillage carré"))] },
        { type: "shape", attrs: { kind: "star5", width: 100, height: 100, fill: "#fecaca", stroke: "#dc2626", strokeWidth: 2, wrap: "behind", anchor: "paragraph", x: 20, y: 10, z: -2, align: "left", gradient: { type: "radial", angle: 0, stops: [{ pos: 0, color: "#fecaca" }, { pos: 100, color: "#dc2626" }] } }, content: [{ type: "paragraph" }] },
        { type: "shapeGroup", attrs: { width: 210, height: 120, wrap: "front", anchor: "page", x: 60, y: 80, z: 1, rotation: 0, align: "left", alt: "Groupe" }, content: [
          { type: "shape", attrs: { kind: "ellipse", width: 100, height: 60, fill: "#bbf7d0", stroke: "#16a34a", strokeWidth: 2, wrap: "group", anchor: "paragraph", z: 0, x: 0, y: 0, align: "left" }, content: [p(t("A"))] },
          { type: "shape", attrs: { kind: "diamond", width: 90, height: 90, fill: "#e9d5ff", stroke: "#7c3aed", strokeWidth: 2, wrap: "group", anchor: "paragraph", z: 0, x: 120, y: 30, align: "left", rotation: 30 }, content: [{ type: "paragraph" }] },
        ] },
        p(t("Fin du document.")),
      ],
    },
  };
}

/** Structure-only view used to compare documents across formats (ignores attributes a format may legitimately add). */
export interface Flat {
  type: string;
  level?: number;
  align?: string;
  span?: string;
  deco?: string;
  shape?: string;
  runs?: Array<{ text: string; marks: string[] }>;
  children?: Flat[];
}

export function flatten(node: PM): Flat[] {
  const out: Flat[] = [];
  for (const n of node.content ?? []) {
    if (["paragraph", "heading", "codeBlock"].includes(n.type ?? "")) {
      const runs: Flat["runs"] = [];
      for (const c of n.content ?? []) {
        if (c.type === "text") {
          const marks: string[] = (c.marks ?? []).flatMap((m) => (m.type === "textStyle" ? Object.entries(m.attrs ?? {}).map(([k, v]) => `${k}:${v}`) : m.type === "link" || m.type === "highlight" ? [`${m.type}:${JSON.stringify(m.attrs)}`] : [m.type])).sort();
          const prev = runs[runs.length - 1];
          if (prev && prev.marks.join() === marks.join()) prev.text += c.text!;
          else runs.push({ text: c.text!, marks });
        } else runs.push({ text: c.type === "hardBreak" ? "\n" : c.type === "bookmark" ? `[bookmark:${c.attrs?.name}]` : c.type === "equation" ? `[equation:${c.attrs?.latex}]` : `[${String(c.type)}]`, marks: [] });
      }
      const align = n.attrs?.textAlign && n.attrs.textAlign !== "left" ? String(n.attrs.textAlign) : undefined;
      const deco = [n.attrs?.shading && `bg:${n.attrs.shading}`, n.attrs?.borders && `bd:${Object.keys(n.attrs.borders).filter((k) => n.attrs!.borders[k]).sort().join("+")}`].filter(Boolean).join(" ");
      out.push({ type: n.type ?? "", ...(n.type === "heading" ? { level: n.attrs?.level } : {}), ...(align ? { align } : {}), ...(deco ? { deco } : {}), runs });
    } else if (n.type === "shape") {
      const a = n.attrs!;
      const wrap = a.wrap && a.wrap !== "inline" ? ` wrap:${a.wrap}/${a.anchor}@${a.x},${a.y} z${a.z ?? 0}` : "";
      const fx = `${a.rotation ? ` rot${a.rotation}` : ""}${a.gradient ? ` grad:${a.gradient.type}/${Math.round(a.gradient.angle)}/${a.gradient.stops.map((s: { pos: number; color: string }) => `${s.pos}:${s.color}`).join(",")}` : ""}${a.shadow ? ` shadow:${a.shadow.color}/${a.shadow.opacity}/${a.shadow.blur}/${a.shadow.dx},${a.shadow.dy}` : ""}`;
      out.push({ type: "shape", shape: `${a.kind} ${a.width}x${a.height} fill:${a.fill} stroke:${a.stroke}/${a.strokeWidth} ${a.align}${wrap}${fx}`, children: flatten(n) });
    } else if (n.type === "shapeGroup") {
      const a = n.attrs!;
      out.push({ type: "group", shape: `${a.width}x${a.height} wrap:${a.wrap}/${a.anchor}@${a.x},${a.y} z${a.z ?? 0}${a.rotation ? ` rot${a.rotation}` : ""}`, children: flatten(n) });
    } else out.push({ type: String(n.type), ...(+(n.attrs?.colspan ?? 1) > 1 || +(n.attrs?.rowspan ?? 1) > 1 ? { span: `${n.attrs?.colspan}x${n.attrs?.rowspan}` } : {}),
        ...(n.attrs?.shading || n.attrs?.borderless ? { deco: `${n.attrs.shading ? "bg:" + n.attrs.shading : ""}${n.attrs.borderless ? " borderless" : ""}`.trim() } : {}), children: flatten(n) });
  }
  return out;
}

import { contentFromTemplate, type HeaderFooterSettings } from "../../../pagination/headerFooter";

export const headerFooterSample = (): HeaderFooterSettings => ({
  header: { default: contentFromTemplate("Rapport — confidentiel", "right"), first: contentFromTemplate("Page de garde") },
  footer: { default: contentFromTemplate("Page {PAGE} sur {PAGES}", "center") },
  titlePage: true,
  evenOdd: false,
});

/** A header with several lines, an image, a borderless three-zone table and page-number fields. */
export const richHeaderFooter = (): HeaderFooterSettings => {
  const t = (text: string, marks?: Array<{ type: string }>) => ({ type: "text", text, ...(marks ? { marks } : {}) });
  const cell = (...content: object[]) => ({ type: "tableCell", attrs: { colspan: 1, rowspan: 1, borderless: true }, content });
  return {
    header: {
      default: {
        blocks: [
          { type: "paragraph", attrs: { textAlign: "right" }, content: [t("Société Loma", [{ type: "bold" }])] },
          { type: "paragraph", attrs: { textAlign: "center" }, content: [t("Rapport annuel — confidentiel")] },
          { type: "paragraph", content: [{ type: "image", attrs: { src: PNG_1x1, alt: "Logo", width: 60, height: 30 } }] },
          { type: "table", content: [{ type: "tableRow", content: [cell({ type: "paragraph", content: [t("Gauche")] }), cell({ type: "paragraph", attrs: { textAlign: "center" }, content: [t("Centre")] }), cell({ type: "paragraph", attrs: { textAlign: "right" }, content: [t("Page "), { type: "pageField", attrs: { kind: "page" } }] })] }] },
        ],
      },
    },
    footer: { default: contentFromTemplate("Page {PAGE} sur {PAGES}", "center") },
    titlePage: false,
    evenOdd: false,
  };
};
