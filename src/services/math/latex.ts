import { kids } from "../documents/xml";
import { ACCENT_TO_LATEX, charToLatex, delimToLatex, FUNCTION_NAMES, NARY_CHARS, OVERLINE_CHARS, stripInvisible, SYMBOL_TO_LATEX } from "./symbols";

/** OMML (Word) and generic MathML -> LaTeX, the format Loma Writer stores formulas in. */

const group = (raw: string) => { const s = raw.trim(); return s.length <= 1 || /^\\[A-Za-z]+$/.test(s) ? s : `{${s}}`; };
const braces = (s: string) => `{${s}}`;
const el = (parent: Element, name: string) => kids(parent).find((k) => k.localName === name);
const val = (e: Element | undefined, prop: string) => (e ? kids(e).find((k) => k.localName === prop)?.getAttribute("m:val") ?? null : null);

// ---------------------------------------------------------------- OMML
function omml(node: Element): string {
  const inner = (name: string) => seq(el(node, name));
  switch (node.localName) {
    case "r": {
      const t = kids(node).filter((k) => k.localName === "t").map((k) => k.textContent ?? "").join("");
      const rPr = el(node, "rPr");
      if (rPr && el(rPr, "nor")) return `\\text{${t}}`;
      if (FUNCTION_NAMES.has(t)) return `\\${t} `;
      if (rPr && val(rPr, "sty") === "p" && t.length > 1) return `\\mathrm{${t}}`;
      return charToLatex(t);
    }
    case "f": return `\\frac${braces(inner("num"))}${braces(inner("den"))}`;
    case "rad": {
      const deg = inner("deg").trim();
      const hidden = el(node, "radPr") && val(el(node, "radPr"), "degHide") === "1";
      return deg && !hidden ? `\\sqrt[${deg}]${braces(inner("e"))}` : `\\sqrt${braces(inner("e"))}`;
    }
    case "sSup": return `${group(inner("e"))}^${braces(inner("sup"))}`;
    case "sSub": return `${group(inner("e"))}_${braces(inner("sub"))}`;
    case "sSubSup": return `${group(inner("e"))}_${braces(inner("sub"))}^${braces(inner("sup"))}`;
    case "nary": {
      const chr = val(el(node, "naryPr"), "chr") ?? "∫";
      const cmd = (SYMBOL_TO_LATEX[chr] ?? "\\int").trim();
      const sub = inner("sub").trim();
      const sup = inner("sup").trim();
      return `${cmd}${sub ? `_${braces(sub)}` : ""}${sup ? `^${braces(sup)}` : ""} ${inner("e")}`;
    }
    case "d": {
      const pr = el(node, "dPr");
      const beg = pr ? val(pr, "begChr") : "(";
      const end = pr ? val(pr, "endChr") : ")";
      const sep = (pr && val(pr, "sepChr")) ?? "|";
      const parts = kids(node).filter((k) => k.localName === "e").map((e) => seq(e));
      return `\\left${delimToLatex(pr && el(pr, "begChr") ? beg : pr ? null : "(")}${parts.join(sep === "|" && parts.length > 1 ? "\\mid " : sep)}\\right${delimToLatex(pr && el(pr, "endChr") ? end : pr ? null : ")")}`;
    }
    case "m": return `\\begin{matrix}${kids(node).filter((k) => k.localName === "mr").map((row) => kids(row).filter((k) => k.localName === "e").map((cell) => seq(cell)).join(" & ")).join(" \\\\ ")}\\end{matrix}`;
    case "func": return `${inner("fName").trim()} ${inner("e")}`;
    case "acc": {
      const chr = val(el(node, "accPr"), "chr") ?? "^";
      return `${ACCENT_TO_LATEX[chr] ?? "\\hat"}${braces(inner("e"))}`;
    }
    case "bar": return val(el(node, "barPr"), "pos") === "bot" ? `\\underline${braces(inner("e"))}` : `\\overline${braces(inner("e"))}`;
    case "limLow": {
      const base = inner("e").trim();
      const fn = /^\\([a-z]+)$/.exec(base);
      return fn && FUNCTION_NAMES.has(fn[1]) ? `${base}_${braces(inner("lim"))}` : `\\underset${braces(inner("lim"))}${braces(inner("e"))}`;
    }
    case "limUpp": return `\\overset${braces(inner("lim"))}${braces(inner("e"))}`;
    case "eqArr": return `\\begin{aligned}${kids(node).filter((k) => k.localName === "e").map((e) => seq(e)).join(" \\\\ ")}\\end{aligned}`;
    case "oMath": case "oMathPara": case "e": case "num": case "den": case "deg": case "sub": case "sup": case "lim": case "fName": case "box": case "borderBox": case "groupChr": case "phant":
      return seq(node);
    default: return "";
  }
}

const PR = new Set(["rPr", "ctrlPr", "fPr", "radPr", "naryPr", "dPr", "accPr", "barPr", "mPr", "sSupPr", "sSubPr", "sSubSupPr", "limLowPr", "limUppPr", "funcPr", "eqArrPr", "boxPr", "borderBoxPr", "groupChrPr", "phantPr"]);
function seq(parent: Element | undefined): string {
  return parent ? kids(parent).filter((k) => !PR.has(k.localName)).map(omml).join("") : "";
}

/** LaTeX for an `m:oMath` element. */
export function ommlToLatex(oMath: Element): string {
  return omml(oMath).replace(/\s+/g, " ").replace(/\s*(\\\\|&)\s*/g, " $1 ").trim();
}

// ---------------------------------------------------------------- MathML
function mml(node: Element | undefined): string {
  if (!node) return "";
  const c = kids(node).filter((k) => k.localName !== "annotation" && k.localName !== "annotation-xml");
  const t = stripInvisible(node.textContent ?? "").trim();
  switch (node.localName) {
    case "mi": return t.length > 1 && FUNCTION_NAMES.has(t) ? `\\${t} ` : t.length > 1 && node.getAttribute("mathvariant") === "normal" ? `\\mathrm{${t}}` : charToLatex(t);
    case "mn": return t;
    case "mo": return charToLatex(stripInvisible(t));
    case "mtext": return `\\text{${node.textContent ?? ""}}`;
    case "mspace": return "\\ ";
    case "mfrac": return `\\frac${braces(mml(c[0]))}${braces(mml(c[1]))}`;
    case "msqrt": return `\\sqrt${braces(c.map(mml).join(""))}`;
    case "mroot": return `\\sqrt[${mml(c[1])}]${braces(mml(c[0]))}`;
    case "msup": return `${group(mml(c[0]))}^${braces(mml(c[1]))}`;
    case "msub": return `${group(mml(c[0]))}_${braces(mml(c[1]))}`;
    case "msubsup": case "munderover": return `${group(mml(c[0]))}_${braces(mml(c[1]))}^${braces(mml(c[2]))}`;
    case "munder": return NARY_CHARS.has((c[0]?.textContent ?? "").trim()) || c[0]?.localName === "mo" ? `${mml(c[0])}_${braces(mml(c[1]))}` : `\\underset${braces(mml(c[1]))}${braces(mml(c[0]))}`;
    case "mover": {
      if (node.getAttribute("accent") === "true") {
        const ch = stripInvisible(c[1]?.textContent ?? "").trim();
        if (OVERLINE_CHARS.has(ch)) return `\\overline${braces(mml(c[0]))}`;
        const cmd = ACCENT_TO_LATEX[ch];
        if (cmd) return `${cmd}${braces(mml(c[0]))}`;
      }
      return NARY_CHARS.has((c[0]?.textContent ?? "").trim()) ? `${mml(c[0])}^${braces(mml(c[1]))}` : `\\overset${braces(mml(c[1]))}${braces(mml(c[0]))}`;
    }
    case "mtable": return `\\begin{matrix}${c.map((row) => kids(row).map((cell) => kids(cell).map(mml).join("")).join(" & ")).join(" \\\\ ")}\\end{matrix}`;
    case "mfenced": return `\\left${delimToLatex(node.getAttribute("open") ?? "(")}${c.map(mml).join(node.getAttribute("separators") ?? ",")}\\right${delimToLatex(node.getAttribute("close") ?? ")")}`;
    case "mrow": {
      // "sin" + invisible apply operator is just the function name.
      if (c.length >= 1 && c.every((k, i) => (i === 0 ? k.localName === "mi" : k.localName === "mo" && !stripInvisible(k.textContent ?? "").trim())) && FUNCTION_NAMES.has((c[0].textContent ?? "").trim())) return `\\${(c[0].textContent ?? "").trim()}`;
      const first = c[0];
      const last = c[c.length - 1];
      if (c.length >= 2 && first?.localName === "mo" && last?.localName === "mo" && first.getAttribute("fence") === "true" && last.getAttribute("fence") === "true")
        return `\\left${delimToLatex((first.textContent ?? "").trim())}${c.slice(1, -1).map(mml).join(" ")}\\right${delimToLatex((last.textContent ?? "").trim())}`;
      return c.map(mml).join(" ").replace(/\s+/g, " ");
    }
    case "semantics": return mml(c[0]);
    default: return c.map(mml).join(" ");
  }
}

/** LaTeX for a MathML `math` element. */
export function mathmlToLatex(math: Element): string {
  return mml(math).replace(/\s+/g, " ").trim();
}
