import { getConverter } from "./converter";
import { exportDocx } from "./docxExport";
import { importDocx } from "./docxImport";
import { corrupt, type DocumentAdapter, type DocumentModel, type ExportResult, type ImportResult } from "./types";

const OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/**
 * Legacy binary Word format (.doc). There is no reliable pure-Rust/TypeScript reader or writer, so the
 * file is converted locally with a headless LibreOffice and then handled by the DOCX adapter.
 */
export const docAdapter: DocumentAdapter = {
  format: "doc",
  async import(bytes): Promise<ImportResult> {
    if (!OLE2.every((b, i) => bytes[i] === b)) throw corrupt("en-tête Word 97-2003 absent");
    const docx = await getConverter().convert(bytes, "doc", "docx");
    const result = await importDocx(docx);
    return { ...result, warnings: ["Ce fichier .doc a été converti par LibreOffice avant l'importation.", ...result.warnings] };
  },
  async export(model: DocumentModel): Promise<ExportResult> {
    const docx = await exportDocx(model);
    const doc = await getConverter().convert(docx.bytes, "docx", "doc");
    return { bytes: doc, warnings: docx.warnings };
  },
};
