import type { JSONContent } from "@tiptap/react";
import type { PageSetup } from "../state/types";

/**
 * Header/footer model. Content is a list of ProseMirror blocks (paragraphs with formatting, images, tables) in
 * which page numbers are `pageField` inline nodes, so headers and footers are as rich as the document body.
 */
export type HFBlock = JSONContent;

export interface HeaderFooterContent {
  blocks: HFBlock[];
}

export interface HeaderFooterSet {
  default?: HeaderFooterContent;
  /** Used for the first page of a section when `titlePage` is on. */
  first?: HeaderFooterContent;
  /** Used for even pages when `evenOdd` is on. */
  even?: HeaderFooterContent;
}

export interface SectionLayout {
  page: PageSetup;
  header: HeaderFooterSet;
  footer: HeaderFooterSet;
  /** "Different first page". */
  titlePage: boolean;
  /** "Different odd and even pages". */
  evenOdd: boolean;
  /** Number shown on the first page of the section (continues from the previous section when null). */
  startNumber: number | null;
}

export const emptySection = (page: PageSetup): SectionLayout => ({ page, header: {}, footer: {}, titlePage: false, evenOdd: false, startNumber: null });

/** Which part of a set applies to the page at `indexInSection` (0-based) and `pageNumber` (1-based, displayed). */
export function pickHeaderFooter(set: HeaderFooterSet, section: Pick<SectionLayout, "titlePage" | "evenOdd">, indexInSection: number, pageNumber: number): HeaderFooterContent | null {
  if (section.titlePage && indexInSection === 0) return set.first ?? null;
  if (section.evenOdd && pageNumber % 2 === 0) return set.even ?? null;
  return set.default ?? null;
}

/** Displayed page number of a page, honouring the section start number. */
export function displayedPageNumber(sections: SectionLayout[], sectionIndex: number, indexInSection: number, pagesBefore: number): number {
  const s = sections[sectionIndex];
  if (s?.startNumber != null) return s.startNumber + indexInSection;
  return pagesBefore + indexInSection + 1;
}

/** What a document stores about its headers and footers (one section for now). */
export interface HeaderFooterSettings {
  header: HeaderFooterSet;
  footer: HeaderFooterSet;
  titlePage: boolean;
  evenOdd: boolean;
}

export const emptyHeaderFooter = (): HeaderFooterSettings => ({ header: {}, footer: {}, titlePage: false, evenOdd: false });

// ----------------------------------------------------------------------------- content helpers

/** True when the blocks show nothing: no text, no image, no page number, no table content. */
export function isEmptyBlocks(blocks: HFBlock[] | undefined): boolean {
  const visible = (n: HFBlock): boolean => n.type === "image" || n.type === "pageField" || (n.type === "text" && !!n.text?.trim()) || (n.content ?? []).some(visible);
  return !(blocks ?? []).some(visible);
}

const has = (c?: HeaderFooterContent) => !!c && !isEmptyBlocks(c.blocks);
export const hasContent = (set: HeaderFooterSet) => has(set.default) || has(set.first) || has(set.even);
export const isEmptyHeaderFooter = (s: HeaderFooterSettings) => !hasContent(s.header) && !hasContent(s.footer);

/** Paragraph from text containing {PAGE} / {PAGES} (a quick way to write "Page 1 sur N"). */
export function paragraphFromTemplate(text: string, align?: "left" | "center" | "right"): HFBlock {
  const content: HFBlock[] = text.split(/(\{PAGE\}|\{PAGES\})/).filter(Boolean).map((part) => (part === "{PAGE}" ? { type: "pageField", attrs: { kind: "page" } } : part === "{PAGES}" ? { type: "pageField", attrs: { kind: "pages" } } : { type: "text", text: part }));
  return { type: "paragraph", ...(align && align !== "left" ? { attrs: { textAlign: align } } : {}), ...(content.length ? { content } : {}) };
}

export const contentFromTemplate = (text: string, align?: "left" | "center" | "right"): HeaderFooterContent => ({ blocks: [paragraphFromTemplate(text, align)] });

/** Plain text of the blocks with page fields as {PAGE}/{PAGES} (used for tests and previews). */
export function templateOf(blocks: HFBlock[] | undefined): string {
  const walk = (n: HFBlock): string => (n.type === "text" ? n.text ?? "" : n.type === "pageField" ? (n.attrs?.kind === "pages" ? "{PAGES}" : "{PAGE}") : n.type === "hardBreak" ? "\n" : (n.content ?? []).map(walk).join(""));
  return (blocks ?? []).map(walk).join("\n");
}

/** Reserved space for a header or footer: distance from the page edge + its height + a little air. */
export const HEADER_FOOTER_DISTANCE = 30;
export const reserveFor = (contentHeight: number) => HEADER_FOOTER_DISTANCE + contentHeight + 10;
/** Used until the real height has been measured. */
export const HEADER_FOOTER_RESERVE = 60;

export function sectionFor(page: PageSetup, hf: HeaderFooterSettings): SectionLayout {
  return { page, header: hf.header, footer: hf.footer, titlePage: hf.titlePage, evenOdd: hf.evenOdd, startNumber: null };
}

// ----------------------------------------------------------------------------- sanitising

const ALLOWED = new Set(["paragraph", "text", "hardBreak", "image", "pageField", "table", "tableRow", "tableCell", "tableHeader"]);
const ALIGNS = new Set(["left", "center", "right", "justify"]);

/** Keeps only what a header can show, so a hand-edited or foreign file cannot break the layout. */
function cleanNode(n: HFBlock): HFBlock[] {
  if (!n || typeof n.type !== "string") return [];
  if (n.type === "heading") return cleanNode({ ...n, type: "paragraph", attrs: { textAlign: n.attrs?.textAlign } });
  if (["bulletList", "orderedList", "listItem", "blockquote", "codeBlock", "shape"].includes(n.type)) return (n.content ?? []).flatMap(cleanNode);
  if (!ALLOWED.has(n.type)) return [];
  if (n.type === "text") return typeof n.text === "string" && n.text ? [{ type: "text", text: n.text.slice(0, 2000), ...(n.marks?.length ? { marks: n.marks } : {}) }] : [];
  if (n.type === "image") return typeof n.attrs?.src === "string" && n.attrs.src.startsWith("data:image/") ? [{ type: "image", attrs: n.attrs }] : [];
  if (n.type === "pageField") return [{ type: "pageField", attrs: { kind: n.attrs?.kind === "pages" ? "pages" : "page" } }];
  if (n.type === "hardBreak") return [{ type: "hardBreak" }];
  const content = (n.content ?? []).flatMap(cleanNode);
  const attrs = { ...(n.attrs ?? {}) } as Record<string, unknown>;
  if (n.type === "paragraph") {
    if (!ALIGNS.has(String(attrs.textAlign))) delete attrs.textAlign;
    if (attrs.textAlign === "left") delete attrs.textAlign;
  }
  return [{ type: n.type, ...(Object.keys(attrs).length ? { attrs } : {}), ...(content.length ? { content } : {}) }];
}

function cleanContent(raw: unknown): HeaderFooterContent | undefined {
  const c = raw as { blocks?: HFBlock[]; text?: string; align?: "left" | "center" | "right" } | undefined;
  if (!c) return undefined;
  let blocks: HFBlock[];
  if (Array.isArray(c.blocks)) blocks = c.blocks.flatMap(cleanNode);
  else if (typeof c.text === "string") blocks = [paragraphFromTemplate(c.text.slice(0, 500), c.align)]; // documents saved before rich headers
  else return undefined;
  // Word keeps an empty paragraph after a table or at the end: drop trailing empty paragraphs.
  while (blocks.length > 1 && blocks[blocks.length - 1].type === "paragraph" && isEmptyBlocks([blocks[blocks.length - 1]])) blocks.pop();
  return isEmptyBlocks(blocks) ? undefined : { blocks };
}

export function sanitizeHeaderFooter(raw: unknown): HeaderFooterSettings {
  const r = (raw ?? {}) as Partial<HeaderFooterSettings>;
  const set = (s: unknown): HeaderFooterSet => {
    const v = (s ?? {}) as HeaderFooterSet;
    const out: HeaderFooterSet = {};
    for (const k of ["default", "first", "even"] as const) { const c = cleanContent(v[k]); if (c) out[k] = c; }
    return out;
  };
  return { header: set(r.header), footer: set(r.footer), titlePage: !!r.titlePage, evenOdd: !!r.evenOdd };
}
