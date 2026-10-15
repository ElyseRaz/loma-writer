import type { LucideIcon } from "lucide-react";

const make = (sign: "plus" | "minus") =>
  function TextSizeIcon({ size = 15, strokeWidth = 1.6, className }: { size?: number; strokeWidth?: number; className?: string }) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
        <path d="M3 7V5h12v2M9 5v14M6.5 19h5" />
        <path d={sign === "plus" ? "M18.5 5.5v6M15.5 8.5h6" : "M15.5 8.5h6"} />
      </svg>
    );
  };

/** "T+" and "T-": enlarge and shrink the font. */
export const TextGrow = make("plus") as unknown as LucideIcon;
export const TextShrink = make("minus") as unknown as LucideIcon;
