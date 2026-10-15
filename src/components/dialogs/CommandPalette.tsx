import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn";
import { useCommandMap } from "../../editor/commands";
import { useApp } from "../../state/store";
import { Kbd } from "../ui/Dialog";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function CommandPalette() {
  const cmds = useCommandMap();
  const { set } = useApp();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const close = () => set({ dialog: null });

  const results = useMemo(() => {
    const q = fold(query.trim());
    return Object.values(cmds).filter((c) => !q || fold(`${c.label} ${c.group}`).includes(q)).slice(0, 12);
  }, [cmds, query]);

  const run = (i: number) => {
    const c = results[i];
    if (!c || c.disabled) return;
    close();
    // Let the palette unmount so the editor can take focus back before the command runs.
    setTimeout(c.run, 0);
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/25 pt-[14vh]" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-label="Palette de commandes" className="w-[560px] max-w-[92vw] overflow-hidden rounded-xl border border-line bg-surface shadow-modal">
        <div className="flex h-11 items-center gap-2 border-b border-line px-3">
          <Search size={15} className="text-muted" />
          <input
            autoFocus value={query} placeholder="Rechercher des commandes ou actions…"
            onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              else if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(results.length - 1, i + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
              else if (e.key === "Enter") run(index);
            }}
            className="h-full flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted"
          />
        </div>
        <ul role="listbox" className="max-h-[320px] overflow-y-auto p-1">
          {results.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-muted">Aucune commande trouvée.</li>}
          {results.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === index}>
              <button
                disabled={c.disabled}
                onMouseMove={() => setIndex(i)}
                onClick={() => run(i)}
                className={cn("flex h-9 w-full items-center gap-3 rounded-md px-3 text-left text-[13px] disabled:opacity-45", i === index && "bg-accent-soft")}
              >
                {c.icon ? <c.icon size={15} className="text-muted" /> : <span className="w-[15px]" />}
                <span className="flex-1 truncate">{c.label}</span>
                <span className="text-[11px] text-muted">{c.group}</span>
                {c.shortcut && <Kbd>{c.shortcut}</Kbd>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
