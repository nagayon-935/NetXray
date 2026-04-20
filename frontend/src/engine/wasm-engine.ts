import type { NetXrayIR } from "../types/netxray-ir";
import type {
  SimEngine,
  PacketHeader,
  PacketPath,
  ShadowedRule,
  AclEvaluation,
} from "./types";
import { mockEngine } from "./mock-engine";

type WasmModule = {
  load_topology(ir_json: string): void;
  simulate_packet(packet_json: string): string;
  detect_acl_shadows(acl_name: string): string;
  evaluate_acl_named(acl_name: string, packet_json: string): string;
};

let wasmMod: WasmModule | null = null;

let currentEngine: SimEngine = mockEngine;

export function getEngine(): SimEngine {
  return currentEngine;
}

let initPromise: Promise<SimEngine | null> | null = null;

export function loadWasmEngine(): Promise<SimEngine | null> {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const mod = await import("../wasm/netxray_engine");
        await mod.default();
        wasmMod = {
          load_topology: mod.load_topology,
          simulate_packet: mod.simulate_packet,
          detect_acl_shadows: mod.detect_acl_shadows,
          evaluate_acl_named: mod.evaluate_acl_named,
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
    mockEngine.loadTopology(ir);
  }

  simulatePacket(packet: PacketHeader): PacketPath {
    if (!wasmMod) throw new Error("WASM not initialized");
    const raw = wasmMod.simulate_packet(JSON.stringify(packet));
    const result = JSON.parse(raw) as PacketPath;
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

  detectAclShadows(aclName: string): ShadowedRule[] {
    if (!wasmMod) throw new Error("WASM not initialized");
    return JSON.parse(wasmMod.detect_acl_shadows(aclName)) as ShadowedRule[];
  }

  evaluateAcl(aclName: string, packet: PacketHeader): AclEvaluation {
    if (!wasmMod) throw new Error("WASM not initialized");
    return JSON.parse(
      wasmMod.evaluate_acl_named(aclName, JSON.stringify(packet))
    ) as AclEvaluation;
  }
}
