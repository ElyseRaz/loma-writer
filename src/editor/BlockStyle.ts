import { Extension } from "@tiptap/core";
import { CellSelection } from "@tiptap/pm/tables";
import type { Node as PMNode } from "@tiptap/pm/model";

/** Which sides of a paragraph carry a border. */
export interface Borders {
  top?: boolean;
  right?: boolean;
  bottom?: boolean;
  left?: boolean;
}
export type BorderMode = "top" | "bottom" | "left" | "right" | "all" | "none";

const BORDER = "1px solid #6b7280";
const TEXT_BLOCKS = ["paragraph", "heading"];
const CELLS = ["tableCell", "tableHeader"];

const borderStyle = (b: Borders) =>
  [b.top && `border-top:${BORDER}`, b.right && `border-right:${BORDER}`, b.bottom && `border-bottom:${BORDER}`, b.left && `border-left:${BORDER}`, "padding:2px 6px"].filter(Boolean).join(";");

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    blockStyle: {
      /** Background colour of the selected paragraphs, or of the selected table cells; null removes it. */
      setShading: (color: string | null) => ReturnType;
      /** Borders of the selected paragraphs; in a table selection, "all"/"none" show or hide the cell borders. */
      setBorders: (mode: BorderMode) => ReturnType;
    };
  }
}

/**
 * Paragraph and table-cell decoration: shading ("Trame de fond") and borders ("Bordures").
 * Stored as node attributes, so they survive editing and are written to DOCX/ODT.
 */
export const BlockStyle = Extension.create({
  name: "blockStyle",

  addGlobalAttributes() {
    return [
      {
        types: TEXT_BLOCKS,
        attributes: {
          shading: {
            default: null,
            parseHTML: (el: HTMLElement) => el.getAttribute("data-shading"),
            renderHTML: (a: Record<string, unknown>) => (a.shading ? { "data-shading": a.shading, style: `background-color:${a.shading};padding:2px 6px` } : {}),
          },
          borders: {
            default: null,
            parseHTML: (el: HTMLElement) => {
              try { return JSON.parse(el.getAttribute("data-borders") ?? "null"); } catch { return null; }
            },
            renderHTML: (a: Record<string, unknown>) => (a.borders ? { "data-borders": JSON.stringify(a.borders), style: borderStyle(a.borders as Borders) } : {}),
          },
        },
      },
      {
        types: CELLS,
        attributes: {
          shading: {
            default: null,
            parseHTML: (el: HTMLElement) => el.getAttribute("data-shading"),
            renderHTML: (a: Record<string, unknown>) => (a.shading ? { "data-shading": a.shading, style: `background-color:${a.shading}` } : {}),
          },
          borderless: {
            default: false,
            parseHTML: (el: HTMLElement) => el.hasAttribute("data-borderless"),
            renderHTML: (a: Record<string, unknown>) => (a.borderless ? { "data-borderless": "", style: "border-color:transparent" } : {}),
          },
        },
      },
    ];
  },

  addCommands() {
    /** Calls `fn` for every node of the given types in the selection (cells for a cell selection). */
    const targets = (state: import("@tiptap/pm/state").EditorState, types: string[], fn: (node: PMNode, pos: number) => void) => {
      const sel = state.selection;
      if (sel instanceof CellSelection) {
        sel.forEachCell((cell, pos) => fn(cell, pos));
        return "cells" as const;
      }
      state.doc.nodesBetween(sel.from, sel.to, (node, pos) => {
        if (types.includes(node.type.name)) fn(node, pos);
        return true;
      });
      return "blocks" as const;
    };

    return {
      setShading:
        (color) =>
        ({ state, tr, dispatch }) => {
          let changed = false;
          targets(state, TEXT_BLOCKS, (node, pos) => {
            if (node.attrs.shading === color || !("shading" in node.attrs)) return;
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, shading: color });
            changed = true;
          });
          if (changed && dispatch) dispatch(tr);
          return changed;
        },

      setBorders:
        (mode) =>
        ({ state, tr, dispatch }) => {
          let changed = false;
          const kind = targets(state, TEXT_BLOCKS, () => {});
          if (kind === "cells") {
            if (mode !== "all" && mode !== "none") return false;
            targets(state, CELLS, (cell, pos) => {
              tr.setNodeMarkup(pos, undefined, { ...cell.attrs, borderless: mode === "none" });
              changed = true;
            });
          } else {
            // Toggling a side follows the first selected paragraph, so the whole selection ends up consistent.
            let toggleOn = true;
            let first = true;
            targets(state, TEXT_BLOCKS, (node) => {
              if (first && (mode === "top" || mode === "bottom" || mode === "left" || mode === "right")) {
                toggleOn = !(node.attrs.borders as Borders | null)?.[mode];
                first = false;
              }
            });
            targets(state, TEXT_BLOCKS, (node, pos) => {
              if (!("borders" in node.attrs)) return;
              const current = (node.attrs.borders as Borders | null) ?? {};
              let next: Borders | null;
              if (mode === "none") next = null;
              else if (mode === "all") next = { top: true, right: true, bottom: true, left: true };
              else next = { ...current, [mode]: toggleOn };
              if (next && !Object.values(next).some(Boolean)) next = null;
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, borders: next });
              changed = true;
            });
          }
          if (changed && dispatch) dispatch(tr);
          return changed;
        },
    };
  },
});
