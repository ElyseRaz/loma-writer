import { useEffect, useState } from "react";
import { cn } from "../../lib/cn";

interface Props {
  label: string;
  /** Shown after the value ("cm", "pt"). */
  unit: string;
  value: number | null;
  /** Called with a valid value when Enter is pressed, the field loses focus or a step button is used. */
  onCommit: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  className?: string;
  title?: string;
}

/** Compact numeric field with a unit, for the ribbon: it keeps what is typed until it is valid, then commits it. */
export function NumberField({ label, unit, value, onCommit, min = 0, max = 1000, step = 0.1, placeholder, className, title }: Props) {
  const show = (v: number | null) => (v === null ? "" : String(+v.toFixed(2)).replace(".", ","));
  const [text, setText] = useState(show(value));
  useEffect(() => setText(show(value)), [value]);
  const parsed = parseFloat(text.replace(",", "."));
  const valid = text.trim() === "" || (Number.isFinite(parsed) && parsed >= min && parsed <= max);
  const commit = (raw: string) => {
    const v = parseFloat(raw.replace(",", "."));
    if (Number.isFinite(v) && v >= min && v <= max) onCommit(Math.round(v * 100) / 100);
    else setText(show(value));
  };
  const bump = (d: number) => onCommit(Math.round(Math.min(max, Math.max(min, (Number.isFinite(parsed) ? parsed : value ?? 0) + d)) * 100) / 100);
  return (
    <label className={cn("flex items-center gap-1 text-[11px] text-muted", className)} title={title}>
      <span className="w-[44px] shrink-0">{label}</span>
      <span className={cn("flex h-6 items-center rounded-md border bg-surface focus-within:border-accent", valid ? "border-line" : "border-danger")}>
        <input
          inputMode="decimal"
          aria-label={`${label} (${unit})`}
          aria-invalid={!valid || undefined}
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(text); }
            else if (e.key === "ArrowUp") { e.preventDefault(); bump(step); }
            else if (e.key === "ArrowDown") { e.preventDefault(); bump(-step); }
          }}
          className="h-full w-[42px] bg-transparent px-1 text-right text-[12px] text-fg outline-none"
        />
        <span className="pr-1 text-[10px]">{unit}</span>
      </span>
    </label>
  );
}
