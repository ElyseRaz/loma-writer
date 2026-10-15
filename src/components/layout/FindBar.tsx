import { useEditorState } from "@tiptap/react";
import { ChevronDown, ChevronRight, ChevronUp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import { useLomaEditor } from "../../editor/EditorProvider";
import { findKey, replacedCount } from "../../editor/FindReplace";
import { useApp } from "../../state/store";
import { Button } from "../ui/Dialog";

function Toggle({ on, label, title, onClick }: { on: boolean; label: string; title: string; onClick: () => void }) {
  return (
    <button type="button" title={title} aria-label={title} aria-pressed={on} onClick={onClick}
      className={cn("h-7 min-w-7 rounded-md border px-1.5 text-[12px] font-medium", on ? "border-accent bg-accent-soft text-accent" : "border-line hover:bg-hover")}>
      {label}
    </button>
  );
}

/** Find / replace bar, under the ribbon. Highlights every match in the document and walks through them. */
export function FindBar() {
  const editor = useLomaEditor();
  const { state, set, notify } = useApp();
  const [query, setQuery] = useState(() => {
    const sel = editor?.state.selection;
    const text = sel && !sel.empty ? editor!.state.doc.textBetween(sel.from, sel.to, " ") : "";
    return text.length > 0 && text.length < 80 && !text.includes("\n") ? text : "";
  });
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCase] = useState(false);
  const [wholeWord, setWord] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const info = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const s = e ? findKey.getState(e.state) : undefined;
      return { total: s?.matches.length ?? 0, current: s?.current ?? -1 };
    },
  }) ?? { total: 0, current: -1 };

  // Re-focus the search field when Ctrl+F / Ctrl+H is pressed again.
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [state.find.nonce]);

  // Search as you type, and whenever an option changes.
  useEffect(() => {
    editor?.commands.setFind(query, { caseSensitive, wholeWord });
  }, [editor, query, caseSensitive, wholeWord]);

  // Escape closes the bar wherever the focus is.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector("[role=dialog]")) return;
      set((s) => ({ find: { ...s.find, open: false } }));
      editor?.commands.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor, set]);

  // Leaving the bar removes the highlights.
  useEffect(() => () => { if (editor && !editor.isDestroyed) editor.commands.clearFind(); }, [editor]);

  const close = () => {
    set((s) => ({ find: { ...s.find, open: false } }));
    editor?.commands.focus();
  };
  const next = () => editor?.commands.findNext();
  const previous = () => editor?.commands.findPrevious();
  const replaceOne = () => editor?.commands.replaceCurrent(replacement);
  const replaceEvery = () => {
    if (!editor || !editor.commands.replaceAll(replacement)) return notify("Aucun résultat à remplacer.");
    const n = replacedCount(editor);
    notify(`${n} remplacement${n > 1 ? "s" : ""} effectué${n > 1 ? "s" : ""}.`);
  };

  const status = !query ? "" : info.total === 0 ? "Aucun résultat" : `${info.current + 1} sur ${info.total}`;
  const field = "h-7 rounded-md border border-line bg-surface px-2 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

  return (
    <div role="search" className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-line bg-surface px-3 py-2"
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } }}>
      <button type="button" aria-label={state.find.replace ? "Masquer le remplacement" : "Afficher le remplacement"} title="Remplacer"
        onClick={() => set((s) => ({ find: { ...s.find, replace: !s.find.replace } }))} className="flex h-7 w-6 items-center justify-center rounded-md hover:bg-hover">
        {state.find.replace ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      <input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher dans le document" aria-label="Rechercher"
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.shiftKey ? previous : next)(); } }} className={cn(field, "w-64")} />
      <span aria-live="polite" className={cn("min-w-[84px] text-[12px]", query && info.total === 0 ? "text-danger" : "text-muted")}>{status}</span>
      <button type="button" aria-label="Résultat précédent" title="Précédent (Maj+Entrée)" onClick={previous} disabled={!info.total} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover disabled:opacity-40"><ChevronUp size={15} /></button>
      <button type="button" aria-label="Résultat suivant" title="Suivant (Entrée)" onClick={next} disabled={!info.total} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover disabled:opacity-40"><ChevronDown size={15} /></button>
      <Toggle on={caseSensitive} label="Aa" title="Respecter la casse" onClick={() => setCase((v) => !v)} />
      <Toggle on={wholeWord} label="ab" title="Mot entier" onClick={() => setWord((v) => !v)} />
      {state.find.replace && (
        <>
          <span className="mx-1 h-5 w-px bg-line" />
          <input value={replacement} onChange={(e) => setReplacement(e.target.value)} placeholder="Remplacer par" aria-label="Remplacer par"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); replaceOne(); } }} className={cn(field, "w-52")} />
          <Button onClick={replaceOne} disabled={!info.total} className="h-7 px-2.5 text-[12px]">Remplacer</Button>
          <Button onClick={replaceEvery} disabled={!info.total} className="h-7 px-2.5 text-[12px]">Tout remplacer</Button>
        </>
      )}
      <button type="button" aria-label="Fermer la recherche" title="Fermer (Échap)" onClick={close} className="ml-auto flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover"><X size={15} /></button>
    </div>
  );
}
