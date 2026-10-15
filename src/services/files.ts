import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { isTauri } from "../lib/platform";

export interface FileFilter {
  name: string;
  extensions: string[];
}

export const FILTERS = {
  docx: { name: "Document Word (.docx)", extensions: ["docx"] },
  doc: { name: "Document Word 97-2003 (.doc)", extensions: ["doc"] },
  odt: { name: "Document OpenDocument (.odt)", extensions: ["odt"] },
  loma: { name: "Document Loma (ancien format)", extensions: ["loma"] },
  html: { name: "Page web HTML", extensions: ["html", "htm"] },
  text: { name: "Texte brut", extensions: ["txt", "md"] },
} satisfies Record<string, FileFilter>;

function requireDesktop() {
  if (!isTauri()) throw new Error("Cette action nécessite l'application de bureau Loma Writer.");
}

export const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;
export const dirName = (path: string) => path.slice(0, Math.max(0, path.length - baseName(path).length - 1)) || "/";
export const extension = (path: string) => baseName(path).split(".").pop()?.toLowerCase() ?? "";

export async function pickFileToOpen(): Promise<string | null> {
  requireDesktop();
  const picked = await open({
    multiple: false,
    directory: false,
    filters: [
      { name: "Tous les documents pris en charge", extensions: ["docx", "doc", "odt", "loma", "html", "htm", "txt", "md"] },
      FILTERS.docx,
      FILTERS.doc,
      FILTERS.odt,
      FILTERS.loma,
      FILTERS.html,
      FILTERS.text,
    ],
  });
  return typeof picked === "string" ? picked : null;
}

export async function pickSavePath(defaultName: string, filters: FileFilter[]): Promise<string | null> {
  requireDesktop();
  return save({ defaultPath: defaultName, filters });
}

export async function readTextFile(path: string): Promise<string> {
  requireDesktop();
  return invoke<string>("read_text_file", { path });
}

export async function writeTextFile(path: string, contents: string): Promise<void> {
  requireDesktop();
  await invoke("write_text_file", { path, contents });
}

/** Native print dialog (Tauri); falls back to the webview print in a plain browser. */
export async function printPage(): Promise<void> {
  if (isTauri()) await invoke("print_page");
  else window.print();
}

/** Raw bytes of a document (DOCX, DOC, ODT…), read natively without any JSON/base64 detour. */
export async function readBinaryFile(path: string): Promise<Uint8Array> {
  requireDesktop();
  return new Uint8Array(await invoke<ArrayBuffer>("read_binary_file", { path }));
}

export async function writeBinaryFile(path: string, bytes: Uint8Array): Promise<void> {
  requireDesktop();
  await invoke("write_binary_file", bytes, { headers: { path: encodeURIComponent(path) } });
}

export const nativeFileIO = { readBytes: readBinaryFile, writeBytes: writeBinaryFile };
