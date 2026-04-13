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

export interface SimEngine {
  loadTopology(ir: NetXrayIR): void;
  simulatePacket(packet: PacketHeader): PacketPath;
  simulateLinkFailure(linkId: string): RoutingUpdate;
  detectAclShadows(aclName: string): ShadowedRule[];
}
