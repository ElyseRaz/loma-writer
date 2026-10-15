import { useEffect } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import { useApp } from "../../state/store";

export function Toast() {
  const { state, set } = useApp();
  const toast = state.toast;
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => set({ toast: null }), toast.kind === "error" ? 6000 : 3000);
    return () => clearTimeout(t);
  }, [toast, set]);
  if (!toast) return null;
  const Icon = toast.kind === "error" ? CircleAlert : CircleCheck;
  return (
    <div role="status" className="pointer-events-none fixed bottom-10 left-1/2 z-[80] flex max-w-[80vw] -translate-x-1/2 items-center gap-2 rounded-lg border border-line bg-surface px-3.5 py-2 text-[12.5px] shadow-modal">
      <Icon size={15} className={toast.kind === "error" ? "text-danger" : "text-emerald-500"} />
      {toast.message}
    </div>
  );
}
