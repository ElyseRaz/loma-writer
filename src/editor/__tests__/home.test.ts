import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/react";
import { describe, expect, it } from "vitest";
import { createExtensions } from "../extensions";
import { applyFormat, captureFormat } from "../formatPainter";
import { findKey, findMatches, replacedCount } from "../FindReplace";

const make = (html: string) => new Editor({ extensions: createExtensions({ pagination: false }), content: html });
const json = (e: Editor): JSONContent => e.getJSON() as unknown as JSONContent;
const text = (e: Editor) => e.getText({ blockSeparator: "|" });

describe("Rechercher", () => {
  it("finds every occurrence, ignoring case by default", () => {
    const e = make("<p>Chat chat CHAT</p><p>un chaton</p>");
    expect(findMatches(e.state.doc, "chat", { caseSensitive: false, wholeWord: false })).toHaveLength(4);
    expect(findMatches(e.state.doc, "chat", { caseSensitive: true, wholeWord: false })).toHaveLength(2); // chat + chaton
    expect(findMatches(e.state.doc, "chat", { caseSensitive: false, wholeWord: true })).toHaveLength(3); // not "chaton"
  });

  it("matches through formatting marks and gives exact document ranges", () => {
    const e = make("<p>bon<strong>jour</strong> le monde</p>");
    const [m] = findMatches(e.state.doc, "bonjour", { caseSensitive: false, wholeWord: false });
    expect(e.state.doc.textBetween(m.from, m.to)).toBe("bonjour");
    const [accent] = findMatches(make("<p>Élément 21</p>").state.doc, "élément", { caseSensitive: false, wholeWord: false });
    expect(accent).toBeTruthy();
  });

  it("never matches across paragraphs and handles an empty query", () => {
    const e = make("<p>abc</p><p>def</p>");
    expect(findMatches(e.state.doc, "cd", { caseSensitive: false, wholeWord: false })).toHaveLength(0);
    expect(findMatches(e.state.doc, "", { caseSensitive: false, wholeWord: false })).toHaveLength(0);
  });

  it("walks through the matches and selects them", () => {
    const e = make("<p>un deux un trois un</p>");
    e.commands.setFind("un");
    const s = () => findKey.getState(e.state)!;
    expect(s().matches).toHaveLength(3);
    expect(s().current).toBe(0);
    e.commands.findNext();
    expect(s().current).toBe(1);
    expect(e.state.doc.textBetween(e.state.selection.from, e.state.selection.to)).toBe("un");
    e.commands.findPrevious();
    e.commands.findPrevious();
    expect(s().current).toBe(2); // wraps around
  });

  it("starts from the caret", () => {
    const e = make("<p>un deux un trois un</p>");
    e.commands.setTextSelection(12);
    e.commands.setFind("un");
    expect(findKey.getState(e.state)!.current).toBe(2);
  });
});

describe("Remplacer", () => {
  it("replaces the current match then moves on", () => {
    const e = make("<p>un deux un trois un</p>");
    e.commands.setFind("un");
    e.commands.replaceCurrent("1");
    expect(text(e)).toBe("1 deux un trois un");
    expect(findKey.getState(e.state)!.matches).toHaveLength(2);
    e.commands.replaceCurrent("1");
    expect(text(e)).toBe("1 deux 1 trois un");
  });

  it("replaces all matches in one undoable step and reports the count", () => {
    const e = make("<p>un deux un</p><p>un trois</p>");
    e.commands.setFind("un");
    expect(e.commands.replaceAll("zéro")).toBe(true);
    expect(replacedCount(e)).toBe(3);
    expect(text(e)).toBe("zéro deux zéro|zéro trois");
    e.commands.undo();
    expect(text(e)).toBe("un deux un|un trois");
  });

  it("keeps the formatting of the replaced text", () => {
    const e = make("<p>un <strong>deux</strong> trois</p>");
    e.commands.setFind("deux");
    e.commands.replaceAll("2");
    expect(e.getHTML()).toContain("<strong>2</strong>");
  });

  it("replaces with a longer or empty string without corrupting positions", () => {
    const e = make("<p>aXbXc</p><p>XX</p>");
    e.commands.setFind("X");
    e.commands.replaceAll("--");
    expect(text(e)).toBe("a--b--c|----");
    e.commands.setFind("-");
    e.commands.replaceAll("");
    expect(text(e)).toBe("abc|");
  });

  it("does nothing when there is no match, and clearFind removes the highlights", () => {
    const e = make("<p>abc</p>");
    e.commands.setFind("zzz");
    expect(e.commands.replaceAll("x")).toBe(false);
    e.commands.setFind("b");
    expect(findKey.getState(e.state)!.matches).toHaveLength(1);
    e.commands.clearFind();
    expect(findKey.getState(e.state)!.matches).toHaveLength(0);
    expect(text(e)).toBe("abc");
  });
});

describe("Reproduire la mise en forme", () => {
  it("copies character formatting and paragraph alignment onto another selection", () => {
    const e = make('<p style="text-align:center"><strong><em>Source</em></strong></p><p>Cible simple</p>');
    e.commands.setTextSelection(3);
    const format = captureFormat(e);
    expect(format.marks.map((m) => m.type).sort()).toEqual(["bold", "italic"]);
    e.commands.setTextSelection({ from: 9, to: 15 }); // "Cible " in the second paragraph
    expect(applyFormat(e, format)).toBe(true);
    const target = json(e).content![1].content!.find((n) => n.text === "Cible ")!;
    expect(target.marks!.map((m) => m.type).sort()).toEqual(["bold", "italic"]);
    expect(json(e).content![1].attrs!.textAlign).toBe("center");
  });

  it("replaces the previous formatting of the target and ignores an empty selection", () => {
    const e = make("<p>plain</p><p><u>souligné</u> reste</p>");
    e.commands.setTextSelection(3);
    const plain = captureFormat(e);
    expect(plain.marks).toEqual([]);
    e.commands.setTextSelection({ from: 8, to: 12 });
    applyFormat(e, plain);
    expect(e.getHTML()).not.toMatch(/<u>souli/);
    e.commands.setTextSelection(3);
    expect(applyFormat(e, plain)).toBe(false);
  });

  it("does not copy links", () => {
    const e = make('<p><a href="https://x.org">lien</a></p>');
    e.commands.setTextSelection(2);
    expect(captureFormat(e).marks.some((m) => m.type === "link")).toBe(false);
  });
});

describe("Trame de fond et bordures", () => {
  it("shades the selected paragraphs only", () => {
    const e = make("<p>un</p><p>deux</p><p>trois</p>");
    e.commands.setTextSelection({ from: 2, to: 8 }); // un + deux
    e.commands.setShading("#fef08a");
    const paras = json(e).content!;
    expect(paras.map((p) => p.attrs?.shading ?? null)).toEqual(["#fef08a", "#fef08a", null]);
    expect(e.getHTML()).toContain("data-shading=\"#fef08a\"");
    e.commands.setShading(null);
    expect(json(e).content!.every((p) => !p.attrs?.shading)).toBe(true);
  });

  it("toggles one border side, and sets or clears all of them", () => {
    const e = make("<p>texte</p>");
    e.commands.setTextSelection(3);
    e.commands.setBorders("bottom");
    expect(json(e).content![0].attrs!.borders).toEqual({ bottom: true });
    e.commands.setBorders("top");
    expect(json(e).content![0].attrs!.borders).toEqual({ bottom: true, top: true });
    e.commands.setBorders("bottom"); // toggled off
    expect(json(e).content![0].attrs!.borders).toEqual({ bottom: false, top: true });
    e.commands.setBorders("all");
    expect(json(e).content![0].attrs!.borders).toEqual({ top: true, right: true, bottom: true, left: true });
    e.commands.setBorders("none");
    expect(json(e).content![0].attrs!.borders ?? null).toBeNull();
  });

  it("round-trips through HTML", () => {
    const e = make("<p>a</p>");
    e.commands.setTextSelection(1);
    e.commands.setShading("#bbf7d0");
    e.commands.setBorders("left");
    const copy = make(e.getHTML());
    expect(copy.getJSON().content![0].attrs).toMatchObject({ shading: "#bbf7d0", borders: { left: true } });
  });

  it("applies shading and borderless to table cells", () => {
    const e = make("<table><tbody><tr><td><p>a</p></td><td><p>b</p></td></tr></tbody></table>");
    e.commands.setTextSelection(4); // inside the first cell: shades the paragraph, not the cell
    e.commands.setShading("#e5e7eb");
    expect(json(e).content![0].content![0].content![0].content![0].attrs!.shading).toBe("#e5e7eb");
  });
});
