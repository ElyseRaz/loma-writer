import { X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props {
  title: string;
  icon?: LucideIcon;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  /** Clicking the dimmed backdrop closes the dialog (disable when it holds unsaved form state). */
  backdropClose?: boolean;
}

export function Dialog({ title, icon: Icon, onClose, children, footer, width = 560, backdropClose = true }: Props) {
  const panel = useRef<HTMLDivElement>(null);

  // Remember the opener once, restore focus to it when the dialog goes away.
  // Captured during the first render, i.e. before the dialog moves focus (also under StrictMode re-runs).
  const opener = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    const previous = opener.current;
    return () => {
      // After React has detached the dialog, hand focus back to whatever opened it.
      setTimeout(() => !panel.current && previous?.isConnected && previous.focus(), 0);
    };
  }, []);

  useEffect(() => {
    const focusables = () =>
      [...(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input, select, [href], [tabindex]:not([tabindex="-1"])') ?? [])];
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (e.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);

  // Initial focus: first form field if any, otherwise the primary action.
  useEffect(() => {
    const root = panel.current;
    const items = root?.querySelectorAll<HTMLElement>("button:not([disabled]), input, select");
    (root?.querySelector<HTMLElement>("input, select") ?? (items && items[items.length - 1]))?.focus();
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/35 p-6 backdrop-blur-[3px]" onMouseDown={(e) => backdropClose && e.target === e.currentTarget && onClose()}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={title} style={{ width }} className="flex max-h-full max-w-full flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-modal">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4">
          {Icon && (
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent-soft text-accent">
              <Icon size={16} />
            </span>
          )}
          <h2 className="flex-1 text-[14px] font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Fermer" className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover">
            <X size={16} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-4 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function Button({ variant = "default", className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" }) {
  return (
    <button
      {...props}
      className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[13px] font-medium transition-colors disabled:opacity-50 ${
        variant === "primary" ? "border-accent bg-accent text-white hover:brightness-110 dark:text-[#0b1220]" : "border-line bg-surface hover:bg-hover"
      } ${className}`}
    />
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-accent" : "bg-line"}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

export const Kbd = ({ children }: { children: ReactNode }) => (
  <kbd className="rounded bg-chrome px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted">{children}</kbd>
);
