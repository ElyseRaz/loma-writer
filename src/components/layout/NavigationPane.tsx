import { PanelLeft, Search, X } from "lucide-react";
import { useState } from "react";
import { useEditorState } from "@tiptap/react";
import { cn } from "../../lib/cn";
import { useLomaEditor } from "../../editor/EditorProvider";
import { useApp } from "../../state/store";

interface Heading {
  level: number;
  text: string;
  pos: number;
}

export function NavigationPane() {
  const editor = useLomaEditor();
  const { set } = useApp();
  const [query, setQuery] = useState("");

  const headings =
    useEditorState({
      editor,
      selector: ({ editor: e }): Heading[] => {
        const out: Heading[] = [];
        e?.state.doc.descendants((node, pos) => {
          if (node.type.name === "heading" && node.textContent.trim()) out.push({ level: node.attrs.level as number, text: node.textContent, pos });
        });
        return out;
      },
    }) ?? [];

  const q = query.trim().toLowerCase();
  const shown = q ? headings.filter((h) => h.text.toLowerCase().includes(q)) : headings;

  return (
    <aside className="flex w-[232px] shrink-0 flex-col border-r border-line bg-surface" aria-label="Volet de navigation">
      <div className="flex h-9 items-center gap-2 border-b border-line px-3">
        <PanelLeft size={14} className="text-accent" />
        <span className="flex-1 text-[12px] font-medium">Navigation</span>
        <button aria-label="Fermer le volet" title="Fermer" onClick={() => set({ navPane: false })} className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-hover">
          <X size={14} />
        </button>
      </div>
      <div className="flex gap-1 px-3 pt-2 text-[12px]">
        <span className="rounded-md bg-accent-soft px-2.5 py-1 font-medium text-accent">Titres</span>
        <span title="Bientôt disponible" className="rounded-md px-2.5 py-1 text-muted opacity-60">Pages</span>
        <span title="Bientôt disponible" className="rounded-md px-2.5 py-1 text-muted opacity-60">Résultats</span>
      </div>
      <label className="mx-3 mt-2 flex h-7 items-center gap-1.5 rounded-md border border-line bg-chrome px-2 text-muted focus-within:border-accent">
        <Search size={12} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filtrer les titres" className="min-w-0 flex-1 bg-transparent text-[12px] text-fg outline-none placeholder:text-muted" />
      </label>
      <nav className="mt-2 flex-1 overflow-y-auto px-2 pb-2">
        {shown.length === 0 ? (
          <p className="px-2 py-3 text-[12px] leading-[17px] text-muted">
            {headings.length ? "Aucun titre ne correspond." : "Les titres du document (Titre 1, 2, 3) apparaîtront ici."}
          </p>
        ) : (
          shown.map((h) => (
            <button
              key={h.pos}
              onClick={() => editor?.chain().focus().setTextSelection(h.pos + 1).scrollIntoView().run()}
              style={{ paddingLeft: 8 + (h.level - 1) * 14 }}
              className={cn("block h-7 w-full truncate rounded-md pr-2 text-left text-[12.5px] hover:bg-hover", h.level === 1 && "font-medium")}
            >
              {h.text}
            </button>
          ))
        )}
      </nav>
      <div className="border-t border-line px-3 py-1.5 text-[10px] text-muted">Arborescence générée depuis les styles de titre</div>
    </aside>
  );
}
