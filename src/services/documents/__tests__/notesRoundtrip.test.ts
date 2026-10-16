import { beforeAll, describe, expect, it } from "vitest";
import { setConverter } from "../converter";
import { exportDocx } from "../docxExport";
import { importDocx } from "../docxImport";
import { exportOdt } from "../odtExport";
import { importOdt } from "../odtImport";
import { nodeConverter } from "./lo";

beforeAll(() => setConverter(nodeConverter));

const body = [
  { type: "paragraph", content: [{ type: "text", text: "Gras", marks: [{ type: "bold" }] }, { type: "text", text: " et " }, { type: "text", text: "italique", marks: [{ type: "italic" }] }] },
  { type: "paragraph", content: [{ type: "text", text: "Second paragraphe." }] },
];
const notes = { foot: { format: "upperLetter", restart: "section", start: 3 }, end: { format: "lowerRoman", restart: "continuous", start: 1 } };
const model = () => ({
  content: { type: "doc", attrs: { notes }, content: [{ type: "paragraph", content: [{ type: "text", text: "Texte" }, { type: "footnote", attrs: { kind: "foot", n: 3, label: "C", text: "Gras et italique Second paragraphe.", body } }] }] },
  page: { size: "A4", orientation: "portrait", margins: "normal" },
}) as never;

type N = { type: string; text?: string; attrs?: Record<string, unknown>; marks?: Array<{ type: string }>; content?: N[] };
const footnote = (m: { content: N }) => { let f: N | null = null; const walk = (n: N) => { if (n.type === "footnote") f = n; n.content?.forEach(walk); }; walk(m.content); return f as N | null; };

describe.each([
  ["DOCX", async () => (await importDocx((await exportDocx(model())).bytes)).model],
  ["ODT", async () => (await importOdt((await exportOdt(model())).bytes)).model],
])("notes round trip %s", (_n, trip) => {
  it("keeps the paragraphs and the formatting of a note", async () => {
    const f = footnote((await trip()) as never)!;
    const b = f.attrs!.body as N[];
    expect(b).toHaveLength(2);
    expect(b[0].content!.find((c) => c.text === "Gras")!.marks!.map((m) => m.type)).toContain("bold");
    expect(b[0].content!.find((c) => c.text === "italique")!.marks!.map((m) => m.type)).toContain("italic");
    expect(b[1].content![0].text).toBe("Second paragraphe.");
  });
  it("keeps the numbering options", async () => {
    const m = (await trip()) as unknown as { content: { attrs?: { notes?: typeof notes } } };
    expect(m.content.attrs?.notes?.foot).toEqual(notes.foot);
  });
});
