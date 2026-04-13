import type { AclRule, NetXrayIR } from "../types/netxray-ir";

export interface PacketHeader {
  src_ip: string;
  dst_ip: string;
  protocol: "tcp" | "udp" | "icmp" | "any";
  src_port?: number;
  dst_port?: number;
}

export interface PathHop {
  node_id: string;
  ingress_interface: string | null;
  egress_interface: string | null;
  acl_result?: {
    acl_name: string;
    matched_rule: AclRule | null;
    action: "permit" | "deny" | "no-match";
  };
}

export interface PacketPath {
  hops: PathHop[];
  result: "delivered" | "dropped" | "unreachable";
  drop_reason?: string;
}

export interface RoutingUpdate {
  affected_nodes: string[];
  updated_paths: Record<string, { prefix: string; new_next_hop: string | null }[]>;
}

export interface ShadowedRule {
  acl_name: string;
  shadowed_seq: number;
  shadowed_by_seq: number;
  reason: string;
}

// ── What-If Analysis types ──────────────────────────────────────────────────

/** Describes a single failure element: a link or a node going down. */
export type FailureSpec =
  | { kind: "link"; id: string }
  | { kind: "node"; id: string };

/** Per-node path change when failures are applied. */
export interface PathChange {
  /** The destination prefix. */
  prefix: string;
  /** Next-hop before the failure (null = directly connected / no route). */
  before: string | null;
  /** Next-hop after the failure (null = no route / black-hole). */
  after: string | null;
}

export interface ConvergenceStep {
  /** Discrete tick number (0 = initial failure instant). */
  tick: number;
  /** Routing updates that happened at this tick. */
  updates: RoutingUpdate;
  /** Node IDs whose routing tables have stabilised by this tick. */
  stableNodes: string[];
  /** Fraction of nodes that are stable: 0.0–1.0. */
  totalStableRatio: number;
}

export interface SimEngine {
  loadTopology(ir: NetXrayIR): void;
  simulatePacket(packet: PacketHeader): PacketPath;
  simulateLinkFailure(linkId: string): RoutingUpdate;
  detectAclShadows(aclName: string): ShadowedRule[];

  // What-If API (Phase 5)
  simulateNodeFailure(nodeId: string): RoutingUpdate;
  simulateMultiFailure(failures: FailureSpec[]): RoutingUpdate;
  computeAlternatePaths(
    srcNodeId: string,
    dstNodeId: string,
    failures: FailureSpec[],
  ): PacketPath[];
  simulateConvergence(failures: FailureSpec[]): ConvergenceStep[];
}
