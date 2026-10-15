import { useEditorState, type Editor } from "@tiptap/react";
import { useMemo } from "react";
import type { HeaderFooterSettings } from "../pagination/headerFooter";
import type { PageSetup } from "../state/types";
import { buildSections, readSectionBreaks, sectionIndexAt, type SectionInfo } from "./Sections";

/** The sections of the document and the one holding the caret. */
export function useSections(editor: Editor | null, docPage: PageSetup, docHf: HeaderFooterSettings): { sections: SectionInfo[]; current: number; section: SectionInfo } {
  const breaks = useEditorState({ editor, selector: ({ editor: e }) => (e ? readSectionBreaks(e.state.doc) : []) }) ?? [];
  const current = useEditorState({ editor, selector: ({ editor: e }) => (e ? sectionIndexAt(e.state.doc, e.state.selection.from) : 0) }) ?? 0;
  const sections = useMemo(() => buildSections(breaks, docPage, docHf), [breaks, docPage, docHf]);
  const index = Math.min(current, sections.length - 1);
  return { sections, current: index, section: sections[index] };
}
