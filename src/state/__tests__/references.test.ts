import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { exportDocx } from "../../services/documents/docxExport";
import { importDocx } from "../../services/documents/docxImport";
import { exportOdt } from "../../services/documents/odtExport";
import { importOdt } from "../../services/documents/odtImport";
import type { DocumentModel } from "../../services/documents/types";
import { DEFAULT_PAGE } from "../types";

const T = (text: string) => ({ type: "text", text });
const H = (level: number, text: string) => ({ type: "heading", attrs: { level }, content: [T(text)] });
const P = (text: string) => ({ type: "paragraph", content: [T(text)] });
const entry = (level: number, text: string, page: string, target: number) => ({ type: "tocEntry", attrs: { level, target, page }, content: [T(text)] });

const tocModel = (): DocumentModel => ({
  content: {
    type: "doc",
    content: [
      { type: "tableOfContents", attrs: { levels: 2, kind: "headings", title: "Sommaire", label: null }, content: [entry(1, "Introduction", "1", 0), entry(2, "Contexte", "2", 1), entry(1, "Conclusion", "iv", 2)] },
      H(1, "Introduction"), P("a"), H(2, "Contexte"), P("b"), H(1, "Conclusion"), P("c"),
    ],
  },
  page: DEFAULT_PAGE,
});

const tocOf = (j: { content?: Array<{ type?: string; attrs?: Record<string, unknown>; content?: unknown[] }> }) => (j.content ?? []).find((n) => n.type === "tableOfContents");
const linesOf = (toc: { content?: unknown[] } | undefined) => ((toc?.content ?? []) as Array<{ attrs: { level: number; page: string; target: number | null }; content?: Array<{ text: string }> }>).map((e) => `${e.attrs.level}:${e.content?.[0]?.text ?? ""}:${e.attrs.page}:${e.attrs.target}`);

const cap = (label: string, n: number, text: string) => ({ type: "paragraph", attrs: { caption: label }, content: [T(`${label} `), { type: "seqField", attrs: { label, n } }, T(` : ${text}`)] });
const captionModel = (): DocumentModel => ({
  content: { type: "doc", content: [
    P("avant"), cap("Figure", 1, "Un chat"), P("milieu"), cap("Tableau", 1, "Des chats"), cap("Figure", 2, "Deux chats"),
    { type: "tableOfContents", attrs: { levels: 1, kind: "captions", title: "Table des figures", label: "Figure" }, content: [entry(1, "Figure 1 : Un chat", "1", 0), entry(1, "Figure 2 : Deux chats", "2", 1)] },
  ] },
  page: DEFAULT_PAGE,
});
const capsOf = (j: { content?: Array<{ type?: string; attrs?: Record<string, unknown>; content?: unknown[] }> }) =>
  (j.content ?? []).filter((n) => n.type === "paragraph" && typeof n.attrs?.caption === "string").map((n) => `${n.attrs!.caption}:${((n.content ?? []) as Array<{ type: string; text?: string; attrs?: { n: number } }>).map((c) => (c.type === "seqField" ? String(c.attrs!.n) : c.text)).join("")}`);

describe("captions", () => {
  const want = ["Figure:Figure 1 : Un chat", "Tableau:Tableau 1 : Des chats", "Figure:Figure 2 : Deux chats"];
  it("DOCX writes SEQ fields in Caption paragraphs and reads them back (with the list of figures)", async () => {
    const zip = await JSZip.loadAsync((await exportDocx(captionModel())).bytes);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("SEQ Figure");
    expect(xml).toContain("SEQ Tableau");
    expect(xml).toContain('w:val="Caption"');
    expect(xml).toMatch(/TOC \\h \\z \\c &quot;Figure&quot;/);
    const { model } = await importDocx(await zip.generateAsync({ type: "uint8array" }));
    expect(capsOf(model.content as never)).toEqual(want);
    const toc = tocOf(model.content as never);
    expect(toc?.attrs).toMatchObject({ kind: "captions", label: "Figure" });
    expect(linesOf(toc)).toEqual(["1:Figure 1 : Un chat:1:0", "1:Figure 2 : Deux chats:2:1"]);
  });

  it("ODT writes text:sequence (declared) and an illustration index, and reads them back", async () => {
    const zip = await JSZip.loadAsync((await exportOdt(captionModel())).bytes);
    const xml = await zip.file("content.xml")!.async("string");
    expect(xml).toContain('<text:sequence-decl text:display-outline-level="0" text:name="Figure"/>');
    expect(xml).toContain('text:formula="ooow:Tableau+1"');
    expect(xml).toContain("<text:illustration-index");
    const { model } = await importOdt(await zip.generateAsync({ type: "uint8array" }));
    expect(capsOf(model.content as never)).toEqual(want);
    const toc = tocOf(model.content as never);
    expect(toc?.attrs).toMatchObject({ kind: "captions", label: "Figure" });
    expect(linesOf(toc)).toEqual(["1:Figure 1 : Un chat:1:0", "1:Figure 2 : Deux chats:2:1"]);
  });
});

describe("table of contents", () => {
  it("DOCX writes a TOC field with its entries and the bookmarks of the headings, and reads them back", async () => {
    const zip = await JSZip.loadAsync((await exportDocx(tocModel())).bytes);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("TOC \\o &quot;1-2&quot; \\h \\z \\u");
    expect(xml).toContain("PAGEREF _TocLoma000001");
    expect(xml).toContain('w:name="_TocLoma000003"');
    expect(xml).not.toContain("@@TOC");
    const { model } = await importDocx(await zip.generateAsync({ type: "uint8array" }));
    const toc = tocOf(model.content as never);
    expect(toc?.attrs).toMatchObject({ title: "Sommaire", levels: 2, kind: "headings" });
    expect(linesOf(toc)).toEqual(["1:Introduction:1:0", "2:Contexte:2:1", "1:Conclusion:iv:2"]);
    // the title paragraph is not left behind as text
    expect((model.content.content ?? []).filter((n) => n.type === "paragraph" && /Sommaire/.test(JSON.stringify(n)))).toEqual([]);
  });

  it("ODT writes a table-of-content and reads it back", async () => {
    const zip = await JSZip.loadAsync((await exportOdt(tocModel())).bytes);
    const xml = await zip.file("content.xml")!.async("string");
    expect(xml).toContain("<text:table-of-content");
    expect(xml).toContain("Contents_20_2");
    const { model } = await importOdt(await zip.generateAsync({ type: "uint8array" }));
    const toc = tocOf(model.content as never);
    expect(toc?.attrs).toMatchObject({ title: "Sommaire", kind: "headings" });
    expect(linesOf(toc)).toEqual(["1:Introduction:1:0", "2:Contexte:2:1", "1:Conclusion:iv:2"]);
  });

  it("entries read from a file are linked to the headings with the same text", async () => {
    const m = tocModel();
    const lines = (m.content.content![0] as { content: Array<{ attrs: Record<string, unknown> }> }).content;
    lines.forEach((l) => { l.attrs.target = null; });
    const { model } = await importDocx((await exportDocx(m)).bytes);
    expect(linesOf(tocOf(model.content as never)).map((l) => l.split(":").at(-1))).toEqual(["0", "1", "2"]);
  });
});

const fn = (kind: "foot" | "end", n: number, text: string) => ({ type: "footnote", attrs: { kind, n, text } });
const notesModel = (): DocumentModel => ({
  content: { type: "doc", content: [
    { type: "paragraph", content: [T("Un"), fn("foot", 1, "Première note de bas de page."), T(" puis "), fn("end", 1, "Une note de fin."), T(" et "), fn("foot", 2, "Seconde note.")] },
    { type: "paragraph", content: [T("Fin"), fn("end", 2, "Autre note de fin.")] },
  ] },
  page: DEFAULT_PAGE,
});
const notesOf = (j: { content?: Array<{ content?: Array<{ type: string; attrs?: { kind: string; text: string } }> }> }) =>
  (j.content ?? []).flatMap((p) => (p.content ?? []).filter((c) => c.type === "footnote").map((c) => `${c.attrs!.kind}:${c.attrs!.text}`));

describe("notes", () => {
  const want = ["foot:Première note de bas de page.", "end:Une note de fin.", "foot:Seconde note.", "end:Autre note de fin."];
  it("DOCX writes real footnotes and endnotes and reads them back", async () => {
    const zip = await JSZip.loadAsync((await exportDocx(notesModel())).bytes);
    expect(await zip.file("word/footnotes.xml")!.async("string")).toContain("Première note de bas de page.");
    const end = await zip.file("word/endnotes.xml")!.async("string");
    expect(end).toContain("Une note de fin.");
    expect(await zip.file("word/settings.xml")!.async("string")).toContain("w:endnotePr");
    const doc = await zip.file("word/document.xml")!.async("string");
    expect(doc).toContain('<w:endnoteReference w:id="2"/>');
    const { model, warnings } = await importDocx(await zip.generateAsync({ type: "uint8array" }));
    expect(notesOf(model.content as never)).toEqual(want);
    expect(warnings.join(" ")).not.toContain("Notes");
  });
  it("ODT writes text:note (footnote and endnote) and reads them back", async () => {
    const zip = await JSZip.loadAsync((await exportOdt(notesModel())).bytes);
    const xml = await zip.file("content.xml")!.async("string");
    expect(xml).toContain('text:note-class="footnote"');
    expect(xml).toContain('text:note-class="endnote"');
    const { model } = await importOdt(await zip.generateAsync({ type: "uint8array" }));
    expect(notesOf(model.content as never)).toEqual(want);
  });
});

const src = [
  { tag: "Dupont2020", type: "book", authors: [{ last: "Dupont", first: "Jean" }, { last: "Martin", first: "Anne" }], title: "Les chats", year: "2020", publisher: "Seuil", city: "Paris", volume: "", pages: "", url: "" },
  { tag: "Bernard2019", type: "article", authors: [{ last: "Bernard", first: "Luc" }], title: "Sur les chiens", year: "2019", publisher: "Revue canine", city: "", volume: "12", pages: "33-48", url: "https://exemple.org/a" },
  { tag: "Jamais", type: "web", authors: [], title: "Jamais cité", year: "", publisher: "Site", city: "", volume: "", pages: "", url: "" },
];
const entryB = (...parts: Array<[string, boolean?]>) => ({ type: "bibEntry", content: parts.map(([text, i]) => ({ type: "text", text, ...(i ? { marks: [{ type: "italic" }] } : {}) })) });
const bibModel = (): DocumentModel => ({
  content: { type: "doc", attrs: { sources: src, citationStyle: "mla" }, content: [
    { type: "paragraph", content: [T("Voir "), { type: "citation", attrs: { tag: "Dupont2020", page: "12", text: "(Dupont et Martin 12)" } }, T(" et "), { type: "citation", attrs: { tag: "Bernard2019", page: "", text: "(Bernard)" } }, T(".")] },
    { type: "bibliography", attrs: { title: "Œuvres citées", mode: "cited" }, content: [entryB(["Bernard, Luc. « Sur les chiens. » "], ["Revue canine", true], [", vol. 12, 2019, p. 33-48."]), entryB(["Dupont, Jean et Anne Martin. "], ["Les chats", true], [". Seuil, 2020."])] },
  ] } as never,
  page: DEFAULT_PAGE,
});
const citesOf = (j: { content?: Array<{ content?: Array<{ type: string; attrs?: { tag: string; page: string } }> }> }) => (j.content ?? []).flatMap((p) => (p.content ?? []).filter((c) => c.type === "citation").map((c) => `${c.attrs!.tag}${c.attrs!.page ? "@" + c.attrs!.page : ""}`));
const attrsOf = (m: DocumentModel) => (m.content.attrs ?? {}) as { sources?: Array<{ tag: string; type: string; title: string; publisher: string; authors: unknown[]; url: string }>; citationStyle?: string };

describe("citations and bibliography", () => {
  it("DOCX writes CITATION fields, a BIBLIOGRAPHY field and the sources part, and reads them back", async () => {
    const zip = await JSZip.loadAsync((await exportDocx(bibModel())).bytes);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("CITATION Dupont2020");
    expect(xml).toContain("BIBLIOGRAPHY");
    const part = await zip.file("customXml/item1.xml")!.async("string");
    expect(part).toContain("<b:Tag>Bernard2019</b:Tag>");
    expect(part).toContain("JournalArticle");
    expect(part).toContain('StyleName="MLA"');
    expect(await zip.file("word/_rels/document.xml.rels")!.async("string")).toContain("customXml/item1.xml");
    const { model } = await importDocx(await zip.generateAsync({ type: "uint8array" }));
    expect(citesOf(model.content as never)).toEqual(["Dupont2020@12", "Bernard2019"]);
    const a = attrsOf(model);
    expect(a.sources?.map((s) => s.tag)).toEqual(["Dupont2020", "Bernard2019", "Jamais"]);
    expect(a.sources?.[1]).toMatchObject({ type: "article", publisher: "Revue canine", url: "https://exemple.org/a" });
    expect(a.citationStyle).toBe("mla");
    expect((model.content.content ?? []).find((n) => n.type === "bibliography")?.attrs).toMatchObject({ title: "Œuvres citées" });
  });

  it("ODT writes bibliography marks and an index, keeps all the sources in the metadata, and reads them back", async () => {
    const zip = await JSZip.loadAsync((await exportOdt(bibModel())).bytes);
    const xml = await zip.file("content.xml")!.async("string");
    expect(xml).toContain('<text:bibliography-mark text:identifier="Dupont2020"');
    expect(xml).toContain("<text:bibliography ");
    const { model } = await importOdt(await zip.generateAsync({ type: "uint8array" }));
    expect(citesOf(model.content as never)).toEqual(["Dupont2020@12", "Bernard2019"]);
    expect(attrsOf(model).sources?.map((s) => s.tag)).toEqual(["Dupont2020", "Bernard2019", "Jamais"]);
    expect(attrsOf(model).citationStyle).toBe("mla");
    expect((model.content.content ?? []).find((n) => n.type === "bibliography")?.attrs).toMatchObject({ title: "Œuvres citées" });
  });

  it("an ODT without our metadata still gets the sources its marks describe", async () => {
    const zip = await JSZip.loadAsync((await exportOdt(bibModel())).bytes);
    zip.file("meta.xml", '<?xml version="1.0"?><office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" office:version="1.3"><office:meta/></office:document-meta>');
    const { model } = await importOdt(await zip.generateAsync({ type: "uint8array" }));
    expect(attrsOf(model).sources?.map((s) => s.tag)).toEqual(["Dupont2020", "Bernard2019"]);
    expect(attrsOf(model).sources?.[0]).toMatchObject({ type: "book", title: "Les chats" });
  });
});
