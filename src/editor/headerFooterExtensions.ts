import StarterKit from "@tiptap/starter-kit";
import { TextStyleKit } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import type { Extensions } from "@tiptap/react";
import { BlockStyle } from "./BlockStyle";
import { PageField } from "./PageField";

/** The subset of the editor used for headers and footers: formatted paragraphs, images, tables and page numbers. */
export function createHeaderFooterExtensions(): Extensions {
  return [
    StarterKit.configure({ heading: false, bulletList: false, orderedList: false, listItem: false, blockquote: false, codeBlock: false, horizontalRule: false, link: false, strike: false }),
    TextStyleKit,
    TextAlign.configure({ types: ["paragraph"] }),
    Image.configure({ inline: true, allowBase64: true }),
    TableKit.configure({ table: { resizable: false } }),
    BlockStyle,
    PageField,
  ];
}
