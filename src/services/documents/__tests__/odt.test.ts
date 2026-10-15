import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { exportOdt, ODT_MIME } from "../odtExport";
import { importOdt } from "../odtImport";
import { contentFromTemplate, templateOf } from "../../../pagination/headerFooter";
import { flatten, headerFooterSample, PNG_1x1, richHeaderFooter, richModel } from "./fixtures";

describe("ODT", () => {
  it("round trip keeps structure, text, formatting, merged cells and page", async () => {
    const model = richModel();
    const { bytes } = await exportOdt(model);
    const { model: back, warnings } = await importOdt(bytes);
    expect(warnings).toEqual([]);
    expect(flatten(back.content)).toEqual(flatten(model.content));
    expect(back.page).toEqual(model.page);
  });

  it("writes a valid package: mimetype first and stored, manifest lists pictures", async () => {
    const { bytes } = await exportOdt(richModel());
    expect(new TextDecoder().decode(bytes.subarray(30, 38))).toBe("mimetype");
    const zip = await JSZip.loadAsync(bytes);
    expect(await zip.file("mimetype")!.async("string")).toBe(ODT_MIME);
    expect(await zip.file("META-INF/manifest.xml")!.async("string")).toContain("Pictures/image1.png");
  });

  it.each([
    { size: "A4", orientation: "landscape", margins: "narrow" },
    { size: "Letter", orientation: "portrait", margins: "wide" },
  ] as const)("keeps page setup %j", async (page) => {
    const { model: back } = await importOdt((await exportOdt({ ...richModel(), page })).bytes);
    expect(back.page).toEqual(page);
  });

  it("keeps custom margins exactly, in centimetres", async () => {
    const page = { size: "A4", orientation: "portrait", margins: "custom", customMarginsCm: { top: 3, right: 1.5, bottom: 2, left: 4 } } as const;
    const { model: back } = await importOdt((await exportOdt({ ...richModel(), page })).bytes);
    expect(back.page.margins).toBe("custom");
    for (const side of ["top", "right", "bottom", "left"] as const) expect(back.page.customMarginsCm![side]).toBeCloseTo(page.customMarginsCm[side], 1);
  });

  it("reads a page break set on the following paragraph (as LibreOffice and Word write it)", async () => {
    const { bytes } = await exportOdt(richModel());
    const zip = await JSZip.loadAsync(bytes);
    const content = await zip.file("content.xml")!.async("string");
    zip.file("content.xml", content.replace("</office:automatic-styles>", '<style:style style:name="PB" style:family="paragraph"><style:paragraph-properties fo:break-before="page"/></style:style></office:automatic-styles>').replace("</office:text>", '<text:p text:style-name="PB">Nouvelle page</text:p></office:text>'));
    const { model } = await importOdt(await zip.generateAsync({ type: "uint8array" }));
    const last = model.content.content!.at(-1)!;
    expect(last.attrs?.pageBreakBefore).toBe(true); // the paragraph option, not a separate break
    expect(flatten(model.content).slice(-2).map((b) => b.type)).toEqual(["pageBreak", "paragraph"]);
  });

  it("keeps image data and size", async () => {
    const { model: back } = await importOdt((await exportOdt(richModel())).bytes);
    const para = back.content.content!.find((n) => n.content?.some((c) => c.type === "image"))!;
    expect(para.content!.find((c) => c.type === "image")!.attrs).toMatchObject({ src: PNG_1x1, width: 40, height: 40 });
  });

  it("preserves runs of spaces and tabs", async () => {
    const model = richModel();
    model.content.content = [{ type: "paragraph", content: [{ type: "text", text: "a   b\tc" }] }];
    const { model: back } = await importOdt((await exportOdt(model)).bytes);
    expect(back.content.content![0].content![0].text).toBe("a   b\tc");
  });

  it("reads a header, and reports footnotes it cannot keep", async () => {
    const { bytes } = await exportOdt(richModel());
    const zip = await JSZip.loadAsync(bytes);
    const content = await zip.file("content.xml")!.async("string");
    zip.file("content.xml", content.replace("</office:text>", '<text:p><text:note text:note-class="footnote"><text:note-body><text:p>n</text:p></text:note-body></text:note></text:p></office:text>').replace("</office:automatic-styles>", '<style:style style:name="PB" style:family="paragraph"><style:paragraph-properties fo:break-before="page"/></style:style></office:automatic-styles>').replace("</office:text>", '<text:p text:style-name="PB">x</text:p></office:text>'));
    const styles = await zip.file("styles.xml")!.async("string");
    zip.file("styles.xml", styles.replace('<style:master-page style:name="Standard" style:page-layout-name="pm1"></style:master-page>', '<style:master-page style:name="Standard" style:page-layout-name="pm1"><style:header><text:p>En-tête</text:p></style:header></style:master-page>'));
    const { warnings, model } = await importOdt(await zip.generateAsync({ type: "uint8array" }));
    const all = warnings.join("\n");
    expect(all).toMatch(/Notes de bas de page/);
    expect(templateOf(model.headerFooter?.header.default?.blocks)).toBe("En-tête");
  });

  it("keeps headers and footers with page-number fields, first page and odd/even variants", async () => {
    const hf = headerFooterSample();
    const { model: back, warnings } = await importOdt((await exportOdt({ ...richModel(), headerFooter: hf })).bytes);
    expect(back.headerFooter).toEqual(hf);
    expect(warnings.join()).not.toMatch(/En-têtes/);
    const evenOdd = { header: { default: contentFromTemplate("Impaire"), even: contentFromTemplate("Paire", "right") }, footer: { default: contentFromTemplate("{PAGE}", "center"), even: contentFromTemplate("{PAGE}", "center") }, titlePage: false, evenOdd: true };
    const again = await importOdt((await exportOdt({ ...richModel(), headerFooter: evenOdd })).bytes);
    expect(again.model.headerFooter).toEqual(evenOdd);
  });

  it("writes no header or footer when there is none", async () => {
    const { model: back } = await importOdt((await exportOdt(richModel())).bytes);
    expect(back.headerFooter).toBeUndefined();
  });

  it("keeps bookmarks, cross-references and equations", async () => {
    const exported = await exportOdt(richModel());
    const { model: back } = await importOdt(exported.bytes);
    const text = JSON.stringify(back.content);
    expect(text).toContain('"type":"bookmark","attrs":{"name":"Intro"}');
    expect(text).toContain('"href":"#Intro"');
    expect(text).toContain('"type":"equation","attrs":{"latex":"E=mc^{2}"}');
    expect(exported.warnings.join("\n")).not.toMatch(/Équations/); // a real equation object now
  });

  it("keeps shapes and text boxes as editable shapes (not pictures, not tables)", async () => {
    const exported = await exportOdt(richModel());
    expect(exported.warnings.join()).not.toMatch(/Zones de texte|tableaux/);
    const { model: back } = await importOdt(exported.bytes);
    const shapes = (back.content.content ?? []).filter((n) => n.type === "shape");
    expect(shapes.map((s) => s.attrs!.kind)).toEqual(["roundRect", "textbox", "star5", "line", "cloud", "rect", "star5"]);
    expect(shapes[0].attrs).toMatchObject({ width: 200, height: 80, fill: "#bbf7d0", stroke: "#16a34a" });
    expect(JSON.stringify(shapes[0].content)).toContain("Dans la forme");
    expect(shapes[2].attrs).toMatchObject({ fill: "none", stroke: "#dc2626" });
  });

  it("embeds equations as MathML formula objects", async () => {
    const { bytes } = await exportOdt(richModel());
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files)).toContain("Object 1/content.xml");
    expect(await zip.file("Object 1/content.xml")!.async("string")).toContain("<math");
    expect(await zip.file("META-INF/manifest.xml")!.async("string")).toContain("application/vnd.oasis.opendocument.formula");
  });

  it("keeps a rich header: several lines, formatting, an image, a table and page-number fields", async () => {
    const hf = richHeaderFooter();
    const { model: back, warnings } = await importOdt((await exportOdt({ ...richModel(), headerFooter: hf })).bytes);
    const blocks = back.headerFooter!.header.default!.blocks;
    const json = JSON.stringify(blocks);
    expect(warnings.join()).not.toMatch(/première ligne/);
    expect(blocks.filter((b) => b.type === "paragraph").length).toBeGreaterThanOrEqual(3);
    expect(json).toContain("Société Loma");
    expect(json).toContain('"type":"bold"');
    expect(json).toContain("Rapport annuel — confidentiel");
    expect(json).toContain(PNG_1x1);
    const table = blocks.find((b) => b.type === "table")!;
    expect(table.content![0].content).toHaveLength(3);
    expect(JSON.stringify(table)).toContain('"type":"pageField"');
    expect(templateOf(table.content![0].content![2].content)).toBe("Page {PAGE}");
    expect(templateOf(back.headerFooter!.footer.default!.blocks)).toBe("Page {PAGE} sur {PAGES}");
  });
});
