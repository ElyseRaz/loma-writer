import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { exportDocx } from "../../services/documents/docxExport";
import { importDocx } from "../../services/documents/docxImport";
import { exportOdt } from "../../services/documents/odtExport";
import { importOdt } from "../../services/documents/odtImport";
import { sanitizePage } from "../../services/documents/sanitize";
import type { DocumentModel } from "../../services/documents/types";
import { pageGeometry } from "../../pagination/model";
import { MARGIN_PRESETS, PAPER_SIZES, effectiveMarginsCm, fitMargins, marginsPx, pageDimensions, validatePage } from "../page";
import { DEFAULT_PAGE, type PageSetup } from "../types";

const doc = (page: PageSetup): DocumentModel => ({ content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Texte" }] }] }, page });
const cm = (px: number) => px / (96 / 2.54);

describe("paper sizes and margin presets", () => {
  it("lists the sizes of the specification in portrait", () => {
    const by = Object.fromEntries(PAPER_SIZES.map((p) => [p.id, [p.width, p.height]]));
    expect(by.A0).toEqual([84.1, 118.9]);
    expect(by.A4).toEqual([21, 29.7]);
    expect(by.Letter).toEqual([21.59, 27.94]);
    expect(by.Tabloid).toEqual([27.94, 43.18]);
    expect(PAPER_SIZES).toHaveLength(12);
  });
  it("converts centimetres to the 96 dpi px of the layout (A4 = 794 × 1123)", () => {
    expect(pageDimensions(DEFAULT_PAGE)).toEqual({ w: 794, h: 1123 });
    expect(pageDimensions({ ...DEFAULT_PAGE, orientation: "landscape" })).toEqual({ w: 1123, h: 794 });
    expect(pageDimensions({ size: "Custom", customSizeCm: { width: 10, height: 20 }, orientation: "portrait", margins: "normal" })).toEqual({ w: 378, h: 756 });
  });
  it("has the five margin presets", () => {
    const by = Object.fromEntries(MARGIN_PRESETS.map((m) => [m.id, m.cm]));
    expect(by.normal).toEqual({ top: 2.54, bottom: 2.54, left: 2.54, right: 2.54 });
    expect(by.narrow.left).toBe(1.27);
    expect(by.moderate).toEqual({ top: 2.54, bottom: 2.54, left: 1.91, right: 1.91 });
    expect(by.wide.left).toBe(5.08);
    expect(by.mirrored.left).toBe(3.18); // inner
    expect(by.mirrored.right).toBe(2.54); // outer
  });
  it("adds the binding margin to its side and drives the geometry used by the pagination", () => {
    const p: PageSetup = { ...DEFAULT_PAGE, gutterCm: 1 };
    expect(effectiveMarginsCm(p).left).toBeCloseTo(3.54, 5);
    expect(pageGeometry(p).insetLeft).toBeCloseTo(marginsPx(p).left, 5);
    const top = effectiveMarginsCm({ ...p, gutterPos: "top" });
    expect(top.top).toBeCloseTo(3.54, 5);
    expect(top.left).toBeCloseTo(2.54, 5);
  });
  it("changing format or margins changes the content area the pagination works with", () => {
    const a4 = pageGeometry(DEFAULT_PAGE);
    expect(pageGeometry({ ...DEFAULT_PAGE, size: "A5" }).contentHeight).toBeLessThan(a4.contentHeight);
    expect(pageGeometry({ ...DEFAULT_PAGE, orientation: "landscape" }).contentHeight).toBeLessThan(a4.contentHeight);
    expect(pageGeometry({ ...DEFAULT_PAGE, margins: "narrow" }).contentHeight).toBeGreaterThan(a4.contentHeight);
    expect(pageGeometry({ ...DEFAULT_PAGE, margins: "wide" }).width - pageGeometry({ ...DEFAULT_PAGE, margins: "wide" }).insetLeft * 2).toBeLessThan(a4.width - a4.insetLeft * 2);
  });
});

describe("validation", () => {
  it("rejects negative or absurd margins and unusable text areas", () => {
    expect(validatePage(DEFAULT_PAGE)).toEqual([]);
    expect(validatePage({ ...DEFAULT_PAGE, margins: "custom", customMarginsCm: { top: -1, bottom: 2, left: 2, right: 2 } }).map((x) => x.field)).toContain("top");
    expect(validatePage({ ...DEFAULT_PAGE, margins: "custom", customMarginsCm: { top: 2, bottom: 2, left: NaN, right: 2 } }).map((x) => x.field)).toContain("left");
    expect(validatePage({ ...DEFAULT_PAGE, margins: "custom", customMarginsCm: { top: 2, bottom: 2, left: 10, right: 10 } }).map((x) => x.field)).toContain("text");
    expect(validatePage({ ...DEFAULT_PAGE, gutterCm: -2 }).map((x) => x.field)).toContain("gutter");
    expect(validatePage({ size: "Custom", customSizeCm: { width: 2, height: 500 }, orientation: "portrait", margins: "normal" }).map((x) => x.field)).toEqual(["width", "height"]);
  });
  it("shrinks margins that no longer fit a smaller page, never the other way", () => {
    const a6: PageSetup = { size: "A6", orientation: "portrait", margins: "wide" };
    expect(validatePage(a6).some((x) => x.field === "text")).toBe(true);
    const fitted = fitMargins(a6);
    expect(validatePage(fitted)).toEqual([]);
    expect(fitMargins(DEFAULT_PAGE)).toBe(DEFAULT_PAGE);
  });
  it("never accepts invalid values from a file", () => {
    expect(sanitizePage({ size: "Custom", customSizeCm: { width: 2, height: 3 } })).toEqual({ size: "A4", orientation: "portrait", margins: "normal" });
    expect(sanitizePage({ margins: "custom", customMarginsCm: { top: -3, bottom: 1, left: 1, right: 1 } })).toEqual({ size: "A4", orientation: "portrait", margins: "normal" });
    expect(sanitizePage({ size: "A3", margins: "moderate", gutterCm: 1, gutterPos: "top" })).toEqual({ size: "A3", orientation: "portrait", margins: "moderate", gutterCm: 1, gutterPos: "top" });
  });
});

const setups: PageSetup[] = [
  { size: "A3", orientation: "landscape", margins: "moderate" },
  { size: "Legal", orientation: "portrait", margins: "wide" },
  { size: "B5", orientation: "portrait", margins: "mirrored" },
  { size: "Executive", orientation: "portrait", margins: "narrow" },
  { size: "Custom", customSizeCm: { width: 15, height: 22.5 }, orientation: "landscape", margins: "custom", customMarginsCm: { top: 1.5, bottom: 2, left: 3, right: 1.2 } },
  { size: "A4", orientation: "portrait", margins: "custom", customMarginsCm: { top: 2, bottom: 2, left: 3, right: 2 }, mirrored: true },
  { size: "A5", orientation: "portrait", margins: "normal", gutterCm: 1 },
];

describe("saving and reopening", () => {
  for (const page of setups) {
    const name = `${page.size} ${page.orientation} ${page.margins}${page.mirrored ? " mirrored" : ""}${page.gutterCm ? " gutter" : ""}`;
    it(`DOCX keeps ${name}`, async () => {
      const { model } = await importDocx((await exportDocx(doc(page))).bytes);
      expect(model.page.size).toBe(page.size);
      expect(model.page.orientation).toBe(page.orientation);
      // the effective margins and the paper are the same, whichever way they are named
      const a = effectiveMarginsCm(model.page), b = effectiveMarginsCm(page);
      for (const k of ["top", "bottom", "left", "right"] as const) expect(a[k]).toBeCloseTo(b[k], 1);
      expect(!!model.page.mirrored || model.page.margins === "mirrored").toBe(!!page.mirrored || page.margins === "mirrored");
      if (page.size === "Custom") expect(model.page.customSizeCm?.width).toBeCloseTo(page.customSizeCm!.width, 1);
    });
    it(`ODT keeps ${name}`, async () => {
      const { model } = await importOdt((await exportOdt(doc(page))).bytes);
      expect(model.page.size).toBe(page.size);
      expect(model.page.orientation).toBe(page.orientation);
      const a = effectiveMarginsCm(model.page), b = effectiveMarginsCm(page);
      for (const k of ["top", "bottom", "left", "right"] as const) expect(a[k]).toBeCloseTo(b[k], 1);
      expect(!!model.page.mirrored || model.page.margins === "mirrored").toBe(!!page.mirrored || page.margins === "mirrored");
    });
  }
  it("DOCX writes the binding margin and the facing-pages setting as Word does", async () => {
    const zip = await JSZip.loadAsync((await exportDocx(doc({ size: "A4", orientation: "portrait", margins: "mirrored", gutterCm: 1 }))).bytes);
    expect(await zip.file("word/document.xml")!.async("string")).toMatch(/<w:pgMar[^>]*w:gutter="567"/);
    expect(await zip.file("word/settings.xml")!.async("string")).toContain("<w:mirrorMargins/>");
  });
  it("ODT writes exact paper sizes in centimetres and the mirrored usage", async () => {
    const zip = await JSZip.loadAsync((await exportOdt(doc({ size: "A4", orientation: "portrait", margins: "mirrored" }))).bytes);
    const styles = await zip.file("styles.xml")!.async("string");
    expect(styles).toContain('fo:page-width="21cm"');
    expect(styles).toContain('fo:page-height="29.7cm"');
    expect(styles).toContain('style:page-usage="mirrored"');
    expect(cm(0)).toBe(0);
  });
});

describe("watermark", () => {
  const wm = { text: "BROUILLON", color: "#dc2626", size: 90, layout: "diagonal" as const, opacity: 0.4 };
  it("is written to DOCX as Word's own shape and read back", async () => {
    const { bytes } = await exportDocx({ ...doc(DEFAULT_PAGE), watermark: wm });
    const zip = await JSZip.loadAsync(bytes);
    const header = await zip.file("word/header1.xml")!.async("string");
    expect(header).toContain("PowerPlusWaterMarkObject");
    expect(header).toContain('string="BROUILLON"');
    const { model } = await importDocx(bytes);
    expect(model.watermark).toEqual(wm);
  });
  it("is put in the existing header and not lost with the header content", async () => {
    const { headerFooterSample } = await import("../../services/documents/__tests__/fixtures");
    const { bytes } = await exportDocx({ ...doc(DEFAULT_PAGE), headerFooter: headerFooterSample(), watermark: { ...wm, layout: "horizontal" } });
    const { model } = await importDocx(bytes);
    expect(model.watermark?.layout).toBe("horizontal");
    expect(model.headerFooter?.header.default).toBeTruthy();
  });
  it("is warned about in ODT, and invalid values are rejected", async () => {
    expect((await exportOdt({ ...doc(DEFAULT_PAGE), watermark: wm })).warnings.join()).toMatch(/Filigrane/);
    const { cleanWatermark } = await import("../../editor/watermark");
    expect(cleanWatermark({ text: "   " })).toBeNull();
    expect(cleanWatermark({ text: "x", size: 9999, opacity: 7, color: "red" })).toEqual({ text: "x", color: "#c0c0c0", size: 250, layout: "diagonal", opacity: 1 });
  });
  it("round-trips through the legacy .loma format", async () => {
    const { lomaAdapter } = await import("../../services/documents/lomaAdapter");
    const back = await lomaAdapter.import((await lomaAdapter.export({ ...doc(DEFAULT_PAGE), watermark: wm })).bytes);
    expect(back.model.watermark).toEqual(wm);
  });
});

describe("sections", () => {
  const P = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
  const land: PageSetup = { size: "A4", orientation: "landscape", margins: "narrow" };
  const letter: PageSetup = { size: "Letter", orientation: "portrait", margins: "wide", gutterCm: 1 };
  const hf = (t: string) => ({ header: { default: { blocks: [{ type: "paragraph", content: [{ type: "text", text: t }] }] } }, footer: {}, titlePage: false, evenOdd: false });
  const model = (): DocumentModel => ({
    content: { type: "doc", content: [P("Un"), P("Deux"), { type: "sectionBreak", attrs: { page: land, hf: null } }, P("Trois"), { type: "sectionBreak", attrs: { page: letter, hf: hf("Section 3") } }, P("Quatre")] },
    page: DEFAULT_PAGE,
    headerFooter: hf("Section 1"),
  });
  const kinds = (j: { content?: Array<{ type?: string }> }) => (j.content ?? []).map((n) => n.type);
  const breaks = (j: { content?: Array<{ type?: string; attrs?: Record<string, unknown> }> }) => (j.content ?? []).filter((n) => n.type === "sectionBreak");

  it("DOCX writes one section per break and reads them back", async () => {
    const zip = await JSZip.loadAsync((await exportDocx(model())).bytes);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect((xml.match(/<w:sectPr/g) ?? []).length).toBe(3);
    const { model: back } = await importDocx(await zip.generateAsync({ type: "uint8array" }));
    expect(kinds(back.content as never)).toEqual(["paragraph", "paragraph", "sectionBreak", "paragraph", "sectionBreak", "paragraph"]);
    const b = breaks(back.content as never);
    expect(b[0].attrs?.page).toMatchObject({ size: "A4", orientation: "landscape", margins: "narrow" });
    expect(b[1].attrs?.page).toMatchObject({ size: "Letter", orientation: "portrait", margins: "wide", gutterCm: 1 });
    expect(b[0].attrs?.hf).toBeNull(); // section 2 keeps section 1's header
    expect(JSON.stringify(b[1].attrs?.hf)).toContain("Section 3");
    expect(JSON.stringify(back.headerFooter)).toContain("Section 1");
    expect(back.page.orientation).toBe("portrait");
  });
  it("ODT writes one master page per section and reads them back", async () => {
    const zip = await JSZip.loadAsync((await exportOdt(model())).bytes);
    const styles = await zip.file("styles.xml")!.async("string");
    expect((styles.match(/<style:master-page /g) ?? []).length).toBe(3);
    expect(styles).toMatch(/fo:page-width="29\.7cm" fo:page-height="21cm"/);
    const { model: back } = await importOdt(await zip.generateAsync({ type: "uint8array" }));
    expect(kinds(back.content as never)).toEqual(["paragraph", "paragraph", "sectionBreak", "paragraph", "sectionBreak", "paragraph"]);
    const b = breaks(back.content as never);
    expect(b[0].attrs?.page).toMatchObject({ size: "A4", orientation: "landscape", margins: "narrow" });
    expect(b[1].attrs?.page).toMatchObject({ size: "Letter", orientation: "portrait" });
    expect(b[0].attrs?.hf).toBeNull();
    expect(JSON.stringify(b[1].attrs?.hf)).toContain("Section 3");
    expect(JSON.stringify(back.headerFooter)).toContain("Section 1");
  });
  const cols2 = { count: 2, gapCm: 1.5, line: true };
  const continuousModel = (): DocumentModel => ({
    content: { type: "doc", content: [P("Un"), { type: "sectionBreak", attrs: { page: { ...DEFAULT_PAGE, columns: cols2 }, hf: null, kind: "continuous" } }, P("Deux"), P("Trois"), { type: "sectionBreak", attrs: { page: DEFAULT_PAGE, hf: null, kind: "continuous" } }, P("Quatre")] },
    page: DEFAULT_PAGE,
  });
  const shapeOf = (j: { content?: Array<{ type?: string; attrs?: Record<string, unknown> }> }) => (j.content ?? []).map((n) => (n.type === "sectionBreak" ? `break:${n.attrs?.kind ?? "nextPage"}:${(n.attrs?.page as { columns?: { count: number } }).columns?.count ?? 1}` : n.type));
  const want = ["paragraph", "break:continuous:2", "paragraph", "paragraph", "break:continuous:1", "paragraph"];
  it("DOCX keeps continuous breaks and columns", async () => {
    const zip = await JSZip.loadAsync((await exportDocx(continuousModel())).bytes);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain('<w:type w:val="continuous"');
    expect(xml).toMatch(/<w:cols [^>]*w:num="2"/);
    const { model: back, warnings } = await importDocx(await zip.generateAsync({ type: "uint8array" }));
    expect(shapeOf(back.content as never)).toEqual(want);
    expect(breaks(back.content as never)[0].attrs?.page).toMatchObject({ columns: { count: 2, line: true } });
    expect((breaks(back.content as never)[0].attrs?.page as { columns: { gapCm: number } }).columns.gapCm).toBeCloseTo(1.5, 1);
    expect(warnings.join(" ")).not.toContain("continu");
  });
  it("ODT keeps continuous breaks and columns (a text:section)", async () => {
    const zip = await JSZip.loadAsync((await exportOdt(continuousModel())).bytes);
    const xml = await zip.file("content.xml")!.async("string");
    expect(xml).toContain("<text:section");
    expect(xml).toContain('fo:column-count="2"');
    const { model: back } = await importOdt(await zip.generateAsync({ type: "uint8array" }));
    expect(shapeOf(back.content as never)).toEqual(want);
    expect(breaks(back.content as never)[0].attrs?.page).toMatchObject({ columns: { count: 2, line: true } });
  });
  it("a next-page section with columns keeps both in ODT and DOCX", async () => {
    const m: DocumentModel = { content: { type: "doc", content: [P("a"), { type: "sectionBreak", attrs: { page: { ...DEFAULT_PAGE, columns: { count: 3, gapCm: 1, line: false } }, hf: null } }, P("b")] }, page: DEFAULT_PAGE };
    for (const back of [(await importOdt((await exportOdt(m)).bytes)).model, (await importDocx((await exportDocx(m)).bytes)).model]) {
      expect(shapeOf(back.content as never)).toEqual(["paragraph", "break:nextPage:3", "paragraph"]);
    }
  });
  it("a section that starts with a table or an image still gets its page (an empty paragraph carries the master page)", async () => {
    const m: DocumentModel = { content: { type: "doc", content: [P("a"), { type: "sectionBreak", attrs: { page: land, hf: null } }, { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [P("c")] }] }] }, P("fin")] }, page: DEFAULT_PAGE };
    const { model: back } = await importOdt((await exportOdt(m)).bytes);
    expect(kinds(back.content as never)).toEqual(["paragraph", "sectionBreak", "table", "paragraph"]);
  });
  it("shapes of a later section are placed against that section's margins, not the first one's", async () => {
    const shape = { type: "shape", attrs: { kind: "rect", width: 100, height: 60, fill: "#ffffff", stroke: "#000000", strokeWidth: 1, wrap: "front", anchor: "page", x: 100, y: 50, z: 0, align: "left" }, content: [{ type: "paragraph" }] };
    const m: DocumentModel = { content: { type: "doc", content: [P("a"), { type: "sectionBreak", attrs: { page: { size: "A4", orientation: "landscape", margins: "narrow" }, hf: null } }, shape, P("b")] }, page: DEFAULT_PAGE };
    const zip = await JSZip.loadAsync((await exportDocx(m)).bytes);
    const xml = (await zip.file("word/document.xml")!.async("string")).replace(/(<wp:positionH relativeFrom=")page(")/, "$1margin$2");
    zip.file("word/document.xml", xml);
    const { model } = await importDocx(await zip.generateAsync({ type: "uint8array" }));
    const got = (model.content.content ?? []).find((n) => n.type === "shape");
    // narrow margins of the landscape section: 1.27 cm = 48 px (the first section has 96 px)
    expect(got?.attrs?.x).toBe(100 + 48);
  });
  it("a document with a single section is unchanged", async () => {
    const one: DocumentModel = { content: { type: "doc", content: [P("x")] }, page: land };
    const { model: back } = await importDocx((await exportDocx(one)).bytes);
    expect(back.page.orientation).toBe("landscape");
    expect(kinds(back.content as never)).toEqual(["paragraph"]);
  });
});

describe("page numbers", () => {
  const P = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
  const model = (): DocumentModel => ({
    content: { type: "doc", content: [P("Un"), { type: "sectionBreak", attrs: { page: { ...DEFAULT_PAGE, numberFormat: "lowerRoman", numberStart: 1 }, hf: null } }, P("Deux"), { type: "sectionBreak", attrs: { page: { ...DEFAULT_PAGE, numberFormat: "upperLetter", numberStart: 7 }, hf: null } }, P("Trois")] },
    page: { ...DEFAULT_PAGE, numberFormat: "upperRoman", numberStart: 4 },
  });
  const nums = (j: { content?: Array<{ type?: string; attrs?: Record<string, unknown> }> }, first: PageSetup) => [first, ...(j.content ?? []).filter((n) => n.type === "sectionBreak").map((n) => n.attrs?.page as PageSetup)].map((p) => `${p.numberFormat ?? "decimal"}@${p.numberStart ?? "-"}`);
  const want = ["upperRoman@4", "lowerRoman@1", "upperLetter@7"];

  it("formats numbers like Word", async () => {
    const { formatPageNumber, displayedNumbers } = await import("../../pagination/pageNumber");
    expect([1, 4, 9, 14, 40, 1994].map((n) => formatPageNumber(n, "upperRoman"))).toEqual(["I", "IV", "IX", "XIV", "XL", "MCMXCIV"]);
    expect([3, 12].map((n) => formatPageNumber(n, "lowerRoman"))).toEqual(["iii", "xii"]);
    expect([1, 26, 27, 28, 53].map((n) => formatPageNumber(n, "lowerLetter"))).toEqual(["a", "z", "aa", "bb", "aaa"]);
    expect(formatPageNumber(0, "upperRoman")).toBe("0");
    // sections: 2 pages, then a section restarting at 10 (2 pages), then one that goes on
    const sheets = [{ section: 0, indexInSection: 0 }, { section: 0, indexInSection: 1 }, { section: 1, indexInSection: 0 }, { section: 1, indexInSection: 1 }, { section: 2, indexInSection: 0 }];
    expect(displayedNumbers(sheets, [undefined, 10, undefined])).toEqual([1, 2, 10, 11, 12]);
    expect(displayedNumbers(sheets, [5, undefined, undefined])).toEqual([5, 6, 7, 8, 9]);
  });
  it("DOCX keeps format and restart of every section (w:pgNumType)", async () => {
    const zip = await JSZip.loadAsync((await exportDocx(model())).bytes);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain('w:fmt="upperRoman"');
    expect(xml).toMatch(/<w:pgNumType[^>]*w:start="7"/);
    const { model: back } = await importDocx(await zip.generateAsync({ type: "uint8array" }));
    expect(nums(back.content as never, back.page)).toEqual(want);
  });
  it("ODT keeps them too (style:num-format, style:page-number)", async () => {
    const zip = await JSZip.loadAsync((await exportOdt(model())).bytes);
    expect(await zip.file("styles.xml")!.async("string")).toContain('style:num-format="I"');
    expect(await zip.file("content.xml")!.async("string")).toContain('style:page-number="7"');
    const { model: back } = await importOdt(await zip.generateAsync({ type: "uint8array" }));
    expect(nums(back.content as never, back.page)).toEqual(want);
  });
  it("rejects invalid numbering from a file", () => {
    expect(sanitizePage({ numberFormat: "nope" as never, numberStart: -3 })).toEqual({ size: "A4", orientation: "portrait", margins: "normal" });
    expect(sanitizePage({ numberFormat: "lowerRoman", numberStart: 12 })).toMatchObject({ numberFormat: "lowerRoman", numberStart: 12 });
  });
});
