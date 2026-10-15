import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface Anchor {
  x: number;
  y: number;
  /** Height of the anchoring element, so the popover opens below it. */
  h?: number;
}

/** Floating surface rendered in a portal; closes on outside press, Escape and window blur. */
export function Popover({ anchor, onClose, children, className = "" }: { anchor: Anchor; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.x, top: anchor.y + (anchor.h ?? 0) });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const left = Math.max(4, Math.min(anchor.x, window.innerWidth - width - 4));
    let top = anchor.y + (anchor.h ?? 0);
    if (top + height > window.innerHeight - 4) top = Math.max(4, (anchor.h ? anchor.y : top) - height - (anchor.h ?? 0));
    setPos({ left, top });
  }, [anchor]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key);
      window.removeEventListener("blur", onClose);
      };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      style={{ left: pos.left, top: pos.top }}
      // Keep the editor selection alive while interacting with menus.
      onMouseDown={(e) => !(e.target instanceof HTMLInputElement) && e.preventDefault()}
      className={`fixed z-50 rounded-lg border border-line bg-surface p-1 shadow-pop ${className}`}
    >
      {children}
    </div>,
    document.body,
  );
}

/** Opens a popover under a trigger element. */
export function usePopover() {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const close = () => setAnchor(null);
  const toggle = (el: HTMLElement) => {
    if (anchor) return close();
    const r = el.getBoundingClientRect();
    setAnchor({ x: r.left, y: r.top, h: r.height + 2 });
  };
  return { anchor, toggle, close, open: anchor !== null };
}
