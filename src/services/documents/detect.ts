import JSZip from "jszip";
import { ODT_MIME } from "./odtExport";
import { corrupt, DocumentError, type OpenFormat } from "./types";

const ext = (path: string) => path.split(".").pop()?.toLowerCase() ?? "";
const startsWith = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);

/** Recognises the real format from the content, not from the file name. */
export async function detectFormat(bytes: Uint8Array, path: string): Promise<OpenFormat> {
  const declared = ext(path);
  if (bytes.length === 0) throw corrupt("fichier vide");

  if (startsWith(bytes, [0x50, 0x4b])) {
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(bytes);
    } catch {
      throw corrupt("archive ZIP illisible");
    }
    const mimetype = (await zip.file("mimetype")?.async("string"))?.trim();
    if (mimetype === ODT_MIME) return "odt";
    if (mimetype?.startsWith("application/vnd.oasis.opendocument."))
      throw new DocumentError("unsupported", "Ce document OpenDocument n'est pas un document texte (.odt) : tableurs et présentations ne sont pas pris en charge.");
    if (zip.file("word/document.xml")) return "docx";
    if (zip.file("xl/workbook.xml") || zip.file("ppt/presentation.xml"))
      throw new DocumentError("unsupported", "Ce fichier Office n'est pas un document texte : tableurs et présentations ne sont pas pris en charge.");
    throw new DocumentError("unsupported", "Cette archive n'est ni un document Word (.docx) ni un document OpenDocument texte (.odt).");
  }
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "doc";
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) throw new DocumentError("unsupported", "Les fichiers PDF ne sont pas pris en charge à l'ouverture.");
  if (startsWith(bytes, [0x7b, 0x5c, 0x72, 0x74, 0x66])) throw new DocumentError("unsupported", "Le format RTF n'est pas pris en charge.");
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) || startsWith(bytes, [0xff, 0xd8])) throw new DocumentError("unsupported", "Ce fichier est une image, pas un document.");
  if (bytes.subarray(0, 8000).includes(0)) throw new DocumentError("unsupported", "Format de fichier non pris en charge.");

  // Text-based content.
  const head = new TextDecoder("utf-8").decode(bytes.subarray(0, 4096)).replace(/^﻿/, "").trimStart();
  if (["docx", "doc", "odt"].includes(declared)) throw corrupt(`ce n'est pas un vrai fichier .${declared}`);
  if (head.startsWith("{") && head.includes("loma-writer")) return "loma";
  if (declared === "loma") throw corrupt("ce n'est pas un document Loma Writer");
  if (/^<(!doctype html|html)/i.test(head) || declared === "html" || declared === "htm") return "html";
  return "txt";
}
