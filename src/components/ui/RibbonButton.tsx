import { ChevronDown, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import type { Command } from "../../editor/commands";
import { useCommand } from "../../editor/commands";

interface Props {
  icon: LucideIcon;
  label?: string;
  /** lg: icon above label (ribbon big button) · sm: icon + label row · icon: icon only */
  size?: "lg" | "sm" | "icon";
  active?: boolean;
  disabled?: boolean;
  /** Command not implemented yet: rendered disabled and tagged. */
  soon?: boolean;
  caret?: boolean;
  title?: string;
  onClick?: (el: HTMLElement) => void;
  className?: string;
  iconClassName?: string;
  children?: ReactNode;
}

export function RibbonButton({ icon: Icon, label, size = "icon", active, disabled, soon, caret, title, onClick, className, iconClassName, children }: Props) {
  const off = disabled || soon;
  // "Bientôt" controls stay focusable so keyboard and screen-reader users can read why they are inert.
  const tip = soon ? `${title ?? label} — bientôt disponible` : title ?? label;
  return (
    <button
      type="button"
      title={tip}
      aria-label={soon ? tip : title ?? label}
      aria-pressed={active}
      aria-disabled={off || undefined}
      disabled={disabled}
      // Prevent focus theft so the editor selection survives a click.
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => !off && onClick?.(e.currentTarget)}
      className={cn(
        "relative flex shrink-0 items-center rounded-md transition-colors duration-100 hover:bg-hover active:bg-line disabled:pointer-events-auto disabled:hover:bg-transparent",
        off && "opacity-50 hover:bg-transparent",
        active && "bg-accent-soft text-accent hover:bg-accent-soft",
        size === "lg" && "h-[58px] min-w-[52px] flex-col justify-center gap-1 px-1.5 text-[11px]",
        size === "sm" && "h-[22px] gap-1.5 px-1.5 text-[11px]",
        size === "icon" && "h-6 w-6 justify-center",
        className,
      )}
    >
      <Icon size={size === "lg" ? 22 : 15} strokeWidth={1.6} className={iconClassName} />
      {label && size !== "icon" && (
        <span className="flex items-center gap-0.5 leading-[13px]">
          {label}
          {caret && <ChevronDown size={9} />}
        </span>
      )}
      {caret && size === "icon" && <ChevronDown size={9} />}
      {soon && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />}
      {children}
    </button>
  );
}

/** A RibbonButton wired to a registered editor/app command. */
export function CommandButton({ id, size = "icon", label, className }: { id: string; size?: "lg" | "sm" | "icon"; label?: string | false; className?: string }) {
  const cmd: Command | undefined = useCommand(id);
  if (!cmd?.icon) return null;
  return (
    <RibbonButton
      icon={cmd.icon}
      size={size}
      label={label === false ? undefined : label ?? cmd.label}
      title={cmd.shortcut ? `${cmd.label} (${cmd.shortcut})` : cmd.label}
      active={cmd.active}
      disabled={cmd.disabled}
      onClick={cmd.run}
      className={className}
    />
  );
}
