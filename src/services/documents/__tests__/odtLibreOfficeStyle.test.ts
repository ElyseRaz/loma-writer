import JSZip from "jszip";
import { beforeAll, describe, expect, it } from "vitest";
import { setConverter } from "../converter";
import { exportOdt } from "../odtExport";
import { importDocx } from "../docxImport";
import { importOdt } from "../odtImport";
import { gridWidths } from "../tableGrid";
import { nodeConverter } from "./lo";

beforeAll(() => setConverter(nodeConverter));

const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:loext="urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0"';

/** A small ODT as LibreOffice writes them: headings numbered by a list style, a table in a text box, plain heading styles. */
async function libreOfficeLike(body: string, styles = ""): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("mimetype", "application/vnd.oasis.opendocument.text", { compression: "STORE" });
  zip.file("META-INF/manifest.xml", '<?xml version="1.0"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/></manifest:manifest>');
  zip.file("styles.xml", `<?xml version="1.0"?><office:document-styles ${NS}><office:styles>
    <style:default-style style:family="paragraph"><style:text-properties fo:font-size="12pt"/></style:default-style>
    <style:style style:name="Standard" style:family="paragraph"/>
    <style:style style:name="Heading_20_1" style:display-name="Heading 1" style:family="paragraph" style:parent-style-name="Standard"><style:text-properties fo:font-size="20pt" fo:font-weight="bold"/></style:style>
    <style:style style:name="Text_20_body" style:display-name="Text body" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-bottom="0.247cm"/></style:style>
    <text:list-style style:name="WWNum6">
      <text:list-level-style-number text:level="1" loext:num-list-format="PARTIE %1% :" style:num-prefix="PARTIE " style:num-suffix=" :" style:num-format="I"><style:list-level-properties><style:list-level-label-alignment text:label-followed-by="space"/></style:list-level-properties></text:list-level-style-number>
      <text:list-level-style-number text:level="2" loext:num-list-format="Chapitre %2%:" style:num-prefix="Chapitre " style:num-suffix=":" style:num-format="1"><style:list-level-properties><style:list-level-label-alignment text:label-followed-by="space"/></style:list-level-properties></text:list-level-style-number>
      <text:list-level-style-number text:level="3" loext:num-list-format="%2%.%3%." style:num-suffix="." style:num-format="1" text:display-levels="2"><style:list-level-properties><style:list-level-label-alignment text:label-followed-by="space"/></style:list-level-properties></text:list-level-style-number>
    </text:list-style>${styles}</office:styles></office:document-styles>`);
  zip.file("content.xml", `<?xml version="1.0"?><office:document-content ${NS}><office:automatic-styles>
    <style:style style:name="Tbl" style:family="table"><style:table-properties style:width="10cm"/></style:style>
    <style:style style:name="Tbl.A" style:family="table-column"><style:table-column-properties style:column-width="2cm"/></style:style>
    <style:style style:name="Tbl.B" style:family="table-column"><style:table-column-properties style:column-width="3cm"/></style:style>
    <style:style style:name="Tbl.C" style:family="table-column"><style:table-column-properties style:column-width="5cm"/></style:style>
  </office:automatic-styles><office:body><office:text>${body}</office:text></office:body></office:document-content>`);
  return zip.generateAsync({ type: "uint8array" });
}

type N = { type: string; attrs?: Record<string, unknown>; content?: N[]; text?: string };
const walk = (n: N, f: (n: N) => void) => { f(n); n.content?.forEach((c) => walk(c, f)); };
const text = (n: N): string => n.text ?? (n.content ?? []).map(text).join("");
const nodes = (m: unknown, type: string) => { const out: N[] = []; walk((m as { content: N }).content, (n) => { if (n.type === type) out.push(n); }); return out; };

const item = (inner: string) => `<text:list-item>${inner}</text:list-item>`;
const numbered = (level: number, title: string, cont = true) => {
  // headings sit in nested lists: the outer items only hold the inner list
  let s = `<text:h text:outline-level="${level}">${title}</text:h>`;
  for (let d = level; d >= 1; d--) s = `<text:list${d === 1 ? ` text:style-name="WWNum6"${cont ? ' text:continue-numbering="true"' : ""}` : ""}>${item(s)}</text:list>`;
  return s;
};

describe("ODT written by LibreOffice", () => {
  it("writes the number that a list style gives to a heading in front of it", async () => {
    const { model } = await importOdt(await libreOfficeLike(numbered(2, "Présentation", false) + numbered(3, "Contexte") + numbered(3, "Objectifs") + numbered(2, "Analyse") + numbered(3, "Besoins")));
    expect(nodes(model, "heading").map(text)).toEqual(["Chapitre 1: Présentation", "1.1. Contexte", "1.2. Objectifs", "Chapitre 2: Analyse", "2.1. Besoins"]);
    expect(nodes(model, "orderedList")).toHaveLength(0);
  });

  it("takes a heading as the file defines it (black, size of the style), not as Loma Writer draws its own", async () => {
    const { model } = await importOdt(await libreOfficeLike('<text:h text:style-name="Heading_20_1" text:outline-level="1">Titre</text:h>'));
    const h1 = (model as { styles?: Record<string, Record<string, unknown>> }).styles?.h1;
    expect(h1?.color).toBe("#000000");
    expect(h1?.sizePt).toBe(20);
    expect(h1?.spaceAfter).toBe(0);
  });

  it("keeps the spacing of a named body style (Text body)", async () => {
    const { model } = await importOdt(await libreOfficeLike('<text:p text:style-name="Text_20_body">Un</text:p>'));
    const p = nodes(model, "paragraph")[0];
    expect(Number(p.attrs?.spaceAfter)).toBeGreaterThan(6);
  });

  it("puts a table held by a text box in the text", async () => {
    const table = '<table:table table:style-name="Tbl"><table:table-column table:style-name="Tbl.A"/><table:table-column table:style-name="Tbl.B"/><table:table-row><table:table-cell><text:p>a</text:p></table:table-cell><table:table-cell><text:p>b</text:p></table:table-cell></table:table-row></table:table>';
    const { model } = await importOdt(await libreOfficeLike(`<text:p><draw:frame text:anchor-type="paragraph" svg:width="10cm" svg:height="2cm"><draw:text-box>${table}</draw:text-box></draw:frame></text:p><text:p>après</text:p>`));
    expect(nodes(model, "table")).toHaveLength(1);
    expect(nodes(model, "shape")).toHaveLength(0);
    expect(nodes(model, "paragraph").map(text)).toContain("après");
  });

  it("an index without a title gets none", async () => {
    const toc = '<text:table-of-content><text:index-body><text:p text:style-name="Contents_20_1">Un<text:tab/>1</text:p></text:index-body></text:table-of-content>';
    const { model } = await importOdt(await libreOfficeLike(toc));
    expect(nodes(model, "tableOfContents")[0].attrs?.title).toBe("");
  });

  it("writes the real shape and wraps its text, and the widths of a table whose first row spans columns", async () => {
    const m = { content: { type: "doc", content: [
      { type: "shape", attrs: { kind: "roundRect", width: 200, height: 80, fill: "#ffffff", stroke: "#000c48", strokeWidth: 3, gradient: null, shadow: null, rotation: 0, alt: "", z: 0, align: "left", wrap: "inline", anchor: "paragraph", x: 0, y: 0 }, content: [{ type: "paragraph", content: [{ type: "text", text: "T" }] }] },
      { type: "table", content: [
        { type: "tableRow", content: [{ type: "tableCell", attrs: { colspan: 2, rowspan: 1, colwidth: [60, 100] }, content: [{ type: "paragraph" }] }] },
        { type: "tableRow", content: [{ type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: [60] }, content: [{ type: "paragraph" }] }, { type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: [100] }, content: [{ type: "paragraph" }] }] },
      ] },
    ] }, page: { size: "A4", orientation: "portrait", margins: "normal" } } as never;
    const zip = await JSZip.loadAsync((await exportOdt(m)).bytes);
    const xml = await zip.file("content.xml")!.async("string");
    expect(xml).toContain('draw:type="round-rectangle"');
    expect(xml).toContain('fo:wrap-option="wrap"');
    expect((xml.match(/style:family="table-column"/g) ?? []).length).toBe(2);
  });
});

describe("gridWidths", () => {
  it("reads every row and the row spans", () => {
    const cell = (colspan: number, rowspan: number, colwidth?: number[]) => ({ type: "tableCell", attrs: { colspan, rowspan, ...(colwidth ? { colwidth } : {}) }, content: [] });
    const rows = [{ type: "tableRow", content: [cell(1, 2, [50]), cell(2, 1, [30, 40])] }, { type: "tableRow", content: [cell(1, 1, [30]), cell(1, 1, [40])] }];
    expect(gridWidths(rows as never, 3)).toEqual([50, 30, 40]);
    expect(gridWidths([{ type: "tableRow", content: [cell(1, 1)] }] as never, 1)).toBeNull();
  });
});

describe("DOCX written by Word", () => {
  it("writes the number of a numbered heading in front of it", async () => {
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const zip = new JSZip();
    zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file("word/numbering.xml", `<?xml version="1.0"?><w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="Chapitre %1 :"/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`);
    zip.file("word/styles.xml", `<?xml version="1.0"?><w:styles ${W}><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>`);
    const h = (style: string, lvl: number, t: string) => `<w:p><w:pPr><w:pStyle w:val="${style}"/><w:numPr><w:ilvl w:val="${lvl}"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
    zip.file("word/document.xml", `<?xml version="1.0"?><w:document ${W}><w:body>${h("Heading1", 0, "Intro")}${h("Heading2", 1, "Contexte")}${h("Heading2", 1, "But")}${h("Heading1", 0, "Analyse")}${h("Heading2", 1, "Besoins")}</w:body></w:document>`);
    const { model } = await importDocx(await zip.generateAsync({ type: "uint8array" }));
    expect(nodes(model, "heading").map(text)).toEqual(["Chapitre 1 : Intro", "1.1 Contexte", "1.2 But", "Chapitre 2 : Analyse", "2.1 Besoins"]);
  });
});
