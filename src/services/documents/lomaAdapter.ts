import { cleanWatermark } from "../../editor/watermark";
import { DEFAULT_PAGE } from "../../state/types";
import type { PM } from "./pm";
import { corrupt, type DocumentAdapter, type DocumentModel, type ExportResult, type ImportResult } from "./types";
import { sanitizePage } from "./sanitize";
import { isEmptyHeaderFooter, sanitizeHeaderFooter } from "../../pagination/headerFooter";

/** Text boxes written before shapes existed: a bordered container of blocks -> a text-box shape holding its paragraphs. */
function migrateTextBox(box: PM): PM {
  const paragraphs: PM[] = [];
  const walk = (n: PM) => (n.type === "paragraph" || n.type === "heading" ? paragraphs.push({ type: "paragraph", content: n.content }) : (n.content ?? []).forEach(walk));
  (box.content ?? []).forEach(walk);
  return { type: "shape", attrs: { kind: "textbox", width: 480, height: 60, fill: "#ffffff", stroke: "#6b7280", strokeWidth: 1, align: "left" }, content: paragraphs.length ? paragraphs : [{ type: "paragraph" }] };
}

const MIGRATED = "Ancien document Loma : les images isolées ont été placées dans des paragraphes.";

/** Legacy internal format: JSON around the ProseMirror document. Still readable and writable. */
export const lomaAdapter: DocumentAdapter = {
  format: "loma",
  async import(bytes): Promise<ImportResult> {
    const text = new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
    let data: { format?: string; version?: number; page?: unknown; headerFooter?: unknown; watermark?: unknown; content?: PM };
    try {
      data = JSON.parse(text);
    } catch {
      throw corrupt("JSON illisible");
    }
    if (data.format !== "loma-writer" || !data.content) throw corrupt("ce n'est pas un document Loma Writer");
    if (data.version !== 1) throw new Error("Ce document a été créé par une version plus récente de Loma Writer.");
    const warnings: string[] = [];
    // Older files stored images as top-level blocks; images are inline nodes now.
    const content = (data.content.content ?? []).map((n) => {
      if (n.type === "textBox") return migrateTextBox(n);
      if (n.type !== "image") return n;
      if (!warnings.length) warnings.push(MIGRATED);
      return { type: "paragraph", content: [n] };
    });
    return { model: { content: { ...data.content, content }, page: sanitizePage(data.page as Partial<typeof DEFAULT_PAGE>), ...(data.headerFooter ? { headerFooter: sanitizeHeaderFooter(data.headerFooter) } : {}), ...(cleanWatermark(data.watermark) ? { watermark: cleanWatermark(data.watermark) } : {}) }, warnings };
  },
  async export(model: DocumentModel): Promise<ExportResult> {
    const file = { format: "loma-writer", version: 1, page: model.page, ...(model.headerFooter && !isEmptyHeaderFooter(model.headerFooter) ? { headerFooter: model.headerFooter } : {}), ...(cleanWatermark(model.watermark) ? { watermark: model.watermark } : {}), content: model.content };
    return { bytes: new TextEncoder().encode(JSON.stringify(file, null, 2)), warnings: [] };
  },
};
