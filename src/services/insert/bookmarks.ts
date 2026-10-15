import { TextSelection } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";

export interface BookmarkInfo {
  name: string;
  pos: number;
}
export interface HeadingInfo {
  level: number;
  text: string;
  pos: number;
}

/** Word's rules: starts with a letter, then letters, digits or underscores. Spaces become underscores. */
export function normalizeBookmarkName(raw: string): string {
  return raw.trim().replace(/\s+/g, "_").replace(/[^\p{L}\p{N}_]/gu, "");
}
export const isValidBookmarkName = (name: string) => /^\p{L}[\p{L}\p{N}_]*$/u.test(name) && name.length <= 40;

export function listBookmarks(doc: PMNode): BookmarkInfo[] {
  const out: BookmarkInfo[] = [];
  doc.descendants((n, pos) => { if (n.type.name === "bookmark") out.push({ name: String(n.attrs.name), pos }); });
  return out;
}

export function listHeadings(doc: PMNode): HeadingInfo[] {
  const out: HeadingInfo[] = [];
  doc.descendants((n, pos) => { if (n.type.name === "heading" && n.textContent.trim()) out.push({ level: n.attrs.level, text: n.textContent, pos }); return false; });
  return out;
}

/** Anchor used for a cross-reference to a heading: created on demand, named after the heading text. */
export const headingAnchorName = (text: string) => `Titre_${normalizeBookmarkName(text).slice(0, 30)}`;

/** Makes sure `heading` has an anchor at its start, and returns the anchor name. */
export function ensureHeadingAnchor(editor: Editor, heading: HeadingInfo): string {
  const name = headingAnchorName(heading.text);
  if (!listBookmarks(editor.state.doc).some((b) => b.name === name)) {
    editor.chain().insertContentAt(heading.pos + 1, { type: "bookmark", attrs: { name } }).run();
  }
  return name;
}

/** Moves the caret to a bookmark and scrolls it into view. */
export function gotoBookmark(editor: Editor, name: string): boolean {
  const target = listBookmarks(editor.state.doc).find((b) => b.name === name);
  if (!target) return false;
  const tr = editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(target.pos))).scrollIntoView();
  editor.view.dispatch(tr);
  editor.view.focus();
  return true;
}
