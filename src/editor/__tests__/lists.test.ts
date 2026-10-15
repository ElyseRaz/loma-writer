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
