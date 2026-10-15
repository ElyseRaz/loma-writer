import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { cleanPlace } from "./TableLook";

const MIN_COL = 24;
/** Space kept for each column that has no explicit width. */
const UNKNOWN_COL = 60;

/**
 * Keeps tables inside the page: when the column widths set by dragging a border (or by an imported file) add up to more than
 * the text width, they are scaled down together. Tables whose columns have no explicit width already follow the page.
 */
export const TableFit = Extension.create({
  name: "tableFit",

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey("loma-table-fit"),
        appendTransaction(trs, _old, state) {
          if (!trs.some((t) => t.docChanged)) return null;
          const geom = (editor.storage as unknown as { pagination?: { geometry: { width: number; insetLeft: number; insetRight: number } | null } }).pagination?.geometry;
          if (!geom) return null;
          const textWidth = Math.floor(geom.width - geom.insetLeft - geom.insetRight);
          let tr = state.tr;
          let changed = false;
          state.doc.descendants((node, pos) => {
            if (node.type.name !== "table") return true;
            const place = cleanPlace(node.attrs.place);
            const avail = place ? Math.min(place.w, geom.width - 16) : textWidth;
            const first = node.firstChild;
            if (!first) return false;
            let known = 0;
            let unknown = 0;
            first.forEach((cell) => {
              const cw = cell.attrs.colwidth as number[] | null;
              if (cw) known += cw.reduce((t, w) => t + w, 0);
              else unknown += (cell.attrs.colspan as number) || 1;
            });
            // Columns without a width share what the others leave; each needs room for some text.
            const room = avail - unknown * UNKNOWN_COL;
            if (known === 0 || known <= room + 1) return false;
            const f = Math.max(0.05, room / known);
            node.descendants((cell, rel) => {
              const cw = cell.attrs?.colwidth as number[] | null | undefined;
              if (cw && (cell.type.name === "tableCell" || cell.type.name === "tableHeader")) {
                tr = tr.setNodeMarkup(pos + 1 + rel, undefined, { ...cell.attrs, colwidth: cw.map((w) => Math.max(MIN_COL, Math.floor(w * f))) });
                changed = true;
              }
              return cell.type.name === "tableRow";
            });
            return false;
          });
          return changed ? tr.setMeta("addToHistory", false) : null;
        },
      }),
    ];
  },
});
