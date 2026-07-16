import { useToastStore, type ToastType } from "../stores/toast-store";

const STYLE: Record<ToastType, { bar: string; icon: string }> = {
  success: { bar: "border-l-emerald-500", icon: "✓" },
  error: { bar: "border-l-red-500", icon: "✕" },
  warning: { bar: "border-l-amber-500", icon: "⚠" },
  info: { bar: "border-l-blue-500", icon: "ℹ" },
};

const ICON_COLOR: Record<ToastType, string> = {
  success: "text-emerald-500",
  error: "text-red-500",
  warning: "text-amber-500",
  info: "text-blue-500",
};

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[1000] flex flex-col gap-2 max-w-sm pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={`pointer-events-auto cursor-pointer bg-white shadow-lg rounded border border-slate-200 border-l-4 ${STYLE[t.type].bar} px-3 py-2 flex items-start gap-2 text-sm animate-[fadeIn_0.15s_ease-out]`}
          title="Click to dismiss"
        >
          <span className={`font-bold leading-5 ${ICON_COLOR[t.type]}`}>{STYLE[t.type].icon}</span>
          <span className="text-slate-700 break-words flex-1">{t.message}</span>
        </div>
      ))}
    </div>
  );
}
