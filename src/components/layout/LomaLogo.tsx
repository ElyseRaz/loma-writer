/** The application icon (public/loma-icon.png, carré tiré de loma.png). */
export function LomaLogo({ size = 20 }: { size?: number }) {
  return <img src="/loma-icon.png" width={size} height={size} alt="" aria-hidden draggable={false} className="shrink-0 rounded-[22%]" style={{ width: size, height: size }} />;
}

/** The "Loma Writer" wordmark; dark theme gets it on a light card since the logo is dark blue. */
export function LomaWordmark({ height = 48, className = "" }: { height?: number; className?: string }) {
  return <img src="/logo_transparent.png" alt="Loma Writer" draggable={false} className={`w-auto object-contain ${className}`} style={{ height }} />;
}
