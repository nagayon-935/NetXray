import { useCallback } from "react";
import ELK from "elkjs/lib/elk.bundled.js";
import { Position, type Node as FlowNode, type Edge as FlowEdge } from "@xyflow/react";

const elk = new ELK();

export type LayoutPreset = "auto" | "spine-leaf" | "layered" | "force";
type ConcretePreset = "spine-leaf" | "layered" | "force";

const NODE_WIDTH = 180;
const NODE_HEIGHT = 60;

interface ElkNode {
  id: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  layoutOptions?: Record<string, string>;
  children: ElkNode[];
}

type Tier = "spine" | "leaf" | "host";

/**
 * Classify nodes into host / leaf / spine tiers using node.type + adjacency,
 * not graph degree. Host = node.type "host". Leaf = a switch/router directly
 * connected to at least one host. Spine = a switch/router with no host
 * neighbors that connects to at least one leaf.
 *
 * Returns null when the topology isn't a host/leaf tiered fabric (no hosts,
 * or no switch/router directly touching a host) so callers can fall back to
 * unconstrained layering instead of forcing a tiered shape onto e.g. a small
 * router mesh.
 */
function classifyTiers(
  nodes: FlowNode[],
  edges: FlowEdge[],
): Map<string, Tier> | null {
  const neighbors = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!neighbors.has(e.source)) neighbors.set(e.source, new Set());
    if (!neighbors.has(e.target)) neighbors.set(e.target, new Set());
    neighbors.get(e.source)!.add(e.target);
    neighbors.get(e.target)!.add(e.source);
  }

  const isSwitchOrRouter = (n: FlowNode) => n.type === "switch" || n.type === "router";

  const hostIds = new Set(nodes.filter((n) => n.type === "host").map((n) => n.id));
  if (hostIds.size === 0) return null;

  const leafIds = new Set<string>();
  for (const n of nodes) {
    if (!isSwitchOrRouter(n)) continue;
    const neigh = neighbors.get(n.id) ?? new Set<string>();
    if ([...neigh].some((id) => hostIds.has(id))) leafIds.add(n.id);
  }
  if (leafIds.size === 0) return null;

  const tiers = new Map<string, Tier>();
  for (const id of hostIds) tiers.set(id, "host");
  for (const id of leafIds) tiers.set(id, "leaf");

  for (const n of nodes) {
    if (!isSwitchOrRouter(n) || leafIds.has(n.id)) continue;
    const neigh = neighbors.get(n.id) ?? new Set<string>();
    const touchesHost = [...neigh].some((id) => hostIds.has(id));
    const touchesLeaf = [...neigh].some((id) => leafIds.has(id));
    if (!touchesHost && touchesLeaf) tiers.set(n.id, "spine");
  }

  return tiers;
}

function presetOptions(
  preset: ConcretePreset,
  nodeCount: number,
): Record<string, string> {
  const padding = Math.max(20, Math.min(60, 20 + Math.floor(nodeCount / 4)));
  switch (preset) {
    case "spine-leaf":
      return {
        "elk.algorithm": "layered",
        "elk.direction": "DOWN",
        "elk.layered.spacing.nodeNodeBetweenLayers": "120",
        "elk.spacing.nodeNode": "80",
        "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
        "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
        "elk.padding": `[top=${padding},left=${padding},bottom=${padding},right=${padding}]`,
      };
    case "layered":
      return {
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.layered.spacing.nodeNodeBetweenLayers": "140",
        "elk.spacing.nodeNode": "70",
        "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
        "elk.padding": `[top=${padding},left=${padding},bottom=${padding},right=${padding}]`,
      };
    case "force":
      return {
        "elk.algorithm": "force",
        "elk.spacing.nodeNode": "140",
        "elk.force.iterations": "500",
        "elk.force.repulsivePower": "1",
        "elk.padding": `[top=${padding},left=${padding},bottom=${padding},right=${padding}]`,
      };
  }
}

export function useTopologyLayout() {
  const applyLayout = useCallback(
    async (
      nodes: FlowNode[],
      edges: FlowEdge[],
      preset: LayoutPreset = "auto",
    ): Promise<{ nodes: FlowNode[]; edges: FlowEdge[] }> => {
      if (nodes.length === 0) return { nodes, edges };

      const tiers =
        preset === "auto" || preset === "spine-leaf"
          ? classifyTiers(nodes, edges)
          : null;

      const effectivePreset: ConcretePreset =
        preset === "auto" ? (tiers ? "spine-leaf" : "layered") : preset;

      const elkNodeMap = new Map<string, ElkNode>();

      nodes.forEach((node) => {
        const isGroup = node.type === "group";
        const groupChildCount = isGroup
          ? nodes.filter((n) => n.parentId === node.id).length
          : 0;
        const groupPad = Math.max(20, Math.min(50, 20 + groupChildCount * 4));

        const layoutOptions: Record<string, string> = {};
        if (isGroup) {
          layoutOptions["elk.padding"] =
            `[top=${groupPad + 20},left=${groupPad},bottom=${groupPad},right=${groupPad}]`;
          layoutOptions["elk.algorithm"] = "layered";
          layoutOptions["elk.direction"] =
            effectivePreset === "layered" ? "RIGHT" : "DOWN";
          layoutOptions["elk.spacing.nodeNode"] = "40";
        } else if (tiers && effectivePreset === "spine-leaf") {
          const role = tiers.get(node.id);
          if (role === "spine") {
            layoutOptions["elk.layered.layering.layerConstraint"] = "FIRST";
          } else if (role === "host") {
            layoutOptions["elk.layered.layering.layerConstraint"] = "LAST";
          }
          // leaf: no constraint — ELK naturally places it between spine and host
        }

        const elkNode: ElkNode = {
          id: node.id,
          width: isGroup ? undefined : NODE_WIDTH,
          height: isGroup ? undefined : NODE_HEIGHT,
          layoutOptions:
            Object.keys(layoutOptions).length > 0 ? layoutOptions : undefined,
          children: [],
        };
        elkNodeMap.set(node.id, elkNode);
      });

      const rootChildren: ElkNode[] = [];
      nodes.forEach((node) => {
        const elkNode = elkNodeMap.get(node.id)!;
        if (node.parentId && elkNodeMap.has(node.parentId)) {
          elkNodeMap.get(node.parentId)!.children.push(elkNode);
        } else {
          rootChildren.push(elkNode);
        }
      });

      const elkGraph = {
        id: "root",
        layoutOptions: presetOptions(effectivePreset, nodes.length),
        children: rootChildren,
        edges: edges.map((edge) => ({
          id: edge.id,
          sources: [edge.source],
          targets: [edge.target],
        })),
      };

      const layouted = await elk.layout(elkGraph);

      const targetPosition =
        effectivePreset === "layered" ? Position.Left : Position.Top;
      const sourcePosition =
        effectivePreset === "layered" ? Position.Right : Position.Bottom;

      const positionMap = new Map<
        string,
        { x: number; y: number; width?: number; height?: number }
      >();
      const extractPositions = (elkNodes: ElkNode[]) => {
        for (const n of elkNodes) {
          positionMap.set(n.id, {
            x: n.x ?? 0,
            y: n.y ?? 0,
            width: n.width,
            height: n.height,
          });
          if (n.children && n.children.length > 0) extractPositions(n.children);
        }
      };
      extractPositions(layouted.children || []);

      const layoutedNodes = nodes.map((node) => {
        const pos = positionMap.get(node.id);
        const baseNode: FlowNode = {
          ...node,
          targetPosition,
          sourcePosition,
          position: { x: pos?.x ?? 0, y: pos?.y ?? 0 },
        };

        if (node.type === "group" && pos?.width && pos?.height) {
          baseNode.style = {
            ...node.style,
            width: pos.width,
            height: pos.height,
          };
        }

        return baseNode;
      });

      return { nodes: layoutedNodes, edges };
    },
    [],
  );

  return { applyLayout };
}
