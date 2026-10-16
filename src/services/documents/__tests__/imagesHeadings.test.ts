import { beforeAll, describe, expect, it } from "vitest";
import { setConverter } from "../converter";
import { exportDocx } from "../docxExport";
import { importDocx } from "../docxImport";
import { exportOdt } from "../odtExport";
import { importOdt } from "../odtImport";
import { nodeConverter } from "./lo";

beforeAll(() => setConverter(nodeConverter));

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
type N = { type: string; attrs?: Record<string, unknown>; content?: N[]; text?: string };
const T = (text: string): N => ({ type: "text", text });
const pic = (a: Record<string, unknown>): N => ({ type: "image", attrs: { src: PNG, width: 120, height: 80, rotation: 0, ...a } });
const model = () => ({
  content: { type: "doc", content: [
    ...[1, 2, 3, 4, 5, 6].map((level) => ({ type: "heading", attrs: { level }, content: [T(`Titre ${level}`)] })),
    { type: "paragraph", content: [T("Texte"), pic({ wrap: "square", anchor: "paragraph", x: 300, y: 10, z: 0 }), pic({ wrap: "front", anchor: "page", x: 200, y: 300, z: 2 }), pic({ wrap: "behind", anchor: "page", x: 50, y: 60, z: -3 })] },
  ] },
  page: { size: "A4", orientation: "portrait", margins: "normal" },
}) as never;

const find = (n: N, type: string, out: N[] = []): N[] => { if (n.type === type) out.push(n); n.content?.forEach((c) => find(c, type, out)); return out; };

describe.each([
  ["DOCX", async () => importDocx((await exportDocx(model())).bytes)],
  ["ODT", async () => importOdt((await exportOdt(model())).bytes)],
])("%s round trip", (_n, trip) => {
  it("keeps the six heading levels", async () => {
    const { model: m, warnings } = await trip();
    expect(find((m as { content: N }).content, "heading").map((h) => h.attrs!.level)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(warnings.join("|")).not.toMatch(/niveau/);
  });
  it("keeps the wrapping of floating pictures", async () => {
    const { model: m, warnings } = await trip();
    const pics = find((m as { content: N }).content, "image");
    expect(pics.map((p) => p.attrs!.wrap)).toEqual(["square", "front", "behind"]);
    expect(pics[1].attrs!.anchor).toBe("page");
    expect(Math.abs(Number(pics[1].attrs!.x) - 200)).toBeLessThanOrEqual(2);
    expect(Math.abs(Number(pics[1].attrs!.y) - 300)).toBeLessThanOrEqual(2);
    expect(warnings.join("|")).not.toMatch(/flottantes/);
    expect(pics.every((p) => !("_raw" in p.attrs!))).toBe(true);
  });
});
