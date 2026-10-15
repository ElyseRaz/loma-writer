import { generateHTML } from "@tiptap/html";
import type { Extensions } from "@tiptap/react";
import { createHeaderFooterExtensions } from "../editor/headerFooterExtensions";
import type { HFBlock } from "../pagination/headerFooter";

let extensions: Extensions | null = null;
const cache = new Map<string, string>();

/** HTML of header/footer blocks. Page fields are left as markers, replaced per page by `withPageNumbers`. */
export function headerFooterHtml(blocks: HFBlock[]): string {
  const key = JSON.stringify(blocks);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  extensions ??= createHeaderFooterExtensions();
  let html = "";
  try {
    html = generateHTML({ type: "doc", content: blocks }, extensions);
  } catch {
    html = ""; // content the schema rejects shows nothing rather than breaking the page
  }
  if (cache.size > 50) cache.clear();
  cache.set(key, html);
  return html;
}

export const withPageNumbers = (html: string, page: number, total: number) =>
  html.replace(/<span[^>]*data-page-field="page"[^>]*>[^<]*<\/span>/g, String(page)).replace(/<span[^>]*data-page-field="pages"[^>]*>[^<]*<\/span>/g, String(total));
