import { DEFAULT_PAGE } from "../../state/types";
import { plainTextToHtml } from "../documentFormat";
import { ADAPTERS } from "./adapters";
import { detectFormat } from "./detect";
import { DocumentError, FORMAT_LABELS, type DocFormat, type DocumentModel, type ExportResult, type OpenFormat } from "./types";

export * from "./types";
export { setConverter, getConverter, tauriConverter, type Converter } from "./converter";

export const WRITABLE_FORMATS: DocFormat[] = ["docx", "odt", "doc", "loma"];
export const DEFAULT_FORMAT: DocFormat = "docx";

export const formatFromPath = (path: string): DocFormat | null => {
  const e = path.split(".").pop()?.toLowerCase();
  return e === "docx" || e === "doc" || e === "odt" || e === "loma" ? e : null;
};

/** Adds the extension of `format` unless the path already carries it (case-insensitive). */
export const withExtension = (path: string, format: DocFormat) => (new RegExp(`\\.${format}$`, "i").test(path) ? path : `${path}.${format}`);

export interface OpenedDocument {
  /** Real format of the file (not the extension). */
  format: OpenFormat;
  model: DocumentModel;
  /** Set for HTML imports, which the editor schema must parse itself. */
  html?: string;
  warnings: string[];
}

/** Reads a document from bytes. Never returns an empty document for a file it could not read. */
export async function openDocumentBytes(bytes: Uint8Array, path: string): Promise<OpenedDocument> {
  const format = await detectFormat(bytes, path);
  const warnings: string[] = [];
  const declared = path.split(".").pop()?.toLowerCase();
  if (declared && ["docx", "doc", "odt", "loma"].includes(declared) && declared !== format)
    warnings.push(`L'extension .${declared} ne correspond pas au contenu réel du fichier (format ${format.toUpperCase()}) : il a été ouvert selon son contenu.`);

  if (format === "html" || format === "txt") {
    const text = new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
    const html = format === "html" ? text : plainTextToHtml(text);
    return { format, model: { content: { type: "doc", content: [] }, page: DEFAULT_PAGE }, html, warnings };
  }
  const result = await ADAPTERS[format].import(bytes);
  return { format, model: result.model, warnings: [...warnings, ...result.warnings] };
}

export async function serializeDocument(format: DocFormat, model: DocumentModel): Promise<ExportResult> {
  const adapter = ADAPTERS[format];
  if (!adapter) throw new DocumentError("unsupported", `Format d'enregistrement inconnu : ${format}`);
  return adapter.export(model);
}

export interface FileIO {
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
}

/**
 * Serialises first and writes afterwards: if the conversion fails the file on disk is never touched,
 * and the write itself is atomic on the native side.
 */
export async function saveDocument(io: FileIO, path: string, format: DocFormat, model: DocumentModel): Promise<string[]> {
  const { bytes, warnings } = await serializeDocument(format, model);
  await io.writeBytes(path, bytes);
  return warnings;
}

export const loadDocument = async (io: FileIO, path: string) => openDocumentBytes(await io.readBytes(path), path);

export { FORMAT_LABELS };
