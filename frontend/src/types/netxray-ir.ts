// NetXray-IR TypeScript types — generated from JSON Schema v0.2.0
// All v0.2+ fields (bgp, srv6, evpn) are optional; v0.1.0 files remain valid.

export interface NetXrayIR {
  ir_version: string;
  topology: Topology;
  policies?: Policies;
}

export interface Topology {
  nodes: Node[];
  links: Link[];
}

export interface Node {
  id: string;
  type: "router" | "switch" | "host";
  vendor?: "frr" | "arista" | "generic";
  hostname?: string;
  interfaces?: Record<string, Interface>;
  vrfs?: Record<string, Vrf>;
  // v0.2+ optional extension blocks
  bgp?: BgpConfig;
  srv6?: Srv6Config;
  evpn?: EvpnConfig;
  [key: string]: unknown; // forward-compatible unknown fields
}

export interface Interface {
  ip?: string;
  state: "up" | "down";
  cost?: number;
  acl_in?: string | null;
  acl_out?: string | null;
  [key: string]: unknown;
}

export interface Vrf {
  routing_table?: Route[];
}

export interface Route {
  prefix: string;
  next_hop: string | null;
  protocol: "bgp" | "ospf" | "connected" | "static";
  metric?: number;
  via_interface?: string;
}

export interface Link {
  id: string;
  source: LinkEndpoint;
  target: LinkEndpoint;
  state: "up" | "down";
}

export interface LinkEndpoint {
  node: string;
  interface: string;
}

export interface Policies {
  acls?: Record<string, AclRule[]>;
}

export interface AclRule {
  seq: number;
  action: "permit" | "deny";
  protocol: "tcp" | "udp" | "icmp" | "any";
  src: string;
  dst: string;
  src_port?: number | null;
  dst_port?: number | null;
}

// ─── v0.2+ BGP ───────────────────────────────────────────────────────────────

export interface BgpConfig {
  local_as: number;
  router_id: string;
  sessions?: BgpSession[];
}

export type BgpSessionState =
  | "established"
  | "idle"
  | "connect"
  | "active"
  | "opensent"
  | "openconfirm"
  | "unknown";

export type BgpRole =
  | "provider"
  | "customer"
  | "rs"
  | "rs-client"
  | "peer"
  | "undefined"
  | null;

export interface BgpSession {
  peer_ip: string;
  peer_node?: string | null;
  remote_as: number;
  state: BgpSessionState;
  address_families?: string[];
  role?: BgpRole;
}

// ─── v0.2+ SRv6 ──────────────────────────────────────────────────────────────

export interface Srv6Config {
  locator: string;
  sids?: Srv6Sid[];
}

export interface Srv6Sid {
  sid: string;
  function: string;
  vrf?: string | null;
}

// ─── v0.2+ EVPN/VXLAN ────────────────────────────────────────────────────────

export interface EvpnConfig {
  vtep_ip?: string | null;
  vnis?: Vni[];
}

export interface Vni {
  vni: number;
  type: "L2" | "L3";
  vlan?: number | null;
  rd?: string | null;
  rt_import?: string[];
  rt_export?: string[];
}
