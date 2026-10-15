import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/react";
import { describe, expect, it } from "vitest";
import { exportDocx } from "../../services/documents/docxExport";
import { importDocx } from "../../services/documents/docxImport";
import { exportOdt } from "../../services/documents/odtExport";
import { importOdt } from "../../services/documents/odtImport";
import type { DocumentModel } from "../../services/documents/types";
import { DEFAULT_PAGE } from "../../state/types";
import { nextSize } from "../commands";
import { cleanStyles, stylesCss } from "../docStyles";
import { WORD_FONTS } from "../fonts";
import { createExtensions } from "../extensions";
import { BULLET_TYPES, NUMBER_TYPES } from "../ListTypes";

const make = (html: string) => new Editor({ extensions: createExtensions({ pagination: false }), content: html });
const lists = (j: JSONContent) => (j.content ?? []).filter((n) => n.type === "bulletList" || n.type === "orderedList").map((n) => `${n.type}:${n.attrs?.listType ?? "-"}`);
const item = (t: string) => ({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });

describe("list marker styles", () => {
  it("setListType changes the list around the cursor, and creates the list when there is none", () => {
    const e = make("<ul><li><p>a</p></li></ul><p>b</p>");
    e.commands.setTextSelection(3);
    e.commands.setListType("bulletList", "square");
    expect(lists(e.getJSON() as JSONContent)).toEqual(["bulletList:square"]);
    e.commands.setListType("bulletList", "disc"); // the default is stored as "no type"
    expect(lists(e.getJSON() as JSONContent)).toEqual(["bulletList:-"]);
    e.commands.focus("end");
    e.commands.setListType("orderedList", "upper-roman");
    expect(lists(e.getJSON() as JSONContent)).toEqual(["bulletList:-", "orderedList:upper-roman"]);
    e.commands.setListType("orderedList", "nonsense");
    expect(lists(e.getJSON() as JSONContent)).toEqual(["bulletList:-", "orderedList:-"]);
  });

  it("is rendered as data-list-type and read back from HTML", () => {
    const e = make('<ul data-list-type="arrow"><li><p>a</p></li></ul>');
    expect(lists(e.getJSON() as JSONContent)).toEqual(["bulletList:arrow"]);
    expect(e.getHTML()).toContain('data-list-type="arrow"');
  });

  const model = (): DocumentModel => ({
    content: {
      type: "doc",
      content: [
        ...BULLET_TYPES.map((t) => ({ type: "bulletList", attrs: { listType: t.id === "disc" ? null : t.id }, content: [item(`b-${t.id}`)] })),
        ...NUMBER_TYPES.map((t) => ({ type: "orderedList", attrs: { listType: t.id === "decimal" ? null : t.id }, content: [item(`n-${t.id}`)] })),
      ],
    },
    page: DEFAULT_PAGE,
  });
  const expected = [...BULLET_TYPES.map((t) => `bulletList:${t.id === "disc" ? "-" : t.id}`), ...NUMBER_TYPES.map((t) => `orderedList:${t.id === "decimal" ? "-" : t.id}`)];
  // Consecutive lists of one kind may merge in a foreign reader; the exporters write one list each.
  it("every marker style survives DOCX", async () => {
    const { model: back } = await importDocx((await exportDocx(model())).bytes);
    expect(lists(back.content as JSONContent)).toEqual(expected);
  });
  it("every marker style survives ODT", async () => {
    const { model: back } = await importOdt((await exportOdt(model())).bytes);
    expect(lists(back.content as JSONContent)).toEqual(expected);
  });
});

describe("font size steps and font list", () => {
  it("T+ / T- walk the size list like Word", () => {
    expect(nextSize(11, 1)).toBe(12);
    expect(nextSize(12, 1)).toBe(14);
    expect(nextSize(72, 1)).toBe(80);
    expect(nextSize(400, 1)).toBe(440); // beyond the list: a tenth more
    expect(nextSize(1638, 1)).toBe(1638);
    expect(nextSize(11, -1)).toBe(10);
    expect(nextSize(8, -1)).toBe(7);
    expect(nextSize(6, -1)).toBe(6);
    expect(nextSize(500, -1)).toBe(400);
  });
  it("offers the usual Word fonts", () => {
    for (const f of ["Times New Roman", "Arial", "Calibri", "Cambria", "Courier New", "Verdana", "Georgia", "Segoe UI"]) expect(WORD_FONTS).toContain(f);
  });
});

describe("edited paragraph styles", () => {
  const styled = (): DocumentModel => ({
    content: { type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Titre" }] }, { type: "paragraph", content: [{ type: "text", text: "Texte" }] }] },
    page: DEFAULT_PAGE,
    defaults: { fontFamily: "Calibri", fontSizePt: 11 },
    styles: { h1: { fontFamily: "Georgia", sizePt: 30, color: "#aa0000", italic: true, spaceBefore: 12, spaceAfter: 20, align: "center" }, h2: { sizePt: 18 }, normal: { spaceAfter: 14, lineHeight: 1.2 }, quote: { color: "#00aa00" } },
  });
  const check = (s: DocumentModel["styles"]) => {
    expect(s?.h1).toMatchObject({ fontFamily: "Georgia", sizePt: 30, color: "#aa0000", italic: true, spaceBefore: 12, spaceAfter: 20 });
    expect(s?.h2?.sizePt).toBe(18);
    expect(s?.normal).toMatchObject({ spaceAfter: 14, lineHeight: 1.2 });
    expect(s?.quote?.color).toBe("#00aa00");
  };
  it("survive DOCX", async () => check((await importDocx((await exportDocx(styled())).bytes)).model.styles));
  it("survive ODT", async () => check((await importOdt((await exportOdt(styled())).bytes)).model.styles));
  it("unedited documents store no overrides", async () => {
    const plain = { ...styled(), styles: undefined };
    expect((await importDocx((await exportDocx(plain)).bytes)).model.styles).toBeUndefined();
    expect((await importOdt((await exportOdt(plain)).bytes)).model.styles).toBeUndefined();
  });
  it("cleanStyles rejects invalid values and CSS injection", () => {
    const c = cleanStyles({ h1: { fontFamily: 'x"; background:url(//e)', color: "red", sizePt: 5000, bold: "yes" }, evil: { sizePt: 3 } });
    expect(c).toEqual({ h1: { sizePt: 96 } });
    expect(stylesCss({ h1: { fontFamily: "Georgia", sizePt: 20 } })).toBe('.paper .ProseMirror h1{font-family:"Georgia", sans-serif;font-size:20pt}');
  });
});

describe("table position and style", () => {
  const model = (): DocumentModel => ({
    content: { type: "doc", content: [{ type: "table", attrs: { place: { x: -40, w: 500 }, look: { borders: "all", color: "#2563eb", width: 2, headFill: "#2563eb", headText: "#ffffff", band: "#eff6ff", firstCol: false } }, content: [
      { type: "tableRow", content: [{ type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] }] },
      { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "1" }] }] }] },
    ] }] },
    page: DEFAULT_PAGE,
  });
  it("a table moved into the margin keeps its offset in DOCX and ODT", async () => {
    const docx = await (await import("jszip")).default.loadAsync((await exportDocx(model())).bytes);
    const xml = await docx.file("word/document.xml")!.async("string");
    expect(xml).toMatch(/<w:tblInd[^>]*w:w="-600"/);
    expect(xml).toContain('w:fill="2563EB"'); // header fill of the style
    expect(xml).toMatch(/w:color="2563EB"/); // border colour
    const odt = await (await import("jszip")).default.loadAsync((await exportOdt(model())).bytes);
    expect(await odt.file("content.xml")!.async("string")).toMatch(/fo:margin-left="-1\.05\dcm"/);
  });
  it("rejects invalid positions", async () => {
    const { cleanPlace } = await import("../TableLook");
    expect(cleanPlace({ x: 5, w: 10 })).toBeNull();
    expect(cleanPlace({ x: "a", w: 300 })).toBeNull();
    expect(cleanPlace({ x: -30.4, w: 400.2 })).toEqual({ x: -30, w: 400 });
  });
});

describe("row height", () => {
  const model = (): DocumentModel => ({
    content: { type: "doc", content: [{ type: "table", content: [
      { type: "tableRow", attrs: { rowHeight: 120 }, content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] }] },
      { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "B" }] }] }] },
    ] }] },
    page: DEFAULT_PAGE,
  });
  const heights = (j: JSONContent) => (j.content?.[0].content ?? []).map((r) => r.attrs?.rowHeight ?? null);
  it("is kept by DOCX", async () => expect(heights((await importDocx((await exportDocx(model())).bytes)).model.content)).toEqual([120, null]));
  it("is kept by ODT", async () => expect(heights((await importOdt((await exportOdt(model())).bytes)).model.content)).toEqual([120, null]));
});

describe("floating pictures", () => {
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADq0kPzxQAAAAAElFTkSuQmCC";
  const model = (attrs: Record<string, unknown>): DocumentModel => ({ content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }, { type: "image", attrs: { src: PNG, width: 80, height: 80, ...attrs } }] }] }, page: DEFAULT_PAGE });
  it("a picture in front of the text is anchored on the page in DOCX, with its rotation", async () => {
    const zip = await (await import("jszip")).default.loadAsync((await exportDocx(model({ wrap: "front", anchor: "page", x: 100, y: 200, rotation: 30 }))).bytes);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("<wp:anchor");
    expect(xml).toMatch(/<wp:positionH relativeFrom="page">\s*<wp:posOffset>952500</);
    expect(xml).toMatch(/rot="1800000"/);
  });
  it("a picture behind the text is flagged as such, and ODT keeps its position", async () => {
    const zip = await (await import("jszip")).default.loadAsync((await exportDocx(model({ wrap: "behind", x: 10, y: 20 }))).bytes);
    expect(await zip.file("word/document.xml")!.async("string")).toMatch(/behindDoc="1"/);
    const odt = await (await import("jszip")).default.loadAsync((await exportOdt(model({ wrap: "front", x: 96, y: 192 }))).bytes);
    const content = await odt.file("content.xml")!.async("string");
    expect(content).toMatch(/svg:x="2\.54\d?cm" svg:y="5\.08\d?cm"/);
    expect(content).toContain('style:run-through="foreground"');
  });
  it("an inline picture stays inline", async () => {
    const xml = await (await (await import("jszip")).default.loadAsync((await exportDocx(model({}))).bytes)).file("word/document.xml")!.async("string");
    expect(xml).not.toContain("<wp:anchor");
  });
});
