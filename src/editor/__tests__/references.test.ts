import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/react";
import { describe, expect, it } from "vitest";
import { collectCaptions } from "../references/Captions";
import { createExtensions } from "../extensions";

const setLabels = (e: Editor, f: (pos: number) => string) => { (e.storage as unknown as { references: { labelAt: (pos: number) => string } }).references.labelAt = f; };
const make = (content: JSONContent | string) => new Editor({ extensions: createExtensions({ pagination: false }), content });
const T = (text: string) => ({ type: "text", text });
const kinds = (e: Editor) => (e.getJSON().content ?? []).map((n) => n.type);
const toc = (e: Editor) => (e.getJSON().content ?? []).find((n) => n.type === "tableOfContents");
const lines = (e: Editor) => ((toc(e)?.content ?? []) as JSONContent[]).map((x) => `${x.attrs?.level}:${(x.content?.[0] as { text?: string } | undefined)?.text}:${x.attrs?.page}`);

describe("table des matières", () => {
  const doc = () => make({ type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [T("Un")] }, { type: "paragraph", content: [T("x")] }, { type: "heading", attrs: { level: 2 }, content: [T("Deux")] }, { type: "heading", attrs: { level: 3 }, content: [T("Trois")] }, { type: "heading", attrs: { level: 1 } }] });

  it("insertTableOfContents lists the headings down to the chosen level (empty headings are left out)", () => {
    const e = doc();
    setLabels(e,  (pos: number) => String(pos > 5 ? 2 : 1));
    e.commands.setTextSelection(1);
    expect(e.commands.insertTableOfContents({ levels: 2 })).toBe(true);
    expect(kinds(e)[1]).toBe("tableOfContents");
    expect(lines(e)).toEqual(["1:Un:1", "2:Deux:2"]);
  });

  it("updateTableOfContents follows renamed headings and the page labels", () => {
    const e = doc();
    e.commands.setTextSelection(1);
    e.commands.insertTableOfContents({ levels: 3 });
    setLabels(e,  () => "7");
    e.commands.setTextSelection(3);
    e.commands.insertContent("bis");
    e.commands.updateTableOfContents();
    expect(lines(e)).toEqual(["1:Unbis:7", "2:Deux:7", "3:Trois:7"]);
  });

  it("the headings of the table itself are not headings, and removeTableOfContents removes it", () => {
    const e = doc();
    e.commands.insertTableOfContents();
    e.commands.updateTableOfContents();
    expect(lines(e)).toHaveLength(3);
    e.commands.removeTableOfContents();
    expect(toc(e)).toBeUndefined();
  });
});

describe("légendes", () => {
  const withImage = () => make({ type: "doc", content: [{ type: "paragraph", content: [{ type: "image", attrs: { src: "data:image/png;base64,AAAA" } }] }, { type: "paragraph", content: [T("texte")] }] });

  it("insertCaption puts a numbered caption under a picture, and numbers follow the order", () => {
    const e = withImage();
    e.commands.setTextSelection(1);
    expect(e.commands.insertCaption({ label: "Figure", text: "Un chat" })).toBe(true);
    const caps = collectCaptions(e.state.doc, "Figure");
    expect(caps.map((c) => c.text)).toEqual(["Figure 1 : Un chat"]);
    // a second one before the first: the numbers are shifted
    e.commands.setTextSelection(1);
    e.commands.insertCaption({ label: "Figure", text: "Avant", position: "above" });
    expect(collectCaptions(e.state.doc, "Figure").map((c) => c.text)).toEqual(["Figure 1 : Avant", "Figure 2 : Un chat"]);
  });

  it("each label has its own numbering, and a caption above a table", () => {
    const e = make("<p>a</p><table><tbody><tr><td><p>c</p></td></tr></tbody></table><p>b</p>");
    e.commands.setTextSelection(e.state.doc.child(0).nodeSize + 4); // inside the table
    e.commands.insertCaption({ label: "Tableau" });
    e.commands.setTextSelection(1);
    e.commands.insertCaption({ label: "Figure" });
    expect(collectCaptions(e.state.doc).map((c) => c.text)).toEqual(["Figure 1", "Tableau 1"]);
    // the table caption is above the table
    const order = (e.getJSON().content ?? []).map((n) => n.type + (n.attrs?.caption ? ":" + n.attrs.caption : ""));
    expect(order.indexOf("paragraph:Tableau")).toBe(order.indexOf("table") - 1);
  });

  it("a list of captions follows the captions of its label", () => {
    const e = withImage();
    setLabels(e,  () => "1");
    e.commands.setTextSelection(1);
    e.commands.insertCaption({ label: "Figure", text: "Un" });
    e.commands.insertTableOfContents({ kind: "captions", label: "Figure" });
    expect(lines(e)).toEqual(["1:Figure 1 : Un:1"]);
    expect(toc(e)?.attrs).toMatchObject({ kind: "captions", label: "Figure", title: "Table des figures" });
  });
});

describe("notes", () => {
  type J = { type?: string; content?: Array<{ content?: Array<{ text?: string }> }> };
  const nodes = (e: Editor): J[] => (e.getJSON().content ?? []) as J[];
  const refs = (e: Editor, kind: string) => { const out: Array<{ n: number; text: string }> = []; e.state.doc.descendants((n) => { if (n.type.name === "footnote" && n.attrs.kind === kind) out.push({ n: n.attrs.n, text: n.attrs.text }); return n.type.name !== "endnotes"; }); return out; };

  it("notes are numbered per kind in document order", () => {
    const e = make("<p>un deux trois</p>");
    e.commands.setTextSelection(10);
    e.commands.insertNote({ kind: "foot", text: "B" });
    e.commands.setTextSelection(3);
    e.commands.insertNote({ kind: "foot", text: "A" });
    e.commands.setTextSelection(2);
    e.commands.insertNote({ kind: "end", text: "E" });
    expect(refs(e, "foot")).toEqual([{ n: 1, text: "A" }, { n: 2, text: "B" }]);
    expect(refs(e, "end")).toEqual([{ n: 1, text: "E" }]);
  });

  it("the endnotes block follows the references, and goes away with the last one", () => {
    const e = make("<p>texte</p>");
    e.commands.setTextSelection(3);
    e.commands.insertNote({ kind: "end", text: "Première" });
    e.commands.setTextSelection(1);
    e.commands.insertNote({ kind: "end", text: "Avant" });
    const last = nodes(e).find((n) => n.type === "endnotes")!;
    expect(last).toBeTruthy();
    expect(nodes(e).at(-1)?.type === "endnotes" || (nodes(e).at(-1)?.type === "paragraph" && !nodes(e).at(-1)?.content)).toBe(true); // nothing but the editor's empty paragraph after it
    expect((last.content ?? []).map((i) => i.content?.[0]?.text)).toEqual(["Avant", "Première"]);
    // updating the text of a note updates its entry
    let pos = 0;
    e.state.doc.descendants((n, p) => { if (n.type.name === "footnote" && n.attrs.text === "Avant") pos = p; return n.type.name !== "endnotes"; });
    e.commands.updateNote(pos, "Changée");
    expect(nodes(e).find((n) => n.type === "endnotes")?.content?.[0]?.content?.[0]?.text).toBe("Changée");
    // deleting both references removes the block
    e.commands.selectAll();
    e.commands.deleteSelection();
    expect(nodes(e).some((n) => n.type === "endnotes")).toBe(false);
  });

  it("an opened document that has endnotes gets its block at once", async () => {
    const e = make({ type: "doc", content: [{ type: "paragraph", content: [T("a"), { type: "footnote", attrs: { kind: "end", text: "Fin", n: 5 } }] }] });
    await new Promise((r) => setTimeout(r, 30)); // the editor announces its creation a moment after
    expect(nodes(e).some((n) => n.type === "endnotes")).toBe(true);
    expect(refs(e, "end")[0].n).toBe(1);
  });
});

describe("citations et bibliographie", () => {
  const sources = [
    { tag: "Dupont2020", type: "book", authors: [{ last: "Dupont", first: "Jean" }, { last: "Martin", first: "Anne" }], title: "Les chats", year: "2020", publisher: "Éditions du Seuil", city: "Paris", volume: "", pages: "", url: "" },
    { tag: "Bernard2019", type: "article", authors: [{ last: "Bernard", first: "Luc" }], title: "Sur les chiens", year: "2019", publisher: "Revue canine", city: "", volume: "12", pages: "33-48", url: "" },
  ];
  const make2 = () => make({ type: "doc", attrs: { sources, citationStyle: "apa" }, content: [{ type: "paragraph", content: [T("Texte.")] }] } as never);
  const cites = (e: Editor) => { const out: string[] = []; e.state.doc.descendants((n) => { if (n.type.name === "citation") out.push(String(n.attrs.text)); }); return out; };
  const entries = (e: Editor) => { const out: string[] = []; e.state.doc.descendants((n) => { if (n.type.name === "bibEntry") out.push(n.textContent); }); return out; };

  it("a citation is written from its source and the style of the document, and follows a change of style", () => {
    const e = make2();
    e.commands.setTextSelection(7);
    expect(e.commands.insertCitation({ tag: "Dupont2020", page: "12" })).toBe(true);
    expect(cites(e)).toEqual(["(Dupont & Martin, 2020, p. 12)"]);
    e.commands.setCitationStyle("mla");
    expect(cites(e)).toEqual(["(Dupont et Martin 12)"]);
    e.commands.setCitationStyle("numeric");
    expect(cites(e)).toEqual(["[1, p. 12]"]);
  });

  it("a citation of an unknown source is flagged, and follows the sources when they change", () => {
    const e = make2();
    expect(e.commands.insertCitation({ tag: "Inconnu" })).toBe(false);
    e.commands.insertCitation({ tag: "Bernard2019" });
    expect(cites(e)).toEqual(["(Bernard, 2019)"]);
    e.commands.setSources([{ ...sources[1], year: "2021" }] as never);
    expect(cites(e)).toEqual(["(Bernard, 2021)"]);
    e.commands.setSources([] as never);
    expect(cites(e)).toEqual(["[source manquante]"]);
  });

  it("the bibliography lists the cited sources in alphabetical order, with the titles in italics, and stays in step", () => {
    const e = make2();
    e.commands.insertCitation({ tag: "Dupont2020" });
    e.commands.insertCitation({ tag: "Bernard2019" });
    e.commands.insertBibliography();
    expect(entries(e)).toEqual(["Bernard, L. (2019). Sur les chiens. Revue canine, 12, 33–48.", "Dupont, J., & Martin, A. (2020). Les chats. Éditions du Seuil."]);
    const italics: string[] = [];
    e.state.doc.descendants((n) => { if (n.type.name === "text" && n.marks.some((m) => m.type.name === "italic")) italics.push(n.text!); });
    expect(italics).toEqual(["Revue canine", "12", "Les chats"]);
    // a source cited in addition appears; the "all sources" mode lists the others too
    e.commands.setSources([...sources, { ...sources[0], tag: "Autre", authors: [{ last: "Zola", first: "Émile" }], title: "Nana", year: "1880" }] as never);
    expect(entries(e)).toHaveLength(2);
    e.commands.removeBibliography();
    e.commands.insertBibliography({ mode: "all" });
    expect(entries(e)).toHaveLength(3);
    expect(entries(e)[2]).toContain("Zola");
  });

  it("the numeric style numbers the sources by first citation", () => {
    const e = make2();
    e.commands.insertCitation({ tag: "Dupont2020" });
    e.commands.insertCitation({ tag: "Bernard2019" });
    e.commands.setCitationStyle("numeric");
    e.commands.insertBibliography();
    expect(cites(e)).toEqual(["[1]", "[2]"]);
    expect(entries(e)[0].startsWith("[1] J. Dupont and A. Martin")).toBe(true);
    expect(entries(e)[1].startsWith("[2] L. Bernard")).toBe(true);
  });
});
