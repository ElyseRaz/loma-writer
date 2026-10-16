import JSZip from "jszip";

/**
 * The `docx` library cannot write some DrawingML/OMML objects (equations, shapes). They are exported as
 * placeholder runs and replaced here by the real XML, in the main document part.
 */
export class RawXml {
  private items = new Map<string, string>();

  /** Registers raw XML (an `m:oMath`, or a `w:r` holding a drawing) and returns the placeholder text for a run. */
  add(kind: string, xml: string): string {
    const key = `@@${kind}:${this.items.size}@@`;
    this.items.set(key, xml);
    return key;
  }

  /** Registers raw XML made of whole paragraphs (`w:p`), put in place of the paragraph that holds the returned placeholder text. */
  addBlock(kind: string, xml: string): string {
    const key = `@@${kind}:${this.items.size}@@`;
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
      const run = new RegExp(`<w:r>(?:<w:rPr>[\\s\\S]*?</w:rPr>)?<w:t(?: [^>]*)?>${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</w:t></w:r>`);
      xml = xml.replace(run, () => raw);
    }
    zip.file("word/document.xml", xml);
    return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  }
}

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Endnotes: the `docx` library writes footnotes only. This adds the part `word/endnotes.xml` (with the two separator notes Word
 * requires), its relationship and content type, and the `w:endnotePr` of the settings.
 */
export async function addEndnotes(bytes: Uint8Array, notes: string[]): Promise<Uint8Array> {
  if (!notes.length) return bytes;
  const zip = await JSZip.loadAsync(bytes);
  const body = notes.map((t, i) => `<w:endnote w:id="${i + 1}"><w:p><w:pPr><w:pStyle w:val="EndnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="EndnoteReference"/></w:rPr><w:endnoteRef/></w:r><w:r><w:t xml:space="preserve"> ${xmlEsc(t)}</w:t></w:r></w:p></w:endnote>`).join("");
  const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  zip.file("word/endnotes.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:endnotes ${ns}><w:endnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:endnote><w:endnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:endnote>${body}</w:endnotes>`);
  const types = await zip.file("[Content_Types].xml")!.async("string");
  if (!types.includes("/word/endnotes.xml")) zip.file("[Content_Types].xml", types.replace("</Types>", '<Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/></Types>'));
  const relsPath = "word/_rels/document.xml.rels";
  const rels = await zip.file(relsPath)!.async("string");
  if (!rels.includes("relationships/endnotes")) zip.file(relsPath, rels.replace("</Relationships>", '<Relationship Id="rIdLomaEndnotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes" Target="endnotes.xml"/></Relationships>'));
  const settings = await zip.file("word/settings.xml")?.async("string");
  if (settings && !settings.includes("w:endnotePr")) {
    const pr = '<w:endnotePr><w:endnote w:id="-1"/><w:endnote w:id="0"/></w:endnotePr>';
    // schema order: after footnotePr when there is one, else before the compatibility settings
    const patched = /<w:footnotePr>[\s\S]*?<\/w:footnotePr>/.test(settings) ? settings.replace(/(<w:footnotePr>[\s\S]*?<\/w:footnotePr>)/, `$1${pr}`) : /<w:compat[ >]/.test(settings) ? settings.replace(/(<w:compat[ >])/, `${pr}$1`) : settings.replace(/<\/w:settings>/, `${pr}</w:settings>`);
    zip.file("word/settings.xml", patched);
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
