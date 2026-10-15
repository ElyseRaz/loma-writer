import JSZip from "jszip";
import { beforeEach, describe, expect, it } from "vitest";
import { setConverter } from "../converter";
import { exportDocx } from "../docxExport";
import { exportOdt } from "../odtExport";
import { DocumentError, openDocumentBytes, saveDocument, type FileIO } from "../index";
import { richModel } from "./fixtures";
import { missingConverter } from "./lo";

const bytes = (s: string) => new TextEncoder().encode(s);
const code = async (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof DocumentError ? e.code : `other:${e}`));

describe("invalid files", () => {
  beforeEach(() => setConverter(missingConverter));

  it("rejects an empty file", async () => expect(await code(openDocumentBytes(new Uint8Array(), "a.docx"))).toBe("corrupt"));
  it("rejects a truncated DOCX", async () => {
    const { bytes: ok } = await exportDocx(richModel());
    expect(await code(openDocumentBytes(ok.subarray(0, 200), "a.docx"))).toBe("corrupt");
  });
  it("rejects plain text named .docx / .doc / .odt", async () => {
    for (const ext of ["docx", "doc", "odt"]) expect(await code(openDocumentBytes(bytes("simple texte"), `a.${ext}`))).toBe("corrupt");
  });
  it("rejects a ZIP that is not a document", async () => {
    const zip = new JSZip();
    zip.file("hello.txt", "x");
    expect(await code(openDocumentBytes(await zip.generateAsync({ type: "uint8array" }), "a.docx"))).toBe("unsupported");
  });
  it("rejects a DOCX without document.xml and one with broken XML", async () => {
    const empty = new JSZip(); empty.file("word/styles.xml", "<x/>");
    expect(await code(openDocumentBytes(await empty.generateAsync({ type: "uint8array" }), "a.docx"))).toBe("unsupported");
    const broken = await JSZip.loadAsync((await exportDocx(richModel())).bytes);
    broken.file("word/document.xml", "<w:document><w:body>");
    expect(await code(openDocumentBytes(await broken.generateAsync({ type: "uint8array" }), "a.docx"))).toBe("corrupt");
  });
  it("rejects images, PDF, RTF and spreadsheets", async () => {
    expect(await code(openDocumentBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), "a.docx"))).toBe("unsupported");
    expect(await code(openDocumentBytes(bytes("%PDF-1.7"), "a.pdf"))).toBe("unsupported");
    expect(await code(openDocumentBytes(bytes("{\\rtf1 hello}"), "a.rtf"))).toBe("unsupported");
    const xlsx = new JSZip(); xlsx.file("xl/workbook.xml", "<x/>");
    expect(await code(openDocumentBytes(await xlsx.generateAsync({ type: "uint8array" }), "a.xlsx"))).toBe("unsupported");
  });
  it("never shows unreadable content as an empty document", async () => {
    const zip = await JSZip.loadAsync((await exportDocx(richModel())).bytes);
    const xml = await zip.file("word/document.xml")!.async("string");
    zip.file("word/document.xml", xml.replace(/<w:body>[\s\S]*<\/w:body>/, "<w:body><w:unknownWrapper><w:p><w:r><w:t>Texte réel</w:t></w:r></w:p></w:unknownWrapper></w:body>"));
    expect(await code(openDocumentBytes(await zip.generateAsync({ type: "uint8array" }), "a.docx"))).toBe("unreadable-content");
  });
  it("opens by real content when the extension is wrong, and says so", async () => {
    const odt = (await exportOdt(richModel())).bytes;
    const opened = await openDocumentBytes(odt, "faux.docx");
    expect(opened.format).toBe("odt");
    expect(opened.warnings[0]).toMatch(/extension \.docx ne correspond pas/);
    const docx = (await exportDocx(richModel())).bytes;
    expect((await openDocumentBytes(docx, "faux.odt")).format).toBe("docx");
  });
  it("explains that LibreOffice is required for .doc when it is missing", async () => {
    const doc = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    expect(await code(openDocumentBytes(doc, "a.doc"))).toBe("converter-missing");
  });
  it("imports HTML and text as text, not as a failure", async () => {
    expect((await openDocumentBytes(bytes("<html><body><p>x</p></body></html>"), "a.html")).html).toContain("<p>x</p>");
    expect((await openDocumentBytes(bytes("ligne 1\n\nligne 2"), "a.md")).html).toBe("<p>ligne 1</p><p>ligne 2</p>");
  });
});

describe("saving never destroys an existing document", () => {
  it("does not write anything when the export fails", async () => {
    setConverter(missingConverter);
    const written: string[] = [];
    const io: FileIO = { readBytes: async () => new Uint8Array(), writeBytes: async (p) => { written.push(p); } };
    expect(await code(saveDocument(io, "/tmp/a.doc", "doc", richModel()))).toBe("converter-missing");
    expect(written).toEqual([]);
  });
  it("propagates a write failure so the caller keeps the document dirty", async () => {
    const io: FileIO = { readBytes: async () => new Uint8Array(), writeBytes: async () => { throw new Error("disque plein"); } };
    await expect(saveDocument(io, "/tmp/a.docx", "docx", richModel())).rejects.toThrow("disque plein");
  });
  it("writes bytes that re-open to the same content in every non-DOC format", async () => {
    const files = new Map<string, Uint8Array>();
    const io: FileIO = { readBytes: async (p) => files.get(p)!, writeBytes: async (p, b) => { files.set(p, b); } };
    for (const f of ["docx", "odt", "loma"] as const) {
      await saveDocument(io, `/tmp/x.${f}`, f, richModel());
      const opened = await openDocumentBytes(files.get(`/tmp/x.${f}`)!, `/tmp/x.${f}`);
      expect(opened.format).toBe(f);
      expect(opened.warnings).toEqual([]);
      expect(JSON.stringify(opened.model.content)).toContain("Fin du document.");
    }
  });
});
