import type { AclRule, NetXrayIR } from "../types/netxray-ir";

export interface PacketHeader {
  src_ip: string;
  dst_ip: string;
  protocol: "tcp" | "udp" | "icmp" | "any";
  src_port?: number;
  dst_port?: number;
}

// A single header layer of the packet "on the wire" at a hop.
// Ordered outer→inner so encapsulation (VXLAN/SRv6, future) nests naturally.
export type PacketLayer =
  | { kind: "ethernet"; src_mac: string | null; dst_mac: string | null }
  | { kind: "ipv4"; src: string; dst: string; role?: "outer" | "inner" }
  | { kind: "ipv6"; src: string; dst: string; role?: "outer" | "inner" }
  | { kind: "vxlan"; vni: number }
  | { kind: "srh"; segments: string[]; segments_left: number }
  | { kind: "tcp" | "udp"; src_port?: number; dst_port?: number }
  | { kind: "icmp"; message: "echo-request" | "echo-reply" };

export interface PathHop {
  node_id: string;
  ingress_interface: string | null;
  egress_interface: string | null;
  acl_result?: {
    acl_name: string;
    matched_rule: AclRule | null;
    action: "permit" | "deny" | "no-match";
  };
  /** Header stack as framed on this hop's wire (outer→inner). */
  packet_stack?: PacketLayer[];
}

export interface PacketPath {
  hops: PathHop[];
  result: "delivered" | "dropped" | "unreachable";
  drop_reason?: string;
  /** Return journey (dst→src), computed when the forward packet is delivered. */
  reply?: PacketPath;
}

export interface ShadowedRule {
  acl_name: string;
  shadowed_seq: number;
  shadowed_by_seq: number;
  reason: string;
}

export interface AclEvaluation {
  acl_name: string;
  matched_seq: number | null;
  action: "permit" | "deny" | "no-match";
}

export interface SimEngine {
  loadTopology(ir: NetXrayIR): void;
  simulatePacket(packet: PacketHeader): PacketPath;
  detectAclShadows(aclName: string): ShadowedRule[];
  evaluateAcl(aclName: string, packet: PacketHeader): AclEvaluation;
}
