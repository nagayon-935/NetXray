import type { NetXrayIR } from "../types/netxray-ir";
import type {
  SimEngine,
  PacketHeader,
  PacketPath,
  RoutingUpdate,
  ShadowedRule,
  FailureSpec,
  ConvergenceStep,
} from "./types";
import { mockEngine } from "./mock-engine";

// Lazy-loaded WASM module binding
type WasmModule = {
  load_topology(ir_json: string): void;
  simulate_packet(packet_json: string): string;
  simulate_link_failure(link_id: string): string;
  detect_acl_shadows(acl_name: string): string;
};

let wasmMod: WasmModule | null = null;

// Module-level engine reference — starts as mock, upgraded to WASM once loaded.
// Using a module-level variable avoids storing a class instance in Zustand,
// which would cause React 19 / useSyncExternalStore to switch internal hook
// strategies between renders and trigger "Rules of Hooks" violations.
let currentEngine: SimEngine = mockEngine;

/** Returns the currently active engine (WASM once loaded, mock otherwise). */
export function getEngine(): SimEngine {
  return currentEngine;
}

// Singleton init promise — WASM is loaded at most once
let initPromise: Promise<SimEngine | null> | null = null;

export function loadWasmEngine(): Promise<SimEngine | null> {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const mod = await import("../wasm/netxray_engine");
        await mod.default(); // init WebAssembly.instantiate
        wasmMod = {
          load_topology: mod.load_topology,
          simulate_packet: mod.simulate_packet,
          simulate_link_failure: mod.simulate_link_failure,
          detect_acl_shadows: mod.detect_acl_shadows,
        };
        currentEngine = new WasmEngine();
        return currentEngine;
      } catch (err) {
        console.warn("[NetXray] WASM engine unavailable, using mock:", err);
        return null;
      }
    })();
  }
  return initPromise;
}

class WasmEngine implements SimEngine {
  loadTopology(ir: NetXrayIR): void {
    if (!wasmMod) throw new Error("WASM not initialized");
    wasmMod.load_topology(JSON.stringify(ir));
  }

  simulatePacket(packet: PacketHeader): PacketPath {
    if (!wasmMod) throw new Error("WASM not initialized");
    const raw = wasmMod.simulate_packet(JSON.stringify(packet));
    const result = JSON.parse(raw) as PacketPath;
    // WASM returns matched_seq instead of matched_rule — normalize hops
    return {
      ...result,
      hops: result.hops.map((hop) => ({
        ...hop,
        acl_result: hop.acl_result
          ? { ...hop.acl_result, matched_rule: null }
          : undefined,
      })),
    };
  }

  simulateLinkFailure(linkId: string): RoutingUpdate {
    if (!wasmMod) throw new Error("WASM not initialized");
    return JSON.parse(wasmMod.simulate_link_failure(linkId)) as RoutingUpdate;
  }

  detectAclShadows(aclName: string): ShadowedRule[] {
    if (!wasmMod) throw new Error("WASM not initialized");
    return JSON.parse(wasmMod.detect_acl_shadows(aclName)) as ShadowedRule[];
  }

  // ── Phase 5: What-If API ─────────────────────────────────────────────────────
  // WASM does not yet implement these — delegate to the mock engine which runs
  // entirely in TypeScript. When a native WASM implementation is added, swap
  // these out for proper wasmMod calls.

  simulateNodeFailure(nodeId: string): RoutingUpdate {
    return mockEngine.simulateNodeFailure(nodeId);
  }

  simulateMultiFailure(failures: FailureSpec[]): RoutingUpdate {
    return mockEngine.simulateMultiFailure(failures);
  }

  computeAlternatePaths(
    srcNodeId: string,
    dstNodeId: string,
    failures: FailureSpec[],
  ): PacketPath[] {
    return mockEngine.computeAlternatePaths(srcNodeId, dstNodeId, failures);
  }

  simulateConvergence(failures: FailureSpec[]): ConvergenceStep[] {
    return mockEngine.simulateConvergence(failures);
  }
}
