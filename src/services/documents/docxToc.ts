import type { PM } from "./pm";

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const text = (n: PM): string => (n.text ?? "") + (n.content ?? []).map(text).join("");

/** Name of the bookmark Word links a table of contents entry to (one per heading, by rank). */
export const tocBookmark = (rank: number) => `_TocLoma${String(rank + 1).padStart(6, "0")}`;

const run = (t: string) => `<w:r><w:t xml:space="preserve">${xmlEsc(t)}</w:t></w:r>`;
const field = (instr: string, result: string) =>
  `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${xmlEsc(instr)} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run(result)}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;

/**
 * A table of contents as Word writes it: a title, then a TOC field whose result is one paragraph per entry (style TOC 1-3, right tab with
 * a dotted leader, a link to the heading and the PAGEREF field of its page), cached so that every reader shows it without updating.
 * `tab` is the position of the right tab, in twips.
 */
export function tocXml(node: PM, tab: number): string {
  const levels = Math.min(3, Math.max(1, Math.trunc(Number(node.attrs?.levels)) || 3));
  const kind = node.attrs?.kind === "captions" ? "captions" : "headings";
  const label = typeof node.attrs?.label === "string" ? node.attrs.label : "";
  const instr = kind === "captions" ? `TOC \\h \\z \\c "${label.replace(/"/g, "")}"` : `TOC \\o "1-${levels}" \\h \\z \\u`;
  const title = String(node.attrs?.title ?? "");
  const out: string[] = [];
  if (title) out.push(`<w:p><w:pPr><w:pStyle w:val="TOCHeading"/></w:pPr>${run(title)}</w:p>`);
  const entries = (node.content ?? []).filter((e) => e.type === "tocEntry");
  const begin = `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${xmlEsc(instr)} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>`;
  entries.forEach((e, i) => {
    const level = Math.min(3, Math.max(1, Math.trunc(Number(e.attrs?.level)) || 1));
    const page = String(e.attrs?.page ?? "");
    const target = typeof e.attrs?.target === "number" && kind === "headings" ? tocBookmark(e.attrs.target) : null;
    const body = target
      ? `<w:hyperlink w:anchor="${target}" w:history="1">${run(text(e))}<w:r><w:tab/></w:r>${field(`PAGEREF ${target} \\h`, page)}</w:hyperlink>`
      : `${run(text(e))}<w:r><w:tab/></w:r>${run(page)}`;
    out.push(`<w:p><w:pPr><w:pStyle w:val="${kind === "captions" ? "TableofFigures" : `TOC${level}`}"/><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="${tab}"/></w:tabs></w:pPr>${i === 0 ? begin : ""}${body}</w:p>`);
  });
  // The end of the field: in the last entry's paragraph when there is one, else in a paragraph of its own.
  if (entries.length) out[out.length - 1] = out[out.length - 1].replace(/<\/w:p>$/, `<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`);
  else out.push(`<w:p>${begin}<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`);
  return out.join("");
}
