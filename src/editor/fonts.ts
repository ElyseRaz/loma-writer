import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { isTauri } from "../lib/platform";

/** Fonts shipped with Microsoft Word / Office (they appear in the list whether or not they are installed). */
export const WORD_FONTS = [
  "Aptos", "Arial", "Arial Black", "Arial Narrow", "Bahnschrift", "Baskerville Old Face", "Book Antiqua", "Bookman Old Style", "Calibri", "Calibri Light",
  "Cambria", "Cambria Math", "Candara", "Century", "Century Gothic", "Century Schoolbook", "Comic Sans MS", "Consolas", "Constantia", "Corbel",
  "Courier New", "Franklin Gothic Medium", "Gabriola", "Garamond", "Georgia", "Gill Sans MT", "Impact", "Lucida Console", "Lucida Sans Unicode", "Microsoft Sans Serif",
  "Palatino Linotype", "Rockwell", "Segoe UI", "Segoe UI Light", "Segoe UI Semibold", "Sylfaen", "Symbol", "Tahoma", "Times New Roman", "Trebuchet MS",
  "Verdana", "Webdings", "Wingdings",
];

/** Free fonts with the same metrics, used when the Microsoft font is not installed (see the @font-face rules in index.css). */
export const FONT_SUBSTITUTES: Record<string, string> = {
  Calibri: "Carlito", Cambria: "Caladea", Arial: "Liberation Sans", "Times New Roman": "Liberation Serif", "Courier New": "Liberation Mono",
};

export interface FontLists {
  word: string[];
  system: string[];
}

let cache: Promise<string[]> | null = null;

/** Families installed on the machine: fontconfig through the desktop app, the Local Font Access API in a browser. */
export function systemFonts(): Promise<string[]> {
  cache ??= (async () => {
    try {
      if (isTauri()) return await invoke<string[]>("list_fonts");
      const query = (window as unknown as { queryLocalFonts?: () => Promise<Array<{ family: string }>> }).queryLocalFonts;
      if (query) return [...new Set((await query()).map((f) => f.family))].sort((a, b) => a.localeCompare(b));
    } catch {
      /* permission denied or no fontconfig: only the Word list is offered */
    }
    return [];
  })();
  return cache;
}

/** The Word fonts first, then the other installed ones. */
export function useFontLists(): FontLists {
  const [system, setSystem] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    void systemFonts().then((list) => live && setSystem(list));
    return () => { live = false; };
  }, []);
  const known = new Set(WORD_FONTS.map((f) => f.toLowerCase()));
  return { word: WORD_FONTS, system: system.filter((f) => !known.has(f.toLowerCase())) };
}
