import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../lib/platform";
import { DocumentError } from "./types";

/** Local document converter. Implemented with a headless LibreOffice; documents never leave the machine. */
export interface Converter {
  isAvailable(): Promise<boolean>;
  convert(bytes: Uint8Array, from: "doc" | "docx", to: "doc" | "docx"): Promise<Uint8Array>;
}

export const LIBREOFFICE_HINT =
  "Les fichiers .doc nécessitent LibreOffice (conversion locale, aucune donnée n'est envoyée en ligne). Installez-le avec « sudo apt install libreoffice-writer » puis réessayez.";

export const tauriConverter: Converter = {
  async isAvailable() {
    return isTauri() && (await invoke<string | null>("libreoffice_path")) !== null;
  },
  async convert(bytes, from, to) {
    if (!isTauri()) throw new DocumentError("converter-missing", "La conversion des fichiers .doc nécessite l'application de bureau Loma Writer.");
    try {
      const out = await invoke<ArrayBuffer>("convert_document", bytes, { headers: { from, to } });
      return new Uint8Array(out);
    } catch (e) {
      const msg = String(e);
      if (msg.includes("LIBREOFFICE_MISSING")) throw new DocumentError("converter-missing", LIBREOFFICE_HINT);
      throw new DocumentError("conversion-failed", `La conversion a échoué : ${msg}`);
    }
  },
};

let current: Converter = tauriConverter;
export const getConverter = () => current;
/** Replaces the converter (tests, or a future built-in implementation). */
export const setConverter = (c: Converter) => { current = c; };
