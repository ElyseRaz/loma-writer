import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { exportDocx } from "../docxExport";
import { importDocx } from "../docxImport";
import { contentFromTemplate, templateOf } from "../../../pagination/headerFooter";
import { flatten, headerFooterSample, PNG_1x1, richHeaderFooter, richModel } from "./fixtures";

describe("DOCX", () => {
  it("round trip keeps structure, text, formatting, merged cells and page", async () => {
    const model = richModel();
    const { bytes } = await exportDocx(model);
    const { model: back, warnings } = await importDocx(bytes);
    expect(warnings).toEqual([]);
    expect(flatten(back.content)).toEqual(flatten(model.content));
    expect(back.page).toEqual(model.page);
  });

  it.each([
    { size: "A4", orientation: "landscape", margins: "narrow" },
    { size: "Letter", orientation: "portrait", margins: "wide" },
    { size: "A5", orientation: "portrait", margins: "normal" },
  ] as const)("keeps page setup %j", async (page) => {
    const model = { ...richModel(), page };
    const { model: back, warnings } = await importDocx((await exportDocx(model)).bytes);
    expect(back.page).toEqual(page);
    expect(warnings).toEqual([]);
  });

  it("keeps custom margins exactly, in centimetres", async () => {
    const page = { size: "A4", orientation: "portrait", margins: "custom", customMarginsCm: { top: 3, right: 1.5, bottom: 2, left: 4 } } as const;
    const { model: back, warnings } = await importDocx((await exportDocx({ ...richModel(), page })).bytes);
    expect(warnings).toEqual([]);
    expect(back.page.margins).toBe("custom");
    for (const side of ["top", "right", "bottom", "left"] as const) expect(back.page.customMarginsCm![side]).toBeCloseTo(page.customMarginsCm[side], 1);
  });

  it("splits a paragraph at a page break written inside a run", async () => {
    const { bytes } = await exportDocx(richModel());
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file("word/document.xml")!.async("string");
    zip.file("word/document.xml", xml.replace("</w:body>", '<w:p><w:r><w:t>avant</w:t></w:r><w:r><w:br w:type="page"/></w:r><w:r><w:t>après</w:t></w:r></w:p></w:body>'));
    const { model, warnings } = await importDocx(await zip.generateAsync({ type: "uint8array" }));
    const tail = flatten(model.content).slice(-3);
    expect(tail.map((b) => b.type)).toEqual(["paragraph", "pageBreak", "paragraph"]);
    expect(tail[0].runs![0].text).toBe("avant");
    expect(tail[2].runs![0].text).toBe("après");
    expect(warnings.join()).not.toMatch(/Sauts de page/);
  });

  it("keeps image data and size, line breaks and line spacing", async () => {
    const model = richModel();
    model.content.content!.push({
      type: "paragraph",
      content: [
        { type: "text", text: "a", marks: [{ type: "textStyle", attrs: { lineHeight: "2" } }] },
        { type: "hardBreak" },
        { type: "text", text: "b", marks: [{ type: "textStyle", attrs: { lineHeight: "2" } }] },
      ],
    });
    const { model: back } = await importDocx((await exportDocx(model)).bytes);
    const para = back.content.content!.find((n) => n.type === "paragraph" && n.content?.some((c) => c.type === "image"))!;
    const image = para.content!.find((c) => c.type === "image")!;
    expect(image.attrs).toMatchObject({ src: PNG_1x1, width: 40, height: 40 });
    expect(flatten(back.content).at(-1)).toEqual(flatten(model.content).at(-1));
  });

  it("reports unsupported content instead of dropping it silently", async () => {
    const { bytes } = await exportDocx(richModel());
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file("word/document.xml")!.async("string");
    zip.file("word/document.xml", xml.replace("</w:body>", '<w:p><w:r><w:br w:type="page"/></w:r><w:r><w:footnoteReference w:id="2"/></w:r></w:p></w:body>'));
    const { warnings } = await importDocx(await zip.generateAsync({ type: "uint8array" }));
    expect(warnings.join("\n")).toMatch(/Notes de bas de page/);
  });

  it("reads a non-standard paper size as a custom size and keeps odd margins exactly", async () => {
    const { bytes } = await exportDocx(richModel());
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file("word/document.xml")!.async("string");
    zip.file("word/document.xml", xml.replace(/<w:pgSz[^>]*\/>/, '<w:pgSz w:w="9000" w:h="13000"/>').replace(/<w:pgMar[^>]*\/>/, '<w:pgMar w:top="2400" w:left="2400" w:right="2400" w:bottom="2400"/>'));
    const { warnings, model } = await importDocx(await zip.generateAsync({ type: "uint8array" }));
    expect(warnings.join("\n")).not.toMatch(/Format de page/);
    expect(model.page.size).toBe("Custom");
    expect(model.page.customSizeCm?.width).toBeCloseTo(15.88, 1);
    expect(model.page.customSizeCm?.height).toBeCloseTo(22.93, 1);
    expect(model.page.margins).toBe("custom"); // margins are kept exactly, never rounded
  });

  it("keeps headers and footers with page-number fields, first page and odd/even variants", async () => {
    const hf = headerFooterSample();
    const { model: back, warnings } = await importDocx((await exportDocx({ ...richModel(), headerFooter: hf })).bytes);
    expect(back.headerFooter).toEqual(hf);
    expect(warnings.join()).not.toMatch(/En-têtes/);
    const evenOdd = { header: { default: contentFromTemplate("Impaire"), even: contentFromTemplate("Paire", "right") }, footer: { default: contentFromTemplate("{PAGE}", "center"), even: contentFromTemplate("{PAGE}", "center") }, titlePage: false, evenOdd: true };
    const again = await importDocx((await exportDocx({ ...richModel(), headerFooter: evenOdd })).bytes);
    expect(again.model.headerFooter).toEqual(evenOdd);
  });

  it("writes no header or footer when there is none", async () => {
    const { model: back } = await importDocx((await exportDocx(richModel())).bytes);
    expect(back.headerFooter).toBeUndefined();
  });

  it("keeps bookmarks, cross-references and equations", async () => {
    const exported = await exportDocx(richModel());
    const { model: back } = await importDocx(exported.bytes);
    const text = JSON.stringify(back.content);
    expect(text).toContain('"type":"bookmark","attrs":{"name":"Intro"}');
    expect(text).toContain('"href":"#Intro"');
    expect(text).toContain('"type":"equation","attrs":{"latex":"E=mc^{2}"}');
    expect(exported.warnings.join("\n")).not.toMatch(/Équations/); // a real equation object now
  });

  it("keeps shapes and text boxes as editable shapes (not pictures, not tables)", async () => {
    const exported = await exportDocx(richModel());
    expect(exported.warnings.join()).not.toMatch(/Zones de texte|tableaux/);
    const { model: back } = await importDocx(exported.bytes);
    const shapes = (back.content.content ?? []).filter((n) => n.type === "shape");
    expect(shapes.map((s) => s.attrs!.kind)).toEqual(["roundRect", "textbox", "star5", "line", "cloud", "rect", "star5"]);
    expect(shapes[0].attrs).toMatchObject({ width: 200, height: 80, fill: "#bbf7d0", stroke: "#16a34a" });
    expect(JSON.stringify(shapes[0].content)).toContain("Dans la forme");
    expect(shapes[2].attrs).toMatchObject({ fill: "none", stroke: "#dc2626" });
  });

  it("writes a native Word equation (OMML), not text", async () => {
    const { bytes } = await exportDocx(richModel());
    const xml = await (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("string");
    expect(xml).toContain("<m:oMath>");
    expect(xml).not.toContain("@@MATH");
    expect(xml).not.toContain("\\(E=mc");
  });

  it("reads an equation typed in Word", async () => {
    const { bytes } = await exportDocx(richModel());
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file("word/document.xml")!.async("string");
    const word = '<w:p><m:oMath><m:f><m:num><m:r><m:t>1</m:t></m:r></m:num><m:den><m:r><m:t>2</m:t></m:r></m:den></m:f></m:oMath></w:p>';
    zip.file("word/document.xml", xml.replace("</w:body>", word + "</w:body>"));
    const { model } = await importDocx(await zip.generateAsync({ type: "uint8array" }));
    expect(JSON.stringify(model.content)).toContain('"latex":"\\\\frac{1}{2}"');
  });

  it("keeps a rich header: several lines, formatting, an image, a table and page-number fields", async () => {
    const hf = richHeaderFooter();
    const { model: back, warnings } = await importDocx((await exportDocx({ ...richModel(), headerFooter: hf })).bytes);
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
