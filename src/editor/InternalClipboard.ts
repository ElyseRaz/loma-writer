import { Extension } from "@tiptap/core";
import { DOMSerializer, Fragment, Slice, type Schema } from "@tiptap/pm/model";
import { NodeSelection, Plugin, TextSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import { pasteObjectAtPointer } from "./ObjectPlacement";
import type { EditorView } from "@tiptap/pm/view";

interface Clip {
  json: unknown;
  /** Plain text of the copy: tells whether the system clipboard still holds this copy when pasting from a button. */
  text: string;
  /** Invisible tag written into the plain text of an object copy: finds the copy again when only the text survives on the clipboard. */
  marker?: string;
}

let last: Clip | null = null;
let copies = 0;
/** True when the last copy could not be written to the system clipboard: Ctrl+V then pastes the editor's own copy. */
let fallbackActive = false;

const textOf = (view: EditorView) => view.state.doc.textBetween(view.state.selection.from, view.state.selection.to, "\n", " ").trim();

/**
 * The editor keeps its own copy of what was copied (pictures, tables, shapes, with all their settings). The "Coller" button and
 * context menu use it when the system clipboard only has text or cannot be read; Ctrl+V keeps using the system clipboard.
 */
export const InternalClipboard = Extension.create({
  name: "internalClipboard",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleDOMEvents: { copy: (v) => { remember(v); fallbackActive = false; return false; }, cut: (v) => { remember(v); fallbackActive = false; return false; } },
          // Pictures, tables and shapes are selected as objects, which browsers do not always count as a copyable selection:
          // Ctrl+C / Ctrl+X are handled here for them.
          handleKeyDown(view, e) {
            if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return false;
            const k = e.key.toLowerCase();
            if ((k !== "c" && k !== "x") || !isObjectSelection(view)) return false;
            e.preventDefault();
            copySelection(view, k === "x");
            return true;
          },
          // Nothing usable on the system clipboard (the copy could not be written there): paste the editor's own copy.
          handlePaste(view, e) {
            if (fallbackActive && last) return pasteInternal(view, null);
            const d = e.clipboardData;
            // Some webviews keep only the text of an object copy: the tag in it leads back to the editor's own copy.
            if (d && last?.marker && d.getData("text/plain").includes(last.marker)) return pasteInternal(view, null);
            if (d && (d.getData("text/html") || d.getData("text/plain") || d.files.length)) return false;
            return pasteInternal(view, null);
          },
        },
      }),
    ];
  },
});

function remember(view: EditorView) {
  const slice = view.state.selection.content();
  if (slice.size > 0 || slice.content.childCount) last = { json: slice.toJSON(), text: textOf(view) };
}

/** A picture, shape, table (all cells) or other node is selected, not a range of text. */
export function isObjectSelection(view: EditorView) {
  const sel = view.state.selection;
  return sel instanceof NodeSelection || sel instanceof CellSelection;
}

/**
 * Copies (or cuts) the selection: the editor keeps its own copy, and the system clipboard gets the same content as HTML and text
 * (asynchronous clipboard API, with `execCommand` as the fallback for text).
 */
export function copySelection(view: EditorView, cut = false) {
  remember(view);
  const marker = `\u200b${++copies}\u200b`;
  if (last) last.marker = marker;
  const slice = view.state.selection.content();
  const holder = document.createElement("div");
  holder.appendChild(DOMSerializer.fromSchema(view.state.schema).serializeFragment(slice.content));
  const html = holder.innerHTML;
  const text = textOf(view);
  const write = typeof navigator.clipboard?.write === "function" && typeof ClipboardItem !== "undefined"
    ? navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text + marker], { type: "text/plain" }) })])
    : Promise.reject(new Error("no clipboard api"));
  // Until the system clipboard confirms it holds this copy, a paste uses the editor's own one (the async API may stay pending
  // or be refused in some webviews, and the system clipboard would then still hold something older).
  fallbackActive = true;
  const mine = last;
  write.then(
    () => { if (last === mine) fallbackActive = false; },
    () => {
      let done = false;
      try { done = document.execCommand("copy"); } catch { /* the editor's own copy is still there */ }
      if (last === mine) fallbackActive = !done;
    },
  );
  if (cut) view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
}

/** Pastes the editor's own last copy; returns false when there is none or the system clipboard holds something else. */
export function pasteInternal(view: EditorView, systemText: string | null): boolean {
  if (!last) return false;
  const sys = systemText?.trim() ?? null;
  if (sys !== null && sys !== "" && sys !== last.text) return false; // something else was copied since
  const schema: Schema = view.state.schema;
  try {
    const slice = Slice.fromJSON(schema, last.json as never);
    if (pasteObjectAtPointer(view, slice)) return true; // pictures, shapes and tables go where the pointer is
    // Otherwise the copy goes after a selected object, never over it (the source stays).
    if (view.state.selection instanceof NodeSelection) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(view.state.selection.to), 1)));
    view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
    view.focus();
    return true;
  } catch {
    return false;
  }
}

export const hasInternalClip = () => last !== null;
/** The last copy could not reach the system clipboard: a paste must use the editor's own copy. */
export const internalPasteWanted = () => fallbackActive && last !== null;
if (import.meta.env.DEV && typeof window !== "undefined") (window as unknown as { __lomaClip: () => unknown }).__lomaClip = () => ({ last, fallbackActive });
void Fragment;

/** The clipboard text carries the tag of the editor's last object copy (only its text came through). */
export const markedCopyOnClipboard = (e: ClipboardEvent) => !!(last?.marker && e.clipboardData?.getData("text/plain").includes(last.marker));
