import { beforeAll, describe, expect, it } from "vitest";
import { docAdapter } from "../docAdapter";
import { setConverter } from "../converter";
import { exportDocx } from "../docxExport";
import { importDocx } from "../docxImport";
import { exportOdt } from "../odtExport";
import { importOdt } from "../odtImport";
import { plainText } from "../pm";
import { templateOf } from "../../../pagination/headerFooter";
import { flatten, headerFooterSample, richHeaderFooter, richModel } from "./fixtures";
import { latexToMathml, parseMathml } from "../../math/mathml";
import { hasLibreOffice, hasLibreOfficeMath, libreOffice, nodeConverter } from "./lo";

/** Structure without formatting marks: what must survive a trip through a foreign implementation. */
/** Floating objects have no reading order of their own: other writers list them by z-order, so runs of them are sorted. */
const sortObjects = <T extends { type: string; kids?: number }>(list: T[]) => {
  const out: T[] = [];
  for (let i = 0; i < list.length; ) {
    const obj = (b: T) => b.type === "shape" || b.type === "group";
    if (!obj(list[i])) { out.push(list[i++]); continue; }
    const run: T[] = [];
    while (i < list.length && obj(list[i])) run.push(list[i++]);
    out.push(...run.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  }
  return out;
};

const skeleton = (doc: ReturnType<typeof richModel>["content"]) =>
  sortObjects(flatten(doc)
    .filter((b) => !(b.type === "paragraph" && !b.runs?.some((r) => r.text.trim())))
    .map((b) => ({ type: b.type, level: b.level, text: b.runs?.map((r) => r.text.replace(/\[equation:[^\]]*\]/g, "")).join(""), kids: b.children?.length })));

describe.skipIf(!hasLibreOffice)("interoperability with LibreOffice (independent implementation)", () => {
  beforeAll(() => setConverter(nodeConverter));

  it("LibreOffice reads our DOCX: all text is present", async () => {
    const txt = new TextDecoder().decode(libreOffice((await exportDocx(richModel())).bytes, "docx", "txt"));
    for (const s of ["Rapport de stage", "Puce A", "Sous-puce A1", "Deuxième.un", "Cellule fusionnée", "Une citation importante.", "let x = 1;", "Fin du document."]) expect(txt).toContain(s);
  });

  it("LibreOffice reads our ODT: all text is present", async () => {
    const txt = new TextDecoder().decode(libreOffice((await exportOdt(richModel())).bytes, "odt", "txt"));
    for (const s of ["Rapport de stage", "Puce A", "Sous-puce A1", "Deuxième.un", "Cellule fusionnée", "Une citation importante.", "let x = 1;", "Fin du document."]) expect(txt).toContain(s);
  });

  describe("sections", () => {
    const P = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
    const sectioned = () => ({
      content: { type: "doc", content: [P("Un"), { type: "sectionBreak", attrs: { page: { size: "A4", orientation: "landscape", margins: "narrow" }, hf: null } }, P("Deux"), { type: "sectionBreak", attrs: { page: { size: "Letter", orientation: "portrait", margins: "normal" }, hf: null } }, P("Trois")] },
      page: { size: "A4", orientation: "portrait", margins: "normal" },
    }) as never;
    const shape = (m: { content: { content?: Array<{ type?: string; attrs?: Record<string, unknown> }> }; page: { size: string; orientation: string } }) => [
      `${m.page.size}/${m.page.orientation}`,
      ...(m.content.content ?? []).filter((n) => n.type === "sectionBreak").map((n) => `${(n.attrs?.page as { size: string }).size}/${(n.attrs?.page as { orientation: string }).orientation}`),
    ];
    const want = ["A4/portrait", "A4/landscape", "Letter/portrait"];
    it("our DOCX -> LibreOffice -> ODT -> our importer keeps the sections", async () => {
      const odt = libreOffice((await exportDocx(sectioned())).bytes, "docx", "odt");
      const { model } = await importOdt(odt);
      expect(shape(model as never)).toEqual(want);
      expect(plainText(model.content)).toContain("Trois");
    });
    it("our ODT -> LibreOffice -> DOCX -> our importer keeps the sections", async () => {
      const docx = libreOffice((await exportOdt(sectioned())).bytes, "odt", "docx");
      const { model } = await importDocx(docx);
      expect(shape(model as never)).toEqual(want);
    });
    const cont = () => ({
      content: { type: "doc", content: [P("Un"), { type: "sectionBreak", attrs: { page: { size: "A4", orientation: "portrait", margins: "normal", columns: { count: 2, gapCm: 1.25, line: false } }, hf: null, kind: "continuous" } }, P("Deux"), { type: "sectionBreak", attrs: { page: { size: "A4", orientation: "portrait", margins: "normal" }, hf: null, kind: "continuous" } }, P("Trois")] },
      page: { size: "A4", orientation: "portrait", margins: "normal" },
    }) as never;
    const colsOf = (m: { content: { content?: Array<{ type?: string; attrs?: Record<string, unknown> }> } }) => (m.content.content ?? []).filter((n) => n.type === "sectionBreak").map((n) => `${n.attrs?.kind ?? "nextPage"}:${(n.attrs?.page as { columns?: { count: number } }).columns?.count ?? 1}`);
    it("our DOCX -> LibreOffice -> ODT -> our importer keeps continuous breaks and columns", async () => {
      const { model } = await importOdt(libreOffice((await exportDocx(cont())).bytes, "docx", "odt"));
      expect(colsOf(model as never)).toEqual(["continuous:2", "continuous:1"]);
    });
    it("our ODT -> LibreOffice -> DOCX -> our importer keeps continuous breaks and columns", async () => {
      const { model } = await importDocx(libreOffice((await exportOdt(cont())).bytes, "odt", "docx"));
      expect(colsOf(model as never)).toEqual(["continuous:2", "continuous:1"]);
    });
  });

  it("our ODT -> LibreOffice -> DOCX -> our importer keeps the document skeleton", async () => {
    const model = richModel();
    const docx = libreOffice((await exportOdt(model)).bytes, "odt", "docx");
    const { model: back } = await importDocx(docx);
    expect(skeleton(back.content)).toEqual(skeleton(model.content));
    // Inline formatting produced by a foreign writer is still understood.
    const para = back.content.content![1];
    const marks = (t: string) => para.content!.find((c) => c.text === t)?.marks?.map((m) => m.type);
    expect(marks("gras")).toContain("bold");
    expect(marks("italique")).toContain("italic");
    expect(marks("souligné")).toContain("underline");
    expect(back.page).toEqual(model.page);
  });

  it("our DOCX -> LibreOffice -> ODT -> our importer keeps the document skeleton", async () => {
    const model = richModel();
    const odt = libreOffice((await exportDocx(model)).bytes, "docx", "odt");
    const { model: back } = await importOdt(odt);
    expect(skeleton(back.content)).toEqual(skeleton(model.content));
    // LibreOffice understood our DrawingML shapes: their text and geometry reach the ODT.
    const shapes = JSON.stringify(back.content.content!.filter((n) => n.type === "shape"));
    expect(shapes).toContain("Dans la forme");
    expect(shapes).toContain("Ligne 1 de la zone");
    // (LibreOffice has no separate text-box object: it writes a text box back as a rectangle holding text.)
    expect(back.content.content!.filter((n) => n.type === "shape").map((n) => n.attrs!.kind)).toEqual(expect.arrayContaining(["roundRect", "star5", "line"]));
    expect(back.page).toEqual(model.page);
  });

  it("DOC: export produces a real Word 97 file that re-imports with the same content", async () => {
    const model = richModel();
    const { bytes } = await docAdapter.export(model);
    expect([...bytes.subarray(0, 4)]).toEqual([0xd0, 0xcf, 0x11, 0xe0]);
    const { model: back, warnings } = await docAdapter.import(bytes);
    expect(warnings[0]).toMatch(/converti par LibreOffice/);
    // The legacy binary format stores drawings in its own layer: LibreOffice may split or merge shapes and their
    // text, so shapes are checked separately from the document skeleton.
    const noShapes = (d: typeof model.content) => skeleton(d).filter((b) => b.type !== "shape");
    expect(noShapes(back.content)).toEqual(noShapes(model.content));
    expect(skeleton(back.content).some((b) => b.type === "shape")).toBe(true);
    expect(plainText(back.content)).toContain("Fin du document.");
    expect(back.page).toEqual(model.page);
  });

  it("imports a header and footer (with a page-number field) written by LibreOffice, and reports footnotes", async () => {
    const odt = (await exportOdt(richModel())).bytes;
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(odt);
    const content = await zip.file("content.xml")!.async("string");
    zip.file("content.xml", content.replace("</office:text>", '<text:p>Avec note<text:note text:note-class="footnote"><text:note-citation>1</text:note-citation><text:note-body><text:p>La note</text:p></text:note-body></text:note></text:p></office:text>'));
    const styles = await zip.file("styles.xml")!.async("string");
    zip.file("styles.xml", styles.replace('<style:master-page style:name="Standard" style:page-layout-name="pm1"></style:master-page>', '<style:master-page style:name="Standard" style:page-layout-name="pm1"><style:header><text:p>Mon en-tête</text:p></style:header><style:footer><text:p>Page <text:page-number/></text:p></style:footer></style:master-page>'));
    const withExtras = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    const { warnings, model } = await importDocx(libreOffice(withExtras, "odt", "docx"));
    const all = warnings.join("\n");
    expect(all).toMatch(/Notes de bas de page/);
    expect(templateOf(model.headerFooter?.header.default?.blocks)).toBe("Mon en-tête");
    expect(templateOf(model.headerFooter?.footer.default?.blocks)).toBe("Page {PAGE}");
    expect(plainText(model.content)).toContain("Avec note");
  });

  it("headers and footers survive our ODT -> LibreOffice -> DOCX -> our importer", async () => {
    const hf = headerFooterSample();
    const odt = (await exportOdt({ ...richModel(), headerFooter: hf })).bytes;
    const { model } = await importDocx(libreOffice(odt, "odt", "docx"));
    expect(templateOf(model.headerFooter?.header.default?.blocks)).toBe("Rapport — confidentiel");
    expect(templateOf(model.headerFooter?.footer.default?.blocks)).toBe("Page {PAGE} sur {PAGES}");
    expect(model.headerFooter?.titlePage).toBe(true);
  });

  it("headers and footers survive our DOCX -> LibreOffice -> ODT -> our importer", async () => {
    const hf = headerFooterSample();
    const docx = (await exportDocx({ ...richModel(), headerFooter: hf })).bytes;
    const { model } = await importOdt(libreOffice(docx, "docx", "odt"));
    expect(templateOf(model.headerFooter?.header.default?.blocks)).toBe("Rapport — confidentiel");
    expect(templateOf(model.headerFooter?.footer.default?.blocks)).toBe("Page {PAGE} sur {PAGES}");
  });

  it("bookmarks and cross-references survive a trip through LibreOffice", async () => {
    const docx = libreOffice((await exportOdt(richModel())).bytes, "odt", "docx");
    const text = JSON.stringify((await importDocx(docx)).model.content);
    expect(text).toContain('"name":"Intro"');
    expect(text).toContain('"href":"#Intro"');
  });

  it.skipIf(!hasLibreOfficeMath)("a native Word equation survives LibreOffice (OMML -> formula object -> LaTeX)", async () => {
    const formula = "\\frac{a}{b}+\\sqrt{x}";
    const sig = (latex: string) => parseMathml(latexToMathml(latex)).documentElement.textContent!.replace(/\s|\u2061|\u2062/g, "").replace(new RegExp(latex.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "");
    const model = richModel();
    model.content.content = [{ type: "paragraph", content: [{ type: "text", text: "Formule " }, { type: "equation", attrs: { latex: formula } }] }];
    const odt = libreOffice((await exportDocx(model)).bytes, "docx", "odt");
    const { model: back } = await importOdt(odt);
    const eq = back.content.content![0].content!.find((n) => n.type === "equation");
    expect(eq).toBeTruthy();
    const normal = (l: string) => parseMathml(latexToMathml(l)).documentElement.textContent!.replace(/\s|\u2061|\u2062/g, "");
    expect(normal(String(eq!.attrs!.latex))).toBe(normal(formula));
    void sig;
  });

  it("a rich header (lines, image, table, page number) survives our ODT -> LibreOffice -> DOCX", async () => {
    const odt = (await exportOdt({ ...richModel(), headerFooter: richHeaderFooter() })).bytes;
    const { model } = await importDocx(libreOffice(odt, "odt", "docx"));
    const json = JSON.stringify(model.headerFooter?.header.default?.blocks);
    expect(json).toContain("Société Loma");
    expect(json).toContain("Rapport annuel — confidentiel");
    expect(json).toContain('"type":"image"');
    expect(json).toContain('"type":"table"');
    expect(json).toContain('"type":"pageField"');
  });

  it("a rich header survives our DOCX -> LibreOffice -> ODT", async () => {
    const docx = (await exportDocx({ ...richModel(), headerFooter: richHeaderFooter() })).bytes;
    const { model } = await importOdt(libreOffice(docx, "docx", "odt"));
    const json = JSON.stringify(model.headerFooter?.header.default?.blocks);
    expect(json).toContain("Société Loma");
    expect(json).toContain("Rapport annuel — confidentiel");
    expect(json).toContain('"type":"image"');
    expect(json).toContain('"type":"table"');
    expect(json).toContain('"type":"pageField"');
  });
});
