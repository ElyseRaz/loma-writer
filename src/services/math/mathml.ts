import katex from "katex";
import { parseXml } from "../documents/xml";

/** MathML for a LaTeX formula, produced by KaTeX (offline). The result keeps the original LaTeX in an annotation. */
export function latexToMathml(latex: string): string {
  const html = katex.renderToString(latex, { output: "mathml", throwOnError: false, displayMode: false });
  const m = /<math[\s\S]*<\/math>/.exec(html);
  // An invalid formula still gets a valid (textual) MathML, so saving a document never fails because of it.
  if (!m) return `<math xmlns="http://www.w3.org/1998/Math/MathML"><mtext>${latex.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</mtext></math>`;
  return m[0].replace(/^<math/, '<math xmlns="http://www.w3.org/1998/Math/MathML"').replace('xmlns="http://www.w3.org/1998/Math/MathML" xmlns="http://www.w3.org/1998/Math/MathML"', 'xmlns="http://www.w3.org/1998/Math/MathML"');
}

/** The LaTeX stored by KaTeX in the MathML annotation, when this MathML came from Loma Writer. */
export function texFromMathml(mathml: Document | Element): string | null {
  const ann = byLocalName(mathml, "annotation").find((a) => a.getAttribute("encoding") === "application/x-tex");
  return ann?.textContent ?? null;
}

/** Elements by local name, whatever the namespace prefix (LibreOffice writes `math:math`). */
export function byLocalName(root: Document | Element, name: string): Element[] {
  return Array.from(root.getElementsByTagName("*")).filter((e) => e.localName === name);
}

export const parseMathml = (xml: string) => parseXml(xml, "formule MathML");
