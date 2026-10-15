import type { JSONContent } from "@tiptap/react";
import type { DocStyles } from "../../editor/docStyles";
import type { HeaderFooterSettings } from "../../pagination/headerFooter";
import type { PageSetup } from "../../state/types";

/** Formats Loma Writer can write. `loma` is the legacy internal format, kept readable and writable. */
export type DocFormat = "docx" | "doc" | "odt" | "loma";
/** Everything we can open: the writable formats plus import-only ones. */
export type OpenFormat = DocFormat | "html" | "txt";

export const FORMAT_LABELS: Record<DocFormat, string> = {
  docx: "Document Word (.docx)",
  doc: "Document Word 97-2003 (.doc)",
  odt: "Document OpenDocument (.odt)",
  loma: "Document Loma (ancien format)",
};

/** Document model shared by every adapter: a ProseMirror document plus page setup. */
export interface DocumentModel {
  content: JSONContent;
  page: PageSetup;
  headerFooter?: HeaderFooterSettings;
  /** Edited paragraph styles (Normal, headings, quote, code). */
  styles?: DocStyles;
  /** Default font of the document, written to the file so other editors show the same text style. */
  defaults?: { fontFamily: string; fontSizePt: number };
}

export interface ImportResult {
  model: DocumentModel;
  /** Human-readable list of what could not be imported faithfully. */
  warnings: string[];
}

export interface ExportResult {
  bytes: Uint8Array;
  warnings: string[];
}

/** Import and export are separate operations, so a format may be read-only or write-only. */
export interface DocumentAdapter {
  readonly format: DocFormat;
  import(bytes: Uint8Array): Promise<ImportResult>;
  export(model: DocumentModel): Promise<ExportResult>;
}

export type ErrorCode = "corrupt" | "unsupported" | "converter-missing" | "conversion-failed" | "unreadable-content";

export class DocumentError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DocumentError";
  }
}

export const corrupt = (what: string) => new DocumentError("corrupt", `Le fichier est corrompu ou incomplet (${what}).`);
