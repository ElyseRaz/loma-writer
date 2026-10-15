import { Extension } from "@tiptap/core";

export interface ListTypeDef {
  id: string;
  label: string;
  /** What the marker looks like in the picker. */
  sample: string;
}

/** Bullet styles (the first one is the default). `circle`/`square`/`disc` are CSS keywords, the others `@counter-style`s. */
export const BULLET_TYPES: ListTypeDef[] = [
  { id: "disc", label: "Disque", sample: "•" },
  { id: "circle", label: "Cercle", sample: "○" },
  { id: "square", label: "Carré", sample: "▪" },
  { id: "dash", label: "Tiret", sample: "–" },
  { id: "arrow", label: "Flèche", sample: "➢" },
  { id: "check", label: "Coche", sample: "✓" },
  { id: "star", label: "Étoile", sample: "★" },
  { id: "diamond", label: "Losange", sample: "◆" },
];

/** Numbering styles (the first one is the default). */
export const NUMBER_TYPES: ListTypeDef[] = [
  { id: "decimal", label: "1. 2. 3.", sample: "1." },
  { id: "lower-alpha", label: "a. b. c.", sample: "a." },
  { id: "upper-alpha", label: "A. B. C.", sample: "A." },
  { id: "lower-roman", label: "i. ii. iii.", sample: "i." },
  { id: "upper-roman", label: "I. II. III.", sample: "I." },
];

export const DEFAULT_BULLET = BULLET_TYPES[0].id;
export const DEFAULT_NUMBER = NUMBER_TYPES[0].id;

const known = (list: string) => (list === "orderedList" ? NUMBER_TYPES : BULLET_TYPES);
/** A stored type that is valid for this kind of list, or null for the default. */
export function cleanListType(list: string, type: unknown): string | null {
  return typeof type === "string" && known(list).some((t) => t.id === type) && type !== known(list)[0].id ? type : null;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    listTypes: {
      /** Gives the list holding the selection (a bullet or numbered list, created if needed) the marker style `type`. */
      setListType: (kind: "bulletList" | "orderedList", type: string) => ReturnType;
    };
  }
}

/** Marker style of bullet and numbered lists, kept as a node attribute (written to DOCX and ODT). */
export const ListTypes = Extension.create({
  name: "listTypes",

  addGlobalAttributes() {
    return [
      {
        types: ["bulletList", "orderedList"],
        attributes: {
          listType: {
            default: null,
            parseHTML: (el: HTMLElement) => el.getAttribute("data-list-type") ?? (el.style.listStyleType || null),
            renderHTML: (a: Record<string, unknown>) => (a.listType ? { "data-list-type": a.listType } : {}),
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setListType:
        (kind, type) =>
        ({ editor, state, chain }) => {
          const value = cleanListType(kind, type);
          if (!editor.isActive(kind)) return chain().focus()[kind === "bulletList" ? "toggleBulletList" : "toggleOrderedList"]().updateAttributes(kind, { listType: value }).run();
          // The innermost list of this kind around the cursor (the level being edited).
          const { $from } = state.selection;
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === kind) {
              return chain().focus().command(({ tr }) => { tr.setNodeMarkup($from.before(d), undefined, { ...$from.node(d).attrs, listType: value }); return true; }).run();
            }
          }
          return false;
        },
    };
  },
});
