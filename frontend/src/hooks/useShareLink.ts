import { useCallback } from "react";
import { useTopologyStore } from "../stores/topology-store";
import { useSnapshotStore } from "../stores/snapshot-store";
import { useWhatIfStore } from "../stores/whatif-store";
import { useViewStore } from "../stores/view-store";
import { encodeShareState, decodeShareState, type SharePayload } from "../lib/share";

export function useShareLink() {
  const ir = useTopologyStore((s) => s.ir);
  const loadIR = useTopologyStore((s) => s.loadIR);

  const snapshots = useSnapshotStore((s) => s.snapshots);
  const setSnapshots = useSnapshotStore((s) => s.setSnapshots);

  const whatIfActive = useWhatIfStore((s) => s.isActive);
  const failures = useWhatIfStore((s) => s.failures);
  const activateWhatIf = useWhatIfStore((s) => s.activate);
  const addFailure = useWhatIfStore((s) => s.addFailure);

  const activeView = useViewStore((s) => s.activeView);
  const setActiveView = useViewStore((s) => s.setActiveView);

  // ── Generate ───────────────────────────────────────────────────────────────

  /**
   * Encode the current app state into a URL with a `#share=<encoded>` fragment.
   * Returns `null` if no IR is loaded.
   */
  const generateShareLink = useCallback(async (): Promise<string | null> => {
    if (!ir) return null;

    const payload: SharePayload = {
      v: 1,
      ir,
      snapshots: snapshots.map((s) => ({
        id: s.id,
        timestamp: s.timestamp,
        label: s.label,
        trigger: s.trigger,
        ir: s.ir,
      })),
      activeView,
      // Only include failures when What-If mode is active
      failures: whatIfActive && failures.length > 0 ? failures : undefined,
    };

    const encoded = await encodeShareState(payload);
    const url = new URL(window.location.href);
    url.hash = `share=${encoded}`;
    return url.toString();
  }, [ir, snapshots, activeView, whatIfActive, failures]);

  // ── Load from URL hash ─────────────────────────────────────────────────────

  /**
   * Check `window.location.hash` for a `#share=` fragment and restore state.
   * Returns `true` if a share payload was found and successfully decoded.
   */
  const loadFromHash = useCallback(async (): Promise<boolean> => {
    const hash = window.location.hash;
    if (!hash.startsWith("#share=")) return false;

    const encoded = hash.substring(7); // strip "#share="
    try {
      const payload = await decodeShareState(encoded);

      // 1. Load the primary IR
      if (payload.ir) {
        loadIR(payload.ir);
      }

      // 2. Restore snapshots
      if (payload.snapshots && payload.snapshots.length > 0) {
        setSnapshots(payload.snapshots as any);
      }

      // 3. Restore active view
      if (payload.activeView) {
        setActiveView(payload.activeView);
      }

      // 4. Restore What-If failures — activate mode and re-apply each failure
      if (payload.failures && payload.failures.length > 0 && payload.ir) {
        activateWhatIf(payload.ir);
        for (const failure of payload.failures) {
          addFailure(failure);
        }
      }

      return true;
    } catch (err) {
      console.error("[useShareLink] Failed to decode share payload:", err);
      return false;
    }
  }, [loadIR, setSnapshots, setActiveView, activateWhatIf, addFailure]);

  return { generateShareLink, loadFromHash };
}
