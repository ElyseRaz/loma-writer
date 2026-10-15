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

  get size() {
    return this.items.size;
  }

  /** `asRun` placeholders are replaced by whole runs (`w:r`), the others by their content directly in the paragraph. */
  async apply(bytes: Uint8Array): Promise<Uint8Array> {
    if (!this.items.size) return bytes;
    const zip = await JSZip.loadAsync(bytes);
    let xml = await zip.file("word/document.xml")!.async("string");
    for (const [key, raw] of this.items) {
      const run = new RegExp(`<w:r>(?:<w:rPr>[\\s\\S]*?</w:rPr>)?<w:t(?: [^>]*)?>${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</w:t></w:r>`);
      xml = xml.replace(run, () => raw);
    }
    zip.file("word/document.xml", xml);
    return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  }
}
