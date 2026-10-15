import { ChevronUp } from "lucide-react";
import { cn } from "../../lib/cn";
import { useApp } from "../../state/store";
import type { RibbonTabId } from "../../state/types";
import { HomeTab } from "../ribbon/HomeTab";
import { InsertTab } from "../ribbon/InsertTab";
import { LayoutTab } from "../ribbon/LayoutTab";
import { ReferencesTab, ReviewTab, ViewTab } from "../ribbon/OtherTabs";

const TABS: Array<{ id: RibbonTabId; label: string }> = [
  { id: "home", label: "Accueil" },
  { id: "insert", label: "Insertion" },
  { id: "layout", label: "Mise en page" },
  { id: "references", label: "Références" },
  { id: "review", label: "Révision" },
  { id: "view", label: "Affichage" },
];

const BODY: Record<RibbonTabId, () => React.JSX.Element> = {
  home: HomeTab,
  insert: InsertTab,
  layout: LayoutTab,
  references: ReferencesTab,
  review: ReviewTab,
  view: ViewTab,
};

export function Ribbon() {
  const { state, set } = useApp();
  const Body = BODY[state.tab];

  return (
    <div className="shrink-0 bg-chrome">
      <div role="tablist" className="flex h-[34px] items-end gap-0.5 px-2">
        <button
          onClick={() => set({ view: "backstage" })}
          className="mb-1 mr-1.5 h-[26px] rounded-md bg-accent px-3.5 text-[12.5px] font-medium text-white hover:brightness-110 dark:text-[#0b1220]"
        >
          Fichier
        </button>
        {TABS.map((t) => {
          const active = state.tab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => set({ tab: t.id, ribbonCollapsed: false })}
              className={cn(
                "relative mb-1 h-[26px] rounded-md px-3 text-[13px] font-medium tracking-[-0.01em] transition-colors",
                active ? "text-accent" : "text-fg hover:bg-hover",
              )}
            >
              {t.label}
              {active && <span className="absolute inset-x-3 -bottom-1 h-0.5 rounded-full bg-accent" />}
            </button>
          );
        })}
        <button
          onClick={() => set((s) => ({ ribbonCollapsed: !s.ribbonCollapsed }))}
          title={state.ribbonCollapsed ? "Développer le ruban" : "Réduire le ruban"}
          aria-label={state.ribbonCollapsed ? "Développer le ruban" : "Réduire le ruban"}
          className="mb-1 ml-auto flex h-6 w-6 items-center justify-center rounded-md hover:bg-hover"
        >
          <ChevronUp size={14} className={cn("transition-transform", state.ribbonCollapsed && "rotate-180")} />
        </button>
      </div>
      {!state.ribbonCollapsed && (
        <div role="tabpanel" className="flex h-[92px] items-stretch overflow-x-auto overflow-y-hidden border-y border-line bg-surface px-1 py-1">
          <Body />
        </div>
      )}
      {state.ribbonCollapsed && <div className="h-px bg-line" />}
    </div>
  );
}
