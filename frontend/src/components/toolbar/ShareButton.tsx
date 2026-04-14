import React, { useState, useCallback } from "react";
import { useShareLink } from "../../hooks/useShareLink";
import { useTopologyStore } from "../../stores/topology-store";

type ToastState = "idle" | "copied" | "error";

export const ShareButton: React.FC = () => {
  const { generateShareLink } = useShareLink();
  const hasIR = useTopologyStore((s) => !!s.ir);
  const [toast, setToast] = useState<ToastState>("idle");
  const [busy, setBusy] = useState(false);

  const showToast = (state: ToastState) => {
    setToast(state);
    setTimeout(() => setToast("idle"), 2500);
  };

  const handleShare = useCallback(async () => {
    if (!hasIR || busy) return;
    setBusy(true);
    try {
      const link = await generateShareLink();
      if (link) {
        await navigator.clipboard.writeText(link);
        showToast("copied");
      }
    } catch {
      showToast("error");
    } finally {
      setBusy(false);
    }
  }, [hasIR, busy, generateShareLink]);

  return (
    <div className="relative">
      <button
        onClick={handleShare}
        disabled={!hasIR || busy}
        title={hasIR ? "Copy share link to clipboard" : "Load a topology first"}
        className={`px-3 py-1 rounded transition-colors text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed ${
          toast === "copied"
            ? "bg-green-600 text-white"
            : toast === "error"
            ? "bg-red-600 text-white"
            : "bg-indigo-600 text-white hover:bg-indigo-700"
        }`}
      >
        {busy ? "…" : "🔗 Share"}
      </button>

      {toast === "copied" && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2 py-1 bg-gray-800 text-white text-[10px] rounded shadow-lg whitespace-nowrap z-50 pointer-events-none">
          Link copied to clipboard!
        </div>
      )}
      {toast === "error" && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2 py-1 bg-red-800 text-white text-[10px] rounded shadow-lg whitespace-nowrap z-50 pointer-events-none">
          Failed to copy link
        </div>
      )}
    </div>
  );
};
