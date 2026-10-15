import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Editor } from "@tiptap/react";

export interface FindOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
}
export interface Match {
  from: number;
  to: number;
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;

/**
 * All occurrences of `query` in the document. Each text block is searched on its own text, so a match never
 * spans two paragraphs; marks (bold, colour…) inside a word do not break a match.
 */
export function findMatches(doc: PMNode, query: string, options: FindOptions): Match[] {
  if (!query) return [];
  const needle = options.caseSensitive ? query : query.toLowerCase();
  const matches: Match[] = [];

  doc.descendants((block, blockPos) => {
    if (!block.isTextblock) return true;
    // Flatten the block into a string, remembering where every segment sits in the document.
    let text = "";
    const segments: Array<{ start: number; pos: number; len: number }> = [];
    block.descendants((node, pos) => {
      const piece = node.isText ? node.text! : node.isLeaf ? "￼" : "";
      if (piece) {
        segments.push({ start: text.length, pos: blockPos + 1 + pos, len: piece.length });
        text += piece;
      }
      return true;
    });
    const hay = options.caseSensitive ? text : text.toLowerCase();
    /** Document position of the character at `index` of the flattened text. */
    const posAt = (index: number) => {
      const s = segments.find((x) => index >= x.start && index < x.start + x.len);
      return s ? s.pos + (index - s.start) : null;
    };
    for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) {
      const before = i > 0 ? hay[i - 1] : "";
      const after = i + needle.length < hay.length ? hay[i + needle.length] : "";
      if (options.wholeWord && ((before && WORD_CHAR.test(before)) || (after && WORD_CHAR.test(after)))) continue;
      const from = posAt(i);
      const last = posAt(i + needle.length - 1);
      if (from !== null && last !== null) matches.push({ from, to: last + 1 });
    }
    return false;
  });
  return matches;
}

export interface FindState {
  query: string;
  options: FindOptions;
  matches: Match[];
  /** Index of the current match, or -1. */
  current: number;
  decos: DecorationSet;
}

export const findKey = new PluginKey<FindState>("loma-find");

const EMPTY: FindState = { query: "", options: { caseSensitive: false, wholeWord: false }, matches: [], current: -1, decos: DecorationSet.empty };

function build(doc: PMNode, query: string, options: FindOptions, current: number): FindState {
  const matches = findMatches(doc, query, options);
  const index = matches.length ? Math.min(Math.max(current, 0), matches.length - 1) : -1;
  const decos = DecorationSet.create(doc, matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === index ? "find-match find-current" : "find-match" })));
  return { query, options, matches, current: index, decos };
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    findReplace: {
      setFind: (query: string, options?: Partial<FindOptions>) => ReturnType;
      findNext: () => ReturnType;
      findPrevious: () => ReturnType;
      /** Replaces the current match and moves to the next one. */
      replaceCurrent: (replacement: string) => ReturnType;
      /** Replaces every match; the count is available from `replacedCount`. */
      replaceAll: (replacement: string) => ReturnType;
      clearFind: () => ReturnType;
    };
  }
}

export const FindReplace = Extension.create({
  name: "findReplace",

  addStorage() {
    return { replacedCount: 0 };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: () => EMPTY,
          apply(tr, value, _old, newState) {
            const meta = tr.getMeta(findKey) as { query: string; options: FindOptions; current: number } | { current: number } | undefined;
            if (meta && "query" in meta) return build(newState.doc, meta.query, meta.options, meta.current);
            if (meta) return build(newState.doc, value.query, value.options, meta.current);
            return tr.docChanged ? build(newState.doc, value.query, value.options, value.current) : value;
          },
        },
        props: { decorations: (state) => findKey.getState(state)?.decos },
      }),
    ];
  },

  addCommands() {
    const select = (m: Match) => (tr: import("@tiptap/pm/state").Transaction) => tr.setSelection(TextSelection.create(tr.doc, m.from, m.to)).scrollIntoView();
    const go = (delta: 1 | -1) => ({ state, tr, dispatch }: { state: import("@tiptap/pm/state").EditorState; tr: import("@tiptap/pm/state").Transaction; dispatch?: (tr: import("@tiptap/pm/state").Transaction) => void }) => {
      const s = findKey.getState(state);
      if (!s || !s.matches.length) return false;
      const next = (s.current + delta + s.matches.length) % s.matches.length;
      tr.setMeta(findKey, { current: next });
      select(s.matches[next])(tr);
      dispatch?.(tr);
      return true;
    };

    return {
      setFind:
        (query, options = {}) =>
        ({ state, tr, dispatch }) => {
          const prev = findKey.getState(state) ?? EMPTY;
          const opts = { ...prev.options, ...options };
          // Start at the first match from the caret, like a word processor does.
          const head = state.selection.from;
          const all = findMatches(state.doc, query, opts);
          const first = Math.max(0, all.findIndex((m) => m.from >= head));
          tr.setMeta(findKey, { query, options: opts, current: first });
          if (all.length && dispatch) select(all[first])(tr);
          dispatch?.(tr);
          return true;
        },
      findNext: () => go(1),
      findPrevious: () => go(-1),
      replaceCurrent:
        (replacement) =>
        ({ state, tr, dispatch }) => {
          const s = findKey.getState(state);
          if (!s || s.current < 0) return false;
          const m = s.matches[s.current];
          tr.insertText(replacement, m.from, m.to);
          // Continue after the replacement.
          const after = m.from + replacement.length;
          const rest = findMatches(tr.doc, s.query, s.options);
          const next = rest.findIndex((x) => x.from >= after);
          const index = next === -1 ? 0 : next;
          tr.setMeta(findKey, { current: index });
          if (rest[index]) select(rest[index])(tr);
          dispatch?.(tr);
          return true;
        },
      replaceAll:
        (replacement) =>
        ({ state, tr, editor, dispatch }) => {
          const s = findKey.getState(state);
          const storage = editor.storage as unknown as { findReplace: { replacedCount: number } };
          storage.findReplace.replacedCount = 0;
          if (!s || !s.matches.length) return false;
          // From the end, so earlier positions stay valid.
          for (const m of [...s.matches].reverse()) tr.insertText(replacement, m.from, m.to);
          storage.findReplace.replacedCount = s.matches.length;
          dispatch?.(tr);
          return true;
        },
      clearFind:
        () =>
        ({ tr, dispatch }) => {
          tr.setMeta(findKey, { query: "", options: EMPTY.options, current: -1 });
          dispatch?.(tr);
          return true;
        },
    };
  },
});

export const replacedCount = (editor: Editor) => (editor.storage as unknown as { findReplace: { replacedCount: number } }).findReplace.replacedCount;
