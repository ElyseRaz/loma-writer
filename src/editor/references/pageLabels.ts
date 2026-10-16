import type { Editor } from "@tiptap/react";
import { paginationKey } from "../../pagination/extension";
import { pageIndexAt, type PageStart } from "../../pagination/pageIndex";
import { displayedNumbers, formatPageNumber } from "../../pagination/pageNumber";
import type { SectionInfo } from "../Sections";

/** The label (number in the format of its section) of the page where a document position is, from the last layout. */
export function makePageLabeler(editor: Editor, getSections: () => SectionInfo[]): (pos: number) => string {
  return (pos) => {
    const sheets = paginationKey.getState(editor.state)?.sheets ?? [];
    const starts = (editor.storage as unknown as { pagination?: { pageStarts: PageStart[] } }).pagination?.pageStarts ?? [];
    if (!sheets.length) return "1";
    const sections = getSections();
    const page = Math.min(sheets.length - 1, Math.max(0, pageIndexAt(starts, pos)));
    const numbers = displayedNumbers(sheets, sections.map((s) => s.page.numberStart));
    return formatPageNumber(numbers[page] ?? page + 1, sections[sheets[page].section]?.page.numberFormat);
  };
}
