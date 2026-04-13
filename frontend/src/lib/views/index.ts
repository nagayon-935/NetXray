/**
 * views/index.ts — View registry for the hierarchical topology layer system.
 *
 * Each ViewDef describes one topology perspective:
 *  - "physical"  Physical links and all nodes (default)
 *  - "l2"        L2 broadcast domains grouped by EVPN VNI
 *  - "l3"        BGP AS groups with eBGP inter-AS edges
 *  - "overlay"   EVPN VTEP tunnels and SRv6 segments
 *
 * Views produce FlowNode[] / FlowEdge[] with pre-computed positions.
 * TopologyCanvas skips the ELK layout step when a non-physical view is active.
 */

import type { Node as FlowNode, Edge as FlowEdge } from "@xyflow/react";
import type { NetXrayIR } from "../../types/netxray-ir";
import { physicalView } from "./physical-view";
import { l2View } from "./l2-view";
import { l3View } from "./l3-view";
import { overlayView } from "./overlay-view";

export type ViewId = "physical" | "l2" | "l3" | "overlay";

export interface ViewResult {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface ViewDef {
  id: ViewId;
  label: string;
  description: string;
  color: string;
  /**
   * Whether this view needs the ELK layout pass after derivation.
   * Physical view defers to ELK; structured views (l2/l3/overlay) pre-compute positions.
   */
  needsLayout: boolean;
  /** Return false when the IR doesn't have enough data to make this view meaningful. */
  isAvailable: (ir: NetXrayIR) => boolean;
  /** Derive nodes + edges from the IR. */
  derive: (ir: NetXrayIR) => ViewResult;
}

export const VIEW_DEFS: ViewDef[] = [physicalView, l2View, l3View, overlayView];

export const VIEW_REGISTRY = Object.fromEntries(
  VIEW_DEFS.map((v) => [v.id, v])
) as Record<ViewId, ViewDef>;
