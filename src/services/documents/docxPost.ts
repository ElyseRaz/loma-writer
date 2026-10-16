import JSZip from "jszip";

/**
 * The `docx` library cannot write some DrawingML/OMML objects (equations, shapes). They are exported as
 * placeholder runs and replaced here by the real XML, in the main document part.
 */
export class RawXml {
  private items = new Map<string, string>();
  /** A random part of every marker, so that text typed by the user can never be mistaken for one. */
  private nonce = Math.random().toString(36).slice(2, 10);

  /** Registers raw XML (an `m:oMath`, or a `w:r` holding a drawing) and returns the placeholder text for a run. */
  add(kind: string, xml: string): string {
    const key = `@@${this.nonce}${kind}:${this.items.size}@@`;
    this.items.set(key, xml);
    return key;
  }

  /** Registers raw XML made of whole paragraphs (`w:p`), put in place of the paragraph that holds the returned placeholder text. */
  addBlock(kind: string, xml: string): string {
    const key = `@@${this.nonce}${kind}:${this.items.size}@@`;
    this.items.set(key, xml);
    this.blocks.add(key);
    return key;
  }

  private blocks = new Set<string>();

  get size() {
    return this.items.size;
  }

  /** `asRun` placeholders are replaced by whole runs (`w:r`), the others by their content directly in the paragraph. */
  async apply(bytes: Uint8Array): Promise<Uint8Array> {
    if (!this.items.size) return bytes;
    const zip = await JSZip.loadAsync(bytes);
    let xml = await zip.file("word/document.xml")!.async("string");
    for (const [key, raw] of this.items) {
      const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (this.blocks.has(key)) { xml = xml.replace(new RegExp(`<w:p(?: [^>]*)?>(?:(?!</w:p>)[\\s\\S])*?${esc}(?:(?!</w:p>)[\\s\\S])*?</w:p>`), () => raw); continue; }
      const run = new RegExp(`<w:r>(?:<w:rPr>(?:(?!</w:rPr>)[\\s\\S])*</w:rPr>)?<w:t(?: [^>]*)?>${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</w:t></w:r>`);
      xml = xml.replace(run, () => raw);
    }
    zip.file("word/document.xml", xml);
    return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  }
}

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

import type { NoteParagraph } from "../../editor/references/noteBody";
import { type NoteNumbering, type NotesOptions } from "../../editor/references/notesNumbering";

const NUM_FMT: Record<string, string> = { decimal: "decimal", lowerRoman: "lowerRoman", upperRoman: "upperRoman", lowerLetter: "lowerLetter", upperLetter: "upperLetter", symbols: "chicago" };
const RESTART: Record<string, string> = { continuous: "continuous", section: "eachSect", page: "eachPage" };
const numberingXml = (o: NoteNumbering) => `<w:numFmt w:val="${NUM_FMT[o.format]}"/><w:numStart w:val="${o.start}"/><w:numRestart w:val="${RESTART[o.restart]}"/>`;

/** The runs of a note paragraph (the formatting of the text kept). */
function noteRuns(p: NoteParagraph): string {
  return p.content.map((c) => {
    if (c.type === "hardBreak") return "<w:r><w:br/></w:r>";
    const m = new Set((c.marks ?? []).map((x) => x.type));
    const rPr = `${m.has("bold") ? "<w:b/>" : ""}${m.has("italic") ? "<w:i/>" : ""}${m.has("underline") || m.has("link") ? '<w:u w:val="single"/>' : ""}${m.has("strike") ? "<w:strike/>" : ""}${m.has("subscript") ? '<w:vertAlign w:val="subscript"/>' : m.has("superscript") ? '<w:vertAlign w:val="superscript"/>' : ""}`;
    return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${xmlEsc(c.text ?? "")}</w:t></w:r>`;
  }).join("");
}

/**
 * Notes of the document: the `docx` library writes footnotes only. This adds the part `word/endnotes.xml` (with the two separator notes
 * Word requires), its relationship and content type, and writes the numbering options (format, first number, restart) and the
 * `w:endnotePr` in the settings.
 */
export async function addEndnotes(bytes: Uint8Array, notes: NoteParagraph[][], options?: NotesOptions): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  if (notes.length) {
    const body = notes.map((paras, i) => `<w:endnote w:id="${i + 1}">${(paras.length ? paras : [{ type: "paragraph" as const, content: [] }]).map((p, k) => `<w:p><w:pPr><w:pStyle w:val="EndnoteText"/></w:pPr>${k === 0 ? '<w:r><w:rPr><w:rStyle w:val="EndnoteReference"/></w:rPr><w:endnoteRef/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>' : ""}${noteRuns(p)}</w:p>`).join("")}</w:endnote>`).join("");
    const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    zip.file("word/endnotes.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:endnotes ${ns}><w:endnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:endnote><w:endnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:endnote>${body}</w:endnotes>`);
    const types = await zip.file("[Content_Types].xml")!.async("string");
    if (!types.includes("/word/endnotes.xml")) zip.file("[Content_Types].xml", types.replace("</Types>", '<Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/></Types>'));
    const relsPath = "word/_rels/document.xml.rels";
    const rels = await zip.file(relsPath)!.async("string");
    if (!rels.includes("relationships/endnotes")) zip.file(relsPath, rels.replace("</Relationships>", '<Relationship Id="rIdLomaEndnotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes" Target="endnotes.xml"/></Relationships>'));
  }
  // Word writes the separators of the notes with a bare separator run (the library adds a note reference to them).
  const footnotesXml = await zip.file("word/footnotes.xml")?.async("string");
  if (footnotesXml) {
    const clean = footnotesXml.replace(/(<w:footnote [^>]*w:type="(?:separator|continuationSeparator)"[^>]*>)([\s\S]*?)(<\/w:footnote>)/g, (_m, a: string, b: string, c: string) => `${a}${b.replace(/<w:r><w:rPr><w:rStyle w:val="FootnoteReference"\/><\/w:rPr><w:footnoteRef\/><\/w:r>/g, "").replace(/<w:pPr>[\s\S]*?<\/w:pPr>/, "")}${c}`);
    if (clean !== footnotesXml) zip.file("word/footnotes.xml", clean);
  }
  const settings = await zip.file("word/settings.xml")?.async("string");
  if (settings) {
    let patched = settings;
    // footnotes: the numbering goes before the separator references that the library wrote
    if (options && /<w:footnotePr>/.test(patched)) {
      patched = patched.replace(/<w:footnotePr>([\s\S]*?)<\/w:footnotePr>/, (_m, inner: string) => {
        const refs = inner.match(/<w:footnote [^>]*\/>/g)?.join("") ?? "";
        const pos = inner.match(/<w:pos [^>]*\/>/)?.[0] ?? "";
        return `<w:footnotePr>${pos}${numberingXml(options.foot)}${refs}</w:footnotePr>`;
      });
    }
    // footnotePr (when the library wrote none) and endnotePr, in schema order, before the settings that follow them
    const hasFootnotes = !!zip.file("word/footnotes.xml");
    const fp = options && hasFootnotes && !/<w:footnotePr>/.test(patched) ? `<w:footnotePr>${numberingXml(options.foot)}<w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>` : "";
    const ep = notes.length && !patched.includes("w:endnotePr") ? `<w:endnotePr>${options ? numberingXml(options.end) : ""}<w:endnote w:id="-1"/><w:endnote w:id="0"/></w:endnotePr>` : "";
    if (fp || ep) {
      if (!fp && /<w:footnotePr>[\s\S]*?<\/w:footnotePr>/.test(patched)) patched = patched.replace(/(<w:footnotePr>[\s\S]*?<\/w:footnotePr>)/, `$1${ep}`);
      else {
        const after = ["w:compat", "w:docVars", "w:rsids", "m:mathPr", "w:attachedSchema", "w:themeFontLang", "w:clrSchemeMapping", "w:doNotIncludeSubdocsInStats", "w:decimalSymbol", "w:listSeparator"].find((t) => new RegExp(`<${t}[ >/]`).test(patched));
        patched = after ? patched.replace(new RegExp(`(<${after}[ >/])`), `${fp}${ep}$1`) : patched.replace(/<\/w:settings>/, `${fp}${ep}</w:settings>`);
      }
    }
    if (patched !== settings) zip.file("word/settings.xml", patched);
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
