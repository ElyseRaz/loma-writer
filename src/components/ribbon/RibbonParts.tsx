import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/** A labelled cluster of commands, separated from its neighbours by a hairline. */
export function RibbonGroup({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <section aria-label={label} className="flex shrink-0 flex-col border-r border-line px-2 last:border-r-0">
      <div className={cn("flex flex-1 items-center gap-1", className)}>{children}</div>
      <div className="pb-0.5 text-center text-[10px] leading-3 text-muted">{label}</div>
    </section>
  );
}

/** Vertical stack of ribbon rows (2–3 small controls high). */
export function RibbonStack({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col justify-center gap-0.5", className)}>{children}</div>;
}

export function RibbonRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex items-center gap-0.5", className)}>{children}</div>;
}

export const RibbonSeparator = () => <div className="mx-0.5 h-4 w-px bg-line" />;
