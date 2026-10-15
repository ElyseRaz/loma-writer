import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/react";
import { describe, expect, it } from "vitest";
import { lomaAdapter } from "../../services/documents/lomaAdapter";
import { createExtensions } from "../extensions";
import { SHAPES, isKnownShape } from "../shapes/catalog";
import { shapeSvg } from "../shapes/Shape";

const make = (html = "<p>x</p>") => new Editor({ extensions: createExtensions({ pagination: false }), content: html });
const json = (e: Editor) => e.getJSON() as unknown as JSONContent;
const shapes = (e: Editor) => (json(e).content ?? []).filter((n) => n.type === "shape");

describe("shape catalogue", () => {
  it("offers many shapes, each with a valid SVG path", () => {
    expect(SHAPES.length).toBeGreaterThanOrEqual(30);
    for (const s of SHAPES) {
      const d = s.path(180, 110);
      expect(d, s.id).toMatch(/^M/);
      expect(d, s.id).not.toMatch(/NaN|Infinity/);
      expect(isKnownShape(s.id)).toBe(true);
    }
    expect(new Set(SHAPES.map((s) => s.id)).size).toBe(SHAPES.length);
  });
  it("draws any size, even degenerate ones", () => {
    for (const s of SHAPES) expect(s.path(24, 24)).not.toMatch(/NaN/);
    expect(shapeSvg({ kind: "star5", width: 100, height: 80, fill: "#fff", stroke: "none", strokeWidth: 2 })).toContain("stroke-width=\"0\"");
  });
});

describe("shape commands", () => {
  it("inserts several shapes, one after the other, never inside each other", () => {
    const e = make("<p>Avant</p>");
    e.commands.focus("end");
    e.commands.insertShape("ellipse");
    e.commands.insertShape("rightArrow"); // caret is inside the first shape here
    e.commands.insertShape("textbox");
    const top = json(e).content!.map((n) => n.type);
    expect(top.filter((t) => t === "shape")).toHaveLength(3);
    expect(shapes(e).map((s) => s.attrs!.kind)).toEqual(["ellipse", "rightArrow", "textbox"]);
    expect(shapes(e).every((s) => (s.content ?? []).every((c) => c.type === "paragraph"))).toBe(true);
    expect(top.at(-1)).toBe("paragraph"); // something to type in after the last shape
  });

  it("puts the caret inside a new shape so typing goes there", () => {
    const e = make("<p></p>");
    e.commands.insertShape("hexagon");
    e.commands.insertContent("dans la forme");
    expect(JSON.stringify(shapes(e)[0].content)).toContain("dans la forme");
  });

  it("lines have no text and are selected", () => {
    const e = make();
    e.commands.focus("end");
    e.commands.insertShape("line");
    expect(shapes(e)[0].content ?? []).toHaveLength(0);
    expect(shapes(e)[0].attrs).toMatchObject({ kind: "line", fill: "none" });
  });

  it("updates fill, outline, type and size, with limits", () => {
    const e = make();
    e.commands.focus("end");
    e.commands.insertShape("rect");
    e.commands.updateShape({ fill: "#fef08a", stroke: "#dc2626", strokeWidth: 4, kind: "star5", width: 5, height: 5 });
    expect(shapes(e)[0].attrs).toMatchObject({ fill: "#fef08a", stroke: "#dc2626", strokeWidth: 4, kind: "star5", width: 8, height: 8 });
    e.commands.updateShape({ width: 99999 });
    expect(shapes(e)[0].attrs!.width).toBe(650);
    e.commands.updateShape({ align: "center" });
    expect(shapes(e)[0].attrs!.align).toBe("center");
  });

  it("deletes the shape holding the selection", () => {
    const e = make();
    e.commands.focus("end");
    e.commands.insertShape("diamond");
    expect(e.commands.deleteShape()).toBe(true);
    expect(shapes(e)).toHaveLength(0);
    expect(e.commands.deleteShape()).toBe(false);
  });

  it("round-trips through HTML", () => {
    const e = make();
    e.commands.focus("end");
    e.commands.insertShape("octagon", { fill: "#bbf7d0", width: 222 });
    e.commands.insertContent("texte");
    const copy = make(e.getHTML());
    expect(shapes(copy)[0].attrs).toMatchObject({ kind: "octagon", fill: "#bbf7d0", width: 222 });
    expect(JSON.stringify(shapes(copy)[0].content)).toContain("texte");
  });
});

describe("text boxes written before shapes existed", () => {
  it("open as text-box shapes in a legacy .loma file", async () => {
    const legacy = { format: "loma-writer", version: 1, page: { size: "A4", orientation: "portrait", margins: "normal" }, content: { type: "doc", content: [{ type: "textBox", content: [{ type: "paragraph", content: [{ type: "text", text: "Ancienne boîte" }] }, { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "puce" }] }] }] }] }] } };
    const { model } = await lomaAdapter.import(new TextEncoder().encode(JSON.stringify(legacy)));
    const box = model.content.content![0];
    expect(box.type).toBe("shape");
    expect(box.attrs).toMatchObject({ kind: "textbox" });
    expect(JSON.stringify(box.content)).toContain("Ancienne boîte");
    expect(JSON.stringify(box.content)).toContain("puce");
    // and the editor accepts it
    const e = make();
    e.commands.setContent(model.content);
    expect(shapes(e)).toHaveLength(1);
  });
});
