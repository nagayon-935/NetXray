import type { Edge as FlowEdge } from "@xyflow/react";
import type { NetXrayIR, BgpSession } from "../types/netxray-ir";

// BGP role complement table (RFC 9234)
const ROLE_COMPLEMENT: Record<string, string> = {
  provider: "customer",
  customer: "provider",
  rs: "rs-client",
  "rs-client": "rs",
  peer: "peer",
};

export interface BgpRoleMismatch {
  sourceNode: string;
  targetNode: string;
  sourceRole: string;
  expectedTargetRole: string;
  actualTargetRole: string;
}

/**
 * Derive ReactFlow edges representing BGP sessions from the IR.
 * Only includes sessions where peer_node is known.
 * Deduplicates bidirectional sessions (A↔B produces a single edge).
 */
export function deriveBgpEdges(ir: NetXrayIR): FlowEdge[] {
  const edges: FlowEdge[] = [];
  const seen = new Set<string>();

  for (const node of ir.topology.nodes) {
    const bgp = node.bgp;
    if (!bgp?.sessions) continue;

    for (const session of bgp.sessions) {
      const peerNodeId = session.peer_node;
      if (!peerNodeId) continue;

      // Deduplicate: sort node IDs so A↔B and B↔A use the same key
      const edgeKey = [node.id, peerNodeId].sort().join("~~");
      if (seen.has(edgeKey)) continue;
      seen.add(edgeKey);

      const isEstablished = session.state === "established";
      const stateColor = isEstablished ? "#10b981" : "#f59e0b";

      edges.push({
        id: `bgp-${edgeKey}`,
        source: node.id,
        target: peerNodeId,
        type: "bgp",
        animated: isEstablished,
        data: {
          sourceAs: bgp.local_as,
          targetAs: session.remote_as,
          state: session.state,
          sourceRole: session.role ?? null,
        },
        style: {
          stroke: stateColor,
          strokeWidth: 2,
          strokeDasharray: isEstablished ? undefined : "8,4",
        },
      });
    }
  }

  return edges;
}

/**
 * Detect BGP role mismatches across all session pairs.
 * Returns one mismatch per ordered pair that violates RFC 9234 complementarity.
 */
export function detectBgpRoleMismatches(ir: NetXrayIR): BgpRoleMismatch[] {
  // Build per-node session map
  const sessionMap = new Map<string, BgpSession[]>();
  for (const node of ir.topology.nodes) {
    if (node.bgp?.sessions?.length) {
      sessionMap.set(node.id, node.bgp.sessions);
    }
  }

  const mismatches: BgpRoleMismatch[] = [];
  const checked = new Set<string>();

  for (const [nodeId, sessions] of sessionMap) {
    for (const session of sessions) {
      const peerNodeId = session.peer_node;
      if (!peerNodeId) continue;

      const pairKey = [nodeId, peerNodeId].sort().join("~~");
      if (checked.has(pairKey)) continue;
      checked.add(pairKey);

      const peerSessions = sessionMap.get(peerNodeId);
      if (!peerSessions) continue;

      const reverseSession = peerSessions.find((s) => s.peer_node === nodeId);
      if (!reverseSession) continue;

      const myRole = session.role;
      const peerRole = reverseSession.role;

      // Only check eBGP sessions where both roles are explicitly set (non-null, non-"undefined")
      if (!myRole || !peerRole || myRole === "undefined" || peerRole === "undefined") continue;

      const expectedPeerRole = ROLE_COMPLEMENT[myRole];
      if (expectedPeerRole && expectedPeerRole !== peerRole) {
        mismatches.push({
          sourceNode: nodeId,
          targetNode: peerNodeId,
          sourceRole: myRole,
          expectedTargetRole: expectedPeerRole,
          actualTargetRole: peerRole as string,
        });
      }
    }
  }

  return mismatches;
}

/**
 * Look up which node owns a given IP address.
 * Used to resolve peer_ip → node ID when peer_node is not specified.
 */
export function resolveIpToNode(ir: NetXrayIR, ip: string): string | null {
  const bare = ip.split("/")[0];
  for (const node of ir.topology.nodes) {
    if (!node.interfaces) continue;
    for (const iface of Object.values(node.interfaces)) {
      if (!iface.ip) continue;
      if (iface.ip.split("/")[0] === bare) return node.id;
    }
  }
  return null;
}
