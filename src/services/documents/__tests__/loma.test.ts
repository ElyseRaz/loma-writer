import { describe, expect, it } from "vitest";
import { lomaAdapter } from "../lomaAdapter";
import { openDocumentBytes } from "../index";
import { PNG_1x1, richModel } from "./fixtures";

const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

describe("legacy .loma files", () => {
  it("opens a document written by Loma Writer 0.1.0 (block-level image, no BOM)", async () => {
    const legacy = {
      format: "loma-writer", version: 1,
      page: { size: "A5", orientation: "landscape", margins: "wide" },
      content: { type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Ancien" }] }, { type: "image", attrs: { src: PNG_1x1 } }] },
    };
    const opened = await openDocumentBytes(enc(legacy), "vieux.loma");
    expect(opened.format).toBe("loma");
    expect(opened.model.page).toEqual(legacy.page);
    expect(opened.model.content.content![1]).toEqual({ type: "paragraph", content: [{ type: "image", attrs: { src: PNG_1x1 } }] });
    expect(opened.warnings.join()).toMatch(/Ancien document Loma/);
  });
  it("ignores unknown or missing page values instead of crashing", async () => {
    const opened = await openDocumentBytes(enc({ format: "loma-writer", version: 1, page: { size: "Z9", margins: 3 }, content: { type: "doc", content: [] } }), "x.loma");
    expect(opened.model.page).toEqual({ size: "A4", orientation: "portrait", margins: "normal" });
  });
  it("round-trips through the adapter and rejects newer versions", async () => {
    const { bytes } = await lomaAdapter.export(richModel());
    expect((await lomaAdapter.import(bytes)).model.content).toEqual(richModel().content);
    await expect(openDocumentBytes(enc({ format: "loma-writer", version: 2, content: { type: "doc" } }), "x.loma")).rejects.toThrow(/plus récente/);
  });
});
