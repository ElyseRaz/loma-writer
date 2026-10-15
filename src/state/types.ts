import type { HeaderFooterSettings } from "../pagination/headerFooter";
import type { DocStyles } from "../editor/docStyles";
import type { DocFormat } from "../services/documents/types";

export type ThemeMode = "light" | "dark" | "system";
export type RibbonTabId = "home" | "insert" | "layout" | "references" | "review" | "view";
export type PageSize = "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6" | "B5" | "Letter" | "Legal" | "Executive" | "Tabloid" | "Custom";
export type Orientation = "portrait" | "landscape";
export type MarginPreset = "normal" | "narrow" | "moderate" | "wide" | "mirrored";

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
  /** Only meaningful when `margins` is "custom". `left` and `right` are the inner and outer margins when the margins are mirrored. */
  customMarginsCm?: MarginsCm;
  /** Width and height in centimetres (portrait) when `size` is "Custom". */
  customSizeCm?: { width: number; height: number };
  /** Facing pages: the left margin is the inner one (kept by the file, applied by Word/LibreOffice when printing). */
  mirrored?: boolean;
  /** Binding margin, added on the left (or at the top) of every page. */
  gutterCm?: number;
  gutterPos?: "left" | "top";
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

export type DialogId = "preferences" | "about" | "link" | "wordCount" | "palette" | "unsaved" | "importReport" | "lossySave" | "margins" | "paper" | "paragraph" | "watermark" | "tableSize" | "styles" | "headerFooter" | "coverPage" | "icons" | "chart" | "bookmark" | "crossRef" | "equation" | null;

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
  /** Corner marks showing where the text area of each page starts. */
  textBounds: boolean;
  spellcheck: boolean;
  page: PageSetup;
  headerFooter: HeaderFooterSettings;
  /** Edited paragraph styles of the document (only the differences from the built-in look). */
  docStyles: DocStyles;
  /** Watermark of the document, or null. */
  watermark: import("../editor/watermark").Watermark | null;
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

export { PAGE_PX, MARGIN_PX, cmToPx, marginsPx, pageDimensions } from "./page";
