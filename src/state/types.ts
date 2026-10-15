import type { HeaderFooterSettings } from "../pagination/headerFooter";
import type { DocStyles } from "../editor/docStyles";
import type { DocFormat } from "../services/documents/types";

export type ThemeMode = "light" | "dark" | "system";
export type RibbonTabId = "home" | "insert" | "layout" | "references" | "review" | "view";
export type PageSize = "A4" | "A5" | "Letter";
export type Orientation = "portrait" | "landscape";
export type MarginPreset = "normal" | "narrow" | "wide";

/** Page margins in centimetres, used when no preset matches. */
export interface MarginsCm {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PageSetup {
  size: PageSize;
  orientation: Orientation;
  margins: MarginPreset | "custom";
  /** Only meaningful when `margins` is "custom". */
  customMarginsCm?: MarginsCm;
}

export interface Preferences {
  fontFamily: string;
  fontSizePt: number;
  autosave: boolean;
}

/** Character and paragraph formatting captured by "Reproduire la mise en forme". */
export interface PainterFormat {
  marks: Array<{ type: string; attrs?: Record<string, unknown> }>;
  align: string | null;
}

export interface DocumentMeta {
  /** File name without extension. */
  title: string;
  path: string | null;
  dirty: boolean;
  /** Format the next "Enregistrer" writes. Never changed silently. */
  format: DocFormat;
  /** Elements of the source file that were not imported: overwriting the source would lose them. */
  lossy: string[];
}

export type DialogId = "preferences" | "about" | "link" | "wordCount" | "palette" | "unsaved" | "importReport" | "lossySave" | "margins" | "tableSize" | "styles" | "headerFooter" | "coverPage" | "icons" | "chart" | "bookmark" | "crossRef" | "equation" | null;

export interface AppState {
  theme: ThemeMode;
  view: "editor" | "backstage";
  tab: RibbonTabId;
  ribbonCollapsed: boolean;
  zoom: number;
  navPane: boolean;
  ruler: boolean;
  marks: boolean;
  /** Show the flags of bookmarks in the text. */
  bookmarks: boolean;
  spellcheck: boolean;
  page: PageSetup;
  headerFooter: HeaderFooterSettings;
  /** Edited paragraph styles of the document (only the differences from the built-in look). */
  docStyles: DocStyles;
  /** Style the style dialog opens on. */
  styleTarget: import("../editor/docStyles").StyleId;
  /** Which dialog variant is open: header or footer. */
  hfKind: "header" | "footer";
  /** Position of the equation being edited (null: a new one). */
  equationPos: number | null;
  prefs: Preferences;
  doc: DocumentMeta;
  dialog: DialogId;
  /** Find/replace bar. `nonce` re-focuses the search field when the shortcut is pressed again. */
  find: { open: boolean; replace: boolean; nonce: number };
  /** Armed format painter: the next selection receives this formatting. */
  painter: PainterFormat | null;
  /** Result of the last import, shown when it was not perfectly faithful. */
  importReport: { name: string; warnings: string[] } | null;
  /** Action to run once the user has resolved the "unsaved changes" dialog. */
  pendingAction: (() => void) | null;
  toast: { id: number; message: string; kind: "info" | "error" } | null;
  /** Bumped whenever a whole new document is loaded so views can reset. */
  docRevision: number;
}

export const DEFAULT_PAGE: PageSetup = { size: "A4", orientation: "portrait", margins: "normal" };

export const PAGE_PX: Record<PageSize, { w: number; h: number }> = {
  A4: { w: 794, h: 1123 },
  A5: { w: 559, h: 794 },
  Letter: { w: 816, h: 1056 },
};
export const MARGIN_PX: Record<MarginPreset, number> = { normal: 96, narrow: 48, wide: 144 };

const PX_PER_CM = 96 / 2.54;
export const cmToPx = (cm: number) => cm * PX_PER_CM;

/** Margins of a page in CSS px (96 dpi), whether preset or custom. */
export function marginsPx(p: PageSetup): { top: number; right: number; bottom: number; left: number } {
  if (p.margins === "custom" && p.customMarginsCm) {
    const m = p.customMarginsCm;
    return { top: cmToPx(m.top), right: cmToPx(m.right), bottom: cmToPx(m.bottom), left: cmToPx(m.left) };
  }
  const px = MARGIN_PX[p.margins === "custom" ? "normal" : p.margins];
  return { top: px, right: px, bottom: px, left: px };
}

export function pageDimensions(p: PageSetup) {
  const base = PAGE_PX[p.size];
  return p.orientation === "portrait" ? base : { w: base.h, h: base.w };
}
