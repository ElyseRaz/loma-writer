import { Check, type LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn";
import { Popover, type Anchor } from "./Popover";

export type MenuEntry =
  | { separator: true }
  | {
      label: string;
      icon?: LucideIcon;
      shortcut?: string;
      checked?: boolean;
      disabled?: boolean;
      /** Not implemented yet: shown disabled with a "Bientôt" tag. */
      soon?: boolean;
      /** Tooltip and accessible description of the entry (short: it is only shown on hover). */
      title?: string;
      /** Font preview for font pickers. */
      fontFamily?: string;
      onSelect?: () => void;
    };

export function MenuList({ items, onClose }: { items: MenuEntry[]; onClose: () => void }) {
  return (
    <div role="menu" className="min-w-48 py-0.5">
      {items.map((item, i) =>
        "separator" in item ? (
          <div key={i} className="my-1 h-px bg-line" />
        ) : (
          <button
            key={item.label}
            role="menuitem"
            disabled={item.disabled || item.soon}
            title={item.soon ? `${item.label} — bientôt disponible` : item.title}
            aria-description={item.soon ? undefined : item.title}
            onClick={() => {
              onClose();
              item.onSelect?.();
            }}
            className={cn(
              "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-hover disabled:opacity-45 disabled:hover:bg-transparent",
              item.checked && "text-accent",
            )}
          >
            <span className="flex w-4 justify-center">
              {item.checked ? <Check size={14} /> : item.icon ? <item.icon size={15} strokeWidth={1.75} /> : null}
            </span>
            <span className="flex-1 truncate" style={item.fontFamily ? { fontFamily: item.fontFamily } : undefined}>
              {item.label}
            </span>
            {item.soon && <span className="rounded bg-chrome px-1 text-[9px] font-medium uppercase text-muted">Bientôt</span>}
            {item.shortcut && <span className="text-[10px] font-medium tracking-wide text-muted">{item.shortcut}</span>}
          </button>
        ),
      )}
    </div>
  );
}

/** Context menu at a screen position. */
export function ContextMenu({ at, items, onClose }: { at: Anchor; items: MenuEntry[]; onClose: () => void }) {
  return (
    <Popover anchor={at} onClose={onClose}>
      <MenuList items={items} onClose={onClose} />
    </Popover>
  );
}
