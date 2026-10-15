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
