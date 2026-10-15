import { describe, expect, it } from "vitest";
import { ommlToLatex, } from "../latex";
import { latexToMathml, parseMathml, texFromMathml } from "../mathml";
import { mathmlToLatex } from "../latex";
import { mathmlElementToOmml } from "../omml";

const OMML_NS = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
const toOmml = (latex: string) => mathmlElementToOmml(parseMathml(latexToMathml(latex)).documentElement).replace("<m:oMath>", `<m:oMath ${OMML_NS}>`);
const fromOmml = (xml: string) => ommlToLatex(parseMathml(xml).documentElement);

/** Structure of a formula as KaTeX understands it: structural tags and visible characters. */
function signature(latex: string) {
  const doc = parseMathml(latexToMathml(latex));
  const tags: Record<string, number> = {};
  for (const e of Array.from(doc.getElementsByTagName("*"))) {
    if (["annotation", "semantics", "math", "mrow", "mstyle", "mpadded"].includes(e.localName)) continue;
    tags[e.localName] = (tags[e.localName] ?? 0) + 1;
  }
  const text = Array.from(doc.getElementsByTagName("*")).filter((e) => e.localName !== "annotation" && e.children.length === 0).map((e) => e.textContent).join("").replace(/\s|⁡|⁢/g, "");
  return { tags, text };
}

const FORMULAS = [
  "\\frac{a}{b}", "x^{2}", "x_{i}", "x_{i}^{2}", "\\sqrt{x}", "\\sqrt[3]{x+1}", "\\sum_{i=1}^{n} i", "\\int_{a}^{b} f(x)\\,dx",
  "\\alpha+\\beta=\\gamma", "\\left(a+b\\right)", "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}", "\\hat{x}+\\vec{v}", "\\sin x+\\cos x",
  "x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}", "E=mc^2", "\\lim_{x \\to \\infty} f(x)", "\\prod_{k=1}^{n} k", "a \\leq b \\neq c", "\\overline{AB}",
];

describe("LaTeX -> MathML (KaTeX, offline)", () => {
  it("keeps the source LaTeX in the annotation", () => {
    const m = parseMathml(latexToMathml("\\frac{a}{b}"));
    expect(texFromMathml(m)).toBe("\\frac{a}{b}");
  });
  it("never throws on invalid input", () => {
    expect(() => latexToMathml("\\frac{")).not.toThrow();
  });
});

describe("LaTeX -> OMML -> LaTeX", () => {
  it.each(FORMULAS)("keeps the structure of %s", (latex) => {
    const back = fromOmml(toOmml(latex));
    expect(signature(back)).toEqual(signature(latex));
  });

  it("produces native Word elements", () => {
    expect(toOmml("\\frac{a}{b}")).toContain("<m:f>");
    expect(toOmml("\\sqrt{x}")).toContain("<m:rad>");
    expect(toOmml("x^{2}")).toContain("<m:sSup>");
    expect(toOmml("\\sum_{i=1}^{n} i")).toContain("<m:nary>");
    expect(toOmml("\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}")).toContain("<m:m>");
    expect(toOmml("\\hat{x}")).toContain("<m:acc>");
  });

  it("reads equations typed in Word (no KaTeX involved)", () => {
    const word = `<m:oMath ${OMML_NS}><m:f><m:num><m:r><m:t>1</m:t></m:r></m:num><m:den><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:den></m:f><m:r><m:t>≤</m:t></m:r><m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr><m:sub><m:r><m:t>k</m:t></m:r></m:sub><m:sup><m:r><m:t>n</m:t></m:r></m:sup><m:e><m:r><m:t>k</m:t></m:r></m:e></m:nary></m:oMath>`;
    const latex = fromOmml(word);
    expect(latex).toContain("\\frac{1}{x^{2}}");
    expect(latex).toContain("\\leq");
    expect(latex).toContain("\\sum_{k}^{n}");
  });
});

describe("MathML -> LaTeX (foreign editors)", () => {
  it.each(FORMULAS)("round-trips %s through KaTeX MathML", (latex) => {
    const back = mathmlToLatex(parseMathml(latexToMathml(latex)).documentElement);
    expect(signature(back)).toEqual(signature(latex));
  });
  it("handles StarMath-style MathML written by LibreOffice", () => {
    const lo = `<math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mfrac><mrow><mi>a</mi></mrow><mrow><mi>b</mi></mrow></mfrac><mo stretchy="false">+</mo><msqrt><mi>x</mi></msqrt></mrow><annotation encoding="StarMath 5.0">{a} over {b} + sqrt {x}</annotation></semantics></math>`;
    expect(mathmlToLatex(parseMathml(lo).documentElement)).toBe("\\frac{a}{b} + \\sqrt{x}");
  });
});
