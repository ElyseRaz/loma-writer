import StarterKit from "@tiptap/starter-kit";
import { TextStyleKit } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import CharacterCount from "@tiptap/extension-character-count";
import { TableLookExtension } from "./TableLook";
import { ObjectPlacement } from "./ObjectPlacement";
import { InternalClipboard } from "./InternalClipboard";
import { pictureAttributes, pictureView } from "./ImageView";
import { TableRowResize } from "./TableRowResize";
import { SectionBreak } from "./Sections";
import { TableFit } from "./TableFit";
import { ListTypes } from "./ListTypes";
import { ColumnBreak, PageBreak } from "./PageBreak";
import { Pagination } from "../pagination/extension";
import { ParagraphFormat } from "./ParagraphFormat";
import { BlockStyle } from "./BlockStyle";
import { FindReplace } from "./FindReplace";
import { Bookmark, Equation, InternalLinks } from "./InsertNodes";
import { Shape, ShapeGroup } from "./shapes/Shape";
import Strike from "@tiptap/extension-strike";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import type { Extensions } from "@tiptap/react";

/** `pagination: false` is for tests that run without a layout engine. */
export function createExtensions(options: { pagination?: boolean } = {}): Extensions {
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: true }, strike: false }),
    // Ctrl+Shift+S is reserved for "Enregistrer sous".
    Strike.extend({ addKeyboardShortcuts: () => ({ "Mod-Shift-x": ({ editor }) => editor.commands.toggleStrike() }) }),
    TextStyleKit,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Highlight.configure({ multicolor: true }),
    Subscript,
    Superscript,
    CharacterCount,
    // Inline, like in Word/Writer documents; width/height (px) survive import and export.
    Image.extend({
      addAttributes() {
        const size = (name: "width" | "height") => ({
          default: null,
          parseHTML: (el: HTMLElement) => el.getAttribute(name),
          renderHTML: (attrs: Record<string, unknown>) => (attrs[name] ? { [name]: attrs[name] } : {}),
        });
        return { ...this.parent?.(), width: size("width"), height: size("height"), ...pictureAttributes() };
      },
      addNodeView: () => pictureView as never,
    }).configure({ inline: true, allowBase64: true }),
    Placeholder.configure({ placeholder: "Commencez à écrire…" }),
    PageBreak,
    ColumnBreak,
    ...(options.pagination === false ? [] : [Pagination]),
    BlockStyle,
    ParagraphFormat,
    TableFit,
    SectionBreak,
    InternalClipboard,
    ObjectPlacement,
    TableRowResize,
    TableLookExtension,
    ListTypes,
    Bookmark,
    InternalLinks,
    Shape,
    ShapeGroup,
    Equation,
    FindReplace,
    TableKit.configure({ table: { resizable: true } }),
  ];
}
