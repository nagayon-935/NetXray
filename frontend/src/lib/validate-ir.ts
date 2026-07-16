import type { NetXrayIR } from "../types/netxray-ir";

export type Severity = "error" | "warning";

export interface ValidationIssue {
  severity: Severity;
  message: string;
}

/**
 * Static sanity checks run before saving / deploying a topology.
 * Errors indicate a broken topology; warnings are likely mistakes.
 */
export function validateIR(ir: NetXrayIR): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nodes = ir.topology.nodes;
  const links = ir.topology.links;

  // Duplicate node IDs
  const seenIds = new Set<string>();
  for (const n of nodes) {
    if (seenIds.has(n.id)) {
      issues.push({ severity: "error", message: `Duplicate node id "${n.id}"` });
    }
    seenIds.add(n.id);
  }

  // Duplicate IP addresses across all interfaces
  const ipOwners = new Map<string, string[]>();
  for (const n of nodes) {
    for (const [ifaceName, iface] of Object.entries(n.interfaces ?? {})) {
      if (!iface.ip) continue;
      const where = `${n.id}/${ifaceName}`;
      const owners = ipOwners.get(iface.ip) ?? [];
      owners.push(where);
      ipOwners.set(iface.ip, owners);
    }
  }
  for (const [ip, owners] of ipOwners) {
    if (owners.length > 1) {
      issues.push({ severity: "error", message: `Duplicate IP ${ip} on ${owners.join(", ")}` });
    }
  }

  // Links referencing missing nodes / interfaces
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  for (const l of links) {
    for (const endpoint of [l.source, l.target]) {
      const node = nodeById.get(endpoint.node);
      if (!node) {
        issues.push({
          severity: "error",
          message: `Link ${l.id} references missing node "${endpoint.node}"`,
        });
        continue;
      }
      if (!node.interfaces?.[endpoint.interface]) {
        issues.push({
          severity: "error",
          message: `Link ${l.id} references missing interface "${endpoint.node}/${endpoint.interface}"`,
        });
      }
    }
  }

  // Interfaces used by a link but with no IP (warning)
  const linkedIfaces = new Set<string>();
  for (const l of links) {
    linkedIfaces.add(`${l.source.node}/${l.source.interface}`);
    linkedIfaces.add(`${l.target.node}/${l.target.interface}`);
  }
  for (const n of nodes) {
    for (const [ifaceName, iface] of Object.entries(n.interfaces ?? {})) {
      if (linkedIfaces.has(`${n.id}/${ifaceName}`) && !iface.ip) {
        issues.push({
          severity: "warning",
          message: `Interface ${n.id}/${ifaceName} has no IP address`,
        });
      }
    }
  }

  return issues;
}
