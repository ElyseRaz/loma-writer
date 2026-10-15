import { mathmlToLatex, ommlToLatex } from "../math/latex";
import { texFromMathml } from "../math/mathml";

/** LaTeX of an OMML `m:oMath` or MathML `math` element (the TeX annotation is used when Loma Writer wrote it). */
export function mathmlOrOmmlLatex(el: Element): string {
  if (el.localName === "oMath" || el.localName === "oMathPara") return ommlToLatex(el);
  return texFromMathml(el) ?? mathmlToLatex(el);
}
