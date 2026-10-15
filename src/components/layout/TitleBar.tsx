import { Copy, Minus, Redo2, Save, Search, Settings, Square, Undo2, X } from "lucide-react";
import { useEffect, useState, type MouseEvent } from "react";
import { cn } from "../../lib/cn";
import { isTauri } from "../../lib/platform";
import { useCommandMap } from "../../editor/commands";
import { useApp } from "../../state/store";
import { isMaximized, minimizeWindow, onResized, startDragging, toggleMaximizeWindow } from "../../services/window";
import { RibbonButton } from "../ui/RibbonButton";
import { LomaLogo } from "./LomaLogo";

function WindowButton({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn("flex h-8 w-11 items-center justify-center text-fg transition-colors", danger ? "hover:bg-[#dc2626] hover:text-white" : "hover:bg-line")}
    >
      {children}
    </button>
  );
}

export function TitleBar() {
  const { state, set } = useApp();
  const cmds = useCommandMap();
  const [maximized, setMaximized] = useState(false);
  const { doc } = state;

  useEffect(() => {
    const sync = () => void isMaximized().then(setMaximized);
    sync();
    return onResized(sync);
  }, []);

  const onBarMouseDown = (e: MouseEvent) => {
    if (e.button !== 0 || !isTauri() || (e.target as HTMLElement).closest("button")) return;
    if (e.detail === 2) toggleMaximizeWindow();
    else startDragging();
  };

  const quick = (id: string, icon: typeof Undo2) => {
    const c = cmds[id];
    return <RibbonButton icon={icon} title={c ? `${c.label}${c.shortcut ? ` (${c.shortcut})` : ""}` : id} disabled={!c || c.disabled} onClick={c?.run} />;
  };

  return (
    <header onMouseDown={onBarMouseDown} className="relative flex h-8 shrink-0 select-none items-center bg-chrome pl-2.5">
      <LomaLogo size={18} />
      <span className="ml-2 text-[12px] font-medium">Loma Writer</span>
      <span className="mx-2.5 h-3.5 w-px bg-line" />
      <span className="max-w-[260px] truncate text-[12px]" title={doc.path ?? "Document non enregistré"}>{doc.title}<span className="text-muted">.{doc.format}</span></span>
      <span
        className={cn(
          "ml-2 flex items-center gap-1 rounded px-1.5 py-px text-[10.5px]",
          doc.dirty ? "bg-hover text-muted" : "text-muted",
        )}
      >
        <span className={cn("h-1.5 w-1.5 rounded-full", doc.dirty ? "bg-danger" : "bg-emerald-500")} />
        {doc.dirty ? "Non enregistré" : doc.path ? "Enregistré" : "Nouveau"}
      </span>
      <div className="ml-3 flex items-center gap-0.5">
        {quick("edit.undo", Undo2)}
        {quick("edit.redo", Redo2)}
        {quick("file.save", Save)}
      </div>

      <button
        onClick={() => set({ dialog: "palette" })}
        title="Rechercher des commandes (Ctrl+K)"
        className="absolute left-1/2 top-1 hidden h-6 w-[min(420px,34vw)] -translate-x-1/2 items-center gap-2 rounded-md border border-line bg-surface px-2 text-[12px] text-muted hover:bg-hover md:flex"
      >
        <Search size={13} />
        <span className="flex-1 truncate text-left">Rechercher des commandes ou actions</span>
        <kbd className="rounded bg-chrome px-1.5 text-[10px]">Ctrl+K</kbd>
      </button>

      <div className="ml-auto flex items-center">
        <RibbonButton icon={Settings} title="Préférences" onClick={() => set({ dialog: "preferences" })} className="mr-2" />
        {isTauri() && (
          <>
            <WindowButton label="Réduire" onClick={minimizeWindow}>
              <Minus size={14} />
            </WindowButton>
            <WindowButton label={maximized ? "Restaurer" : "Agrandir"} onClick={toggleMaximizeWindow}>
              {maximized ? <Copy size={12} /> : <Square size={11} />}
            </WindowButton>
            <WindowButton label="Fermer" danger onClick={() => cmds["file.quit"]?.run()}>
              <X size={15} />
            </WindowButton>
          </>
        )}
      </div>
    </header>
  );
}
