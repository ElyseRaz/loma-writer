import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { cleanLook, DEFAULT_LOOK, type TableLook } from "./tableStyles";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    tableLook: {
      /** Changes some settings of the look of the table holding the selection. */
      setTableLook: (patch: Partial<TableLook>) => ReturnType;
    };
  }
}

/** Attributes drawn on the table (HTML export) or on its view's wrapper (editor). */
const htmlAttrs = (l: TableLook): Record<string, string> => ({
  "data-look": JSON.stringify(l),
  "data-borders": l.borders,
  ...(l.band ? { "data-banded": "" } : {}),
  ...(l.firstCol ? { "data-firstcol": "" } : {}),
  style: `--tb-c:${l.color};--tb-w:${l.width}px;--tb-head:${l.headFill};--tb-headtext:${l.headText};--tb-band:${l.band ?? "transparent"}`,
});

/** Free position of a table: offset from the left of the text column (negative = into the margin) and width, in px. */
export interface TablePlace { x: number; w: number }
export function cleanPlace(raw: unknown): TablePlace | null {
  const r = raw as Partial<TablePlace> | null;
  if (!r || typeof r.x !== "number" || typeof r.w !== "number" || !Number.isFinite(r.x) || !Number.isFinite(r.w) || r.w < 40 || r.w > 2000 || Math.abs(r.x) > 2000) return null;
  return { x: Math.round(r.x), w: Math.round(r.w) };
}

const sameAsDefault = (l: TableLook) => JSON.stringify(l) === JSON.stringify(DEFAULT_LOOK);

/** Table style and customisation: stored as the `look` attribute of the table node (written to DOCX/ODT as cell borders and fills). */
export const TableLookExtension = Extension.create({
  name: "tableLook",

  addGlobalAttributes() {
    return [
      {
        types: ["table"],
        attributes: {
          place: {
            default: null,
            parseHTML: (el: HTMLElement) => {
              try { return el.getAttribute("data-place") ? cleanPlace(JSON.parse(el.getAttribute("data-place")!)) : null; } catch { return null; }
            },
            renderHTML: (a: Record<string, unknown>) => (a.place ? { "data-place": JSON.stringify(cleanPlace(a.place)) } : {}),
          },
          look: {
            default: null,
            parseHTML: (el: HTMLElement) => {
              try { return el.getAttribute("data-look") ? cleanLook(JSON.parse(el.getAttribute("data-look")!)) : null; } catch { return null; }
            },
            renderHTML: (a: Record<string, unknown>) => (a.look ? htmlAttrs(cleanLook(a.look)) : {}),
          },
        },
      },
    ];
  },

  // The table is drawn by a node view, which ignores renderHTML: the look is applied through decorations on its wrapper.
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations: (state) => {
            const decos: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name !== "table") return true;
              const place = cleanPlace(node.attrs.place);
              if (node.attrs.look || place) {
                const look = node.attrs.look ? htmlAttrs(cleanLook(node.attrs.look)) : { style: "" };
                const style = `${look.style};${place ? `margin-left:calc(var(--sec-l, 0px) + ${place.x}px);width:${place.w}px` : ""}`;
                decos.push(Decoration.node(pos, pos + node.nodeSize, { ...look, ...(place ? { "data-placed": "" } : {}), style }));
              }
              return false;
            });
            return decos.length ? DecorationSet.create(state.doc, decos) : null;
          },
        },
      }),
    ];
  },

  addCommands() {
    return {
      setTableLook:
        (patch) =>
        ({ state, tr, dispatch }) => {
          const { $from } = state.selection;
          for (let d = $from.depth; d > 0; d--) {
            const node = $from.node(d);
            if (node.type.name !== "table") continue;
            const next = cleanLook({ ...cleanLook(node.attrs.look), ...patch });
            tr.setNodeMarkup($from.before(d), undefined, { ...node.attrs, look: sameAsDefault(next) ? null : next });
            dispatch?.(tr);
            return true;
          }
          return false;
        },
    };
  },
});
