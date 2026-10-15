import { esc, kids } from "../documents/xml";
import { FUNCTION_NAMES, NARY_CHARS, OVERLINE_CHARS, stripInvisible } from "./symbols";

/** MathML -> OMML (Word's native equation format), for the subset KaTeX produces. */
const run = (text: string, opts: { upright?: boolean; plain?: boolean } = {}) =>
  `<m:r>${opts.plain ? "<m:rPr><m:nor/></m:rPr>" : opts.upright ? '<m:rPr><m:sty m:val="p"/></m:rPr>' : ""}<m:t xml:space="preserve">${esc(text)}</m:t></m:r>`;

const isOp = (el: Element | undefined, chars?: Set<string>) => !!el && el.localName === "mo" && (!chars || chars.has((el.textContent ?? "").trim()));
const text = (el: Element) => stripInvisible(el.textContent ?? "").trim();
/** Function name carried by an element ("sin", or a row holding "lim" and the invisible apply operator). */
const functionName = (el: Element | undefined): string | null => {
  if (!el) return null;
  const inner = el.localName === "mrow" ? children(el).filter((k) => text(k)) : [el];
  return inner.length === 1 && inner[0].localName === "mi" && FUNCTION_NAMES.has(text(inner[0])) ? text(inner[0]) : null;
};

function children(el: Element): Element[] {
  return kids(el).filter((k) => k.localName !== "annotation" && k.localName !== "annotation-xml");
}

/** Converts a sequence of sibling MathML elements, folding "∑ …" and "∫ …" with what follows them. */
function sequence(nodes: Element[]): string {
  let out = "";
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const naryBase = (n.localName === "munderover" || n.localName === "msubsup" || n.localName === "munder" || n.localName === "msub" || n.localName === "mover" || n.localName === "msup") && isOp(children(n)[0], NARY_CHARS);
    if (naryBase || isOp(n, NARY_CHARS)) {
      const parts = naryBase ? children(n) : [n];
      const chr = text(parts[0]);
      let sub = "";
      let sup = "";
      if (naryBase) {
        const t = n.localName;
        if (t === "munderover" || t === "msubsup") { sub = convert(parts[1]); sup = convert(parts[2]); }
        else if (t === "munder" || t === "msub") sub = convert(parts[1]);
        else sup = convert(parts[1]);
      }
      const body = sequence(nodes.slice(i + 1));
      const loc = chr === "∑" || chr === "∏" || chr === "⋃" || chr === "⋂" ? "undOvr" : "subSup";
      out += `<m:nary><m:naryPr><m:chr m:val="${esc(chr)}"/><m:limLoc m:val="${loc}"/>${sub ? "" : '<m:subHide m:val="1"/>'}${sup ? "" : '<m:supHide m:val="1"/>'}</m:naryPr><m:sub>${sub}</m:sub><m:sup>${sup}</m:sup><m:e>${body}</m:e></m:nary>`;
      return out;
    }
    // sin x, lim_{x→0} f(x): a function object with its argument(s).
    const fname = functionName(n);
    const limit = (n.localName === "msub" || n.localName === "munder") && functionName(children(n)[0]) ? n : null;
    if (fname || limit) {
      const name = fname ?? functionName(children(limit!)[0])!;
      const nameRun = run(name, { upright: true });
      const fn = limit ? `<m:limLow><m:e>${nameRun}</m:e><m:lim>${convert(children(limit)[1])}</m:lim></m:limLow>` : nameRun;
      let next = i + 1;
      while (isOp(nodes[next]) && !text(nodes[next])) next++; // invisible function application
      const body = limit ? sequence(nodes.slice(next)) : nodes[next] ? convert(nodes[next]) : "";
      out += `<m:func><m:fName>${fn}</m:fName><m:e>${body}</m:e></m:func>`;
      if (limit) return out;
      i = next;
      continue;
    }
    out += convert(n);
  }
  return out;
}

function convert(el: Element | undefined): string {
  if (!el) return "";
  const c = children(el);
  switch (el.localName) {
    case "math": case "semantics": case "mstyle": case "mpadded": case "mphantom": case "mrow": {
      // A fenced group: \left( … \right) becomes a delimiter object.
      if (el.localName === "mrow" && c.length >= 2 && isOp(c[0]) && isOp(c[c.length - 1]) && c[0].getAttribute("fence") === "true" && c[c.length - 1].getAttribute("fence") === "true") {
        const [open, close] = [text(c[0]), text(c[c.length - 1])];
        return `<m:d><m:dPr><m:begChr m:val="${esc(open)}"/><m:endChr m:val="${esc(close)}"/></m:dPr><m:e>${sequence(c.slice(1, -1))}</m:e></m:d>`;
      }
      return sequence(el.localName === "semantics" ? c.slice(0, 1) : c);
    }
    case "mi": { const t = text(el); return run(t, { upright: t.length > 1 || el.getAttribute("mathvariant") === "normal" }); }
    case "mn": return run(text(el));
    case "mo": return run(text(el));
    case "mtext": return run(el.textContent ?? "", { plain: true });
    case "mspace": return run(" ");
    case "mfrac": return `<m:f><m:num>${convert(c[0])}</m:num><m:den>${convert(c[1])}</m:den></m:f>`;
    case "msqrt": return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${sequence(c)}</m:e></m:rad>`;
    case "mroot": return `<m:rad><m:deg>${convert(c[1])}</m:deg><m:e>${convert(c[0])}</m:e></m:rad>`;
    case "msup": return `<m:sSup><m:e>${convert(c[0])}</m:e><m:sup>${convert(c[1])}</m:sup></m:sSup>`;
    case "msub": return `<m:sSub><m:e>${convert(c[0])}</m:e><m:sub>${convert(c[1])}</m:sub></m:sSub>`;
    case "msubsup": return `<m:sSubSup><m:e>${convert(c[0])}</m:e><m:sub>${convert(c[1])}</m:sub><m:sup>${convert(c[2])}</m:sup></m:sSubSup>`;
    case "mover":
      if (el.getAttribute("accent") === "true" && isOp(c[1]) && OVERLINE_CHARS.has(text(c[1]))) return `<m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e>${sequence([c[0]])}</m:e></m:bar>`;
      if (el.getAttribute("accent") === "true" && isOp(c[1])) return `<m:acc><m:accPr><m:chr m:val="${esc(text(c[1]))}"/></m:accPr><m:e>${sequence([c[0]])}</m:e></m:acc>`;
      return `<m:limUpp><m:e>${convert(c[0])}</m:e><m:lim>${convert(c[1])}</m:lim></m:limUpp>`;
    case "munder":
      if (el.getAttribute("accentunder") === "true" && isOp(c[1]) && OVERLINE_CHARS.has(text(c[1]))) return `<m:bar><m:barPr><m:pos m:val="bot"/></m:barPr><m:e>${sequence([c[0]])}</m:e></m:bar>`;
      return `<m:limLow><m:e>${convert(c[0])}</m:e><m:lim>${convert(c[1])}</m:lim></m:limLow>`;
    case "munderover": return `<m:limUpp><m:e><m:limLow><m:e>${convert(c[0])}</m:e><m:lim>${convert(c[1])}</m:lim></m:limLow></m:e><m:lim>${convert(c[2])}</m:lim></m:limUpp>`;
    case "mtable": return `<m:m>${children(el).map((row) => `<m:mr>${children(row).map((cell) => `<m:e>${sequence(children(cell))}</m:e>`).join("")}</m:mr>`).join("")}</m:m>`;
    case "mfenced": {
      const open = el.getAttribute("open") ?? "(";
      const close = el.getAttribute("close") ?? ")";
      return `<m:d><m:dPr><m:begChr m:val="${esc(open)}"/><m:endChr m:val="${esc(close)}"/></m:dPr>${c.map((x) => `<m:e>${convert(x)}</m:e>`).join("")}</m:d>`;
    }
    default: return sequence(c);
  }
}

/** The OMML of a whole formula, as an `m:oMath` element. */
export function mathmlElementToOmml(math: Element): string {
  return `<m:oMath>${convert(math)}</m:oMath>`;
}
