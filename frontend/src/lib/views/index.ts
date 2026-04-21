/**
 * views/index.ts — View registry for the layered topology system.
 *
 * Each ViewDef describes one perspective on the IR:
 *  - "l1"        Physical links and all nodes (default)
 *  - "l2"        L2 broadcast domains grouped by EVPN VNI
 *  - "l3"        Pure L3 / IP subnet view
 *  - "bgp"       BGP AS groups with iBGP/eBGP sessions
 *  - "ospf-area" OSPF Areas with ABR highlighting
 */

import type { Node as FlowNode, Edge as FlowEdge } from "@xyflow/react";
import type { NetXrayIR } from "../../types/netxray-ir";
import type { PacketPath } from "../../engine/types";
import { l1View } from "./l1-view";
import { l2View } from "./l2-view";
import { l3View } from "./l3-view";
import { bgpView } from "./bgp-view";
import { ospfAreaView } from "./ospf-area-view";

export type ViewId = "l1" | "l2" | "l3" | "bgp" | "ospf-area";

export interface ViewResult {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface ViewDef {
  id: ViewId;
  label: string;
  description: string;
  color: string;
  needsLayout: boolean;
  isAvailable: (ir: NetXrayIR) => boolean;
  derive: (ir: NetXrayIR, packetPath?: PacketPath | null) => ViewResult;
}

/**
 * Helper to check if a physical link is part of the simulated packet path.
 */
export function isLinkOnPath(
  link: NetXrayIR["topology"]["links"][number],
  packetPath?: PacketPath | null
): boolean {
  if (!packetPath) return false;

  for (let i = 0; i < packetPath.hops.length - 1; i++) {
    const current = packetPath.hops[i];
    const next = packetPath.hops[i + 1];

    if (
      // Forward direction
      (current.node_id === link.source.node &&
        current.egress_interface === link.source.interface &&
        next.node_id === link.target.node &&
        next.ingress_interface === link.target.interface) ||
      // Reverse direction (links are bidirectional in IR)
      (current.node_id === link.target.node &&
        current.egress_interface === link.target.interface &&
        next.node_id === link.source.node &&
        next.ingress_interface === link.source.interface)
    ) {
      return true;
    }
  }
  return false;
}

export const VIEW_DEFS: ViewDef[] = [l1View, l2View, l3View, bgpView, ospfAreaView];

export const VIEW_REGISTRY = Object.fromEntries(
  VIEW_DEFS.map((v) => [v.id, v])
) as Record<ViewId, ViewDef>;
