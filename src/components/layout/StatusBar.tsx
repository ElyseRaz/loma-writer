import { BookOpen, Check, Circle, Globe, Minus, Plus, ScrollText } from "lucide-react";
import { useLomaEditor } from "../../editor/EditorProvider";
import { useEditorSnapshot } from "../../editor/useEditorSnapshot";
import { useSections } from "../../editor/useSections";
import { useCommandMap } from "../../editor/commands";
import { useApp } from "../../state/store";
import { pageGeometry } from "../../pagination/model";
import { usePageInfo } from "../../pagination/usePagination";

export function StatusBar() {
  const editor = useLomaEditor();
  const snap = useEditorSnapshot(editor);
  const { state, set } = useApp();
  const cmds = useCommandMap();
  const { pitch } = pageGeometry(state.page);
  const { sections, current } = useSections(editor, state.page, state.headerFooter);
  const { current: page, total } = usePageInfo(editor, pitch);
  const setZoom = (zoom: number) => set({ zoom });
  const dot = <Circle size={3} className="fill-muted text-muted" aria-hidden />;
  const plural = (n: number, s: string) => `${n} ${s}${n > 1 ? "s" : ""}`;

  return (
    <footer className="flex h-6 shrink-0 select-none items-center border-t border-line bg-surface px-3 text-[11px] text-muted">
      <span title="Pagination calculée à partir de la mise en page réelle">
        Page {page} sur {total}
      </span>
      {sections.length > 1 && <span className="ml-2.5" title="Section du curseur">Section {current + 1}</span>}
      <span className="mx-2.5">{dot}</span>
      <span>{plural(snap.words, "mot")}</span>
      <span className="mx-2.5">{dot}</span>
      <span>{plural(snap.characters, "caractère")}</span>
      <span className="mx-2.5">{dot}</span>
      <span>Français (France)</span>
      <span className="mx-2.5">{dot}</span>
      <span title="Format d'enregistrement du document" className="font-medium uppercase">{state.doc.format}</span>
      <span className="mx-2.5">{dot}</span>
      <span className={`flex items-center gap-1 ${state.doc.dirty ? "" : "text-accent"}`}>
        {state.doc.dirty ? <>Modifications non enregistrées</> : <><Check size={11} /> Enregistré</>}
      </span>

      <div className="ml-auto flex items-center gap-1">
        <span className="flex items-center gap-0.5 rounded-md bg-chrome p-0.5">
          <button disabled title="Mode Page (mode actuel)" aria-label="Mode Page, mode actuel" className="flex h-4 w-5 items-center justify-center rounded bg-surface text-accent shadow-sm">
            <ScrollText size={12} />
          </button>
          <button disabled title="Mode Web — bientôt disponible" aria-label="Mode Web" className="flex h-4 w-5 items-center justify-center rounded opacity-45"><Globe size={12} /></button>
          <button disabled title="Mode Lecture — bientôt disponible" aria-label="Mode Lecture" className="flex h-4 w-5 items-center justify-center rounded opacity-45"><BookOpen size={12} /></button>
        </span>
        <span className="mx-2 h-3 w-px bg-line" />
        <button aria-label="Zoom arrière" title="Zoom arrière (Ctrl+-)" onClick={() => cmds["view.zoomOut"]?.run()} className="flex h-5 w-5 items-center justify-center rounded hover:bg-hover"><Minus size={12} /></button>
        <input
          type="range" min={25} max={300} step={5} value={state.zoom} aria-label="Zoom"
          onChange={(e) => setZoom(Number(e.target.value))}
          className="h-1 w-28 cursor-pointer accent-[var(--c-accent)]"
        />
        <button aria-label="Zoom avant" title="Zoom avant (Ctrl+=)" onClick={() => cmds["view.zoomIn"]?.run()} className="flex h-5 w-5 items-center justify-center rounded hover:bg-hover"><Plus size={12} /></button>
        <button title="Revenir à 100 % (Ctrl+0)" onClick={() => setZoom(100)} className="ml-1 w-10 rounded px-1 text-right text-fg hover:bg-hover">{state.zoom}%</button>
      </div>
    </footer>
  );
}
