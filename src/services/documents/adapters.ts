import { docAdapter } from "./docAdapter";
import { exportDocx } from "./docxExport";
import { importDocx } from "./docxImport";
import { lomaAdapter } from "./lomaAdapter";
import { exportOdt } from "./odtExport";
import { importOdt } from "./odtImport";
import type { DocFormat, DocumentAdapter } from "./types";

export const docxAdapter: DocumentAdapter = { format: "docx", import: importDocx, export: exportDocx };
export const odtAdapter: DocumentAdapter = { format: "odt", import: importOdt, export: exportOdt };

export const ADAPTERS: Record<DocFormat, DocumentAdapter> = { docx: docxAdapter, doc: docAdapter, odt: odtAdapter, loma: lomaAdapter };
export { docAdapter, lomaAdapter };
