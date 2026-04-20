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
  derive: (ir: NetXrayIR) => ViewResult;
}

export const VIEW_DEFS: ViewDef[] = [l1View, l2View, l3View, bgpView, ospfAreaView];

export const VIEW_REGISTRY = Object.fromEntries(
  VIEW_DEFS.map((v) => [v.id, v])
) as Record<ViewId, ViewDef>;
