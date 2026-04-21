import { useCallback } from "react";
import ELK from "elkjs/lib/elk.bundled.js";
import { Position, type Node as FlowNode, type Edge as FlowEdge } from "@xyflow/react";

const elk = new ELK();

export type LayoutPreset = "spine-leaf" | "layered" | "force";

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

/**
 * Classify nodes into spine / leaf buckets by degree on the physical graph.
 * Spine = high-degree aggregators (top layer).
 * Leaf  = endpoints connected to at most one aggregator (bottom layer).
 * Everything else is left to ELK's default layering.
 */
function classifySpineLeaf(
  nodes: FlowNode[],
  edges: FlowEdge[],
): Map<string, "spine" | "leaf"> {
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }

  const leafNodeIds = new Set<string>();
  for (const n of nodes) {
    if (n.type === "group") continue;
    if ((degree.get(n.id) ?? 0) <= 1) leafNodeIds.add(n.id);
  }

  // Only call something a "spine" if it connects to multiple leaves *and*
  // has degree >= 3. Otherwise two routers connected back-to-back would be
  // misclassified.
  const classification = new Map<string, "spine" | "leaf">();
  for (const n of nodes) {
    if (n.type === "group") continue;
    const deg = degree.get(n.id) ?? 0;
    if (leafNodeIds.has(n.id)) {
      classification.set(n.id, "leaf");
      continue;
    }
    if (deg >= 3) {
      const leafNeighbors = edges.filter(
        (e) =>
          (e.source === n.id && leafNodeIds.has(e.target)) ||
          (e.target === n.id && leafNodeIds.has(e.source)),
      ).length;
      if (leafNeighbors >= 2) classification.set(n.id, "spine");
    }
  }
  return classification;
}

function presetOptions(
  preset: LayoutPreset,
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
      preset: LayoutPreset = "spine-leaf",
    ): Promise<{ nodes: FlowNode[]; edges: FlowEdge[] }> => {
      if (nodes.length === 0) return { nodes, edges };

      const spineLeaf =
        preset === "spine-leaf" ? classifySpineLeaf(nodes, edges) : null;

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
            preset === "layered" ? "RIGHT" : "DOWN";
          layoutOptions["elk.spacing.nodeNode"] = "40";
        } else if (spineLeaf) {
          const role = spineLeaf.get(node.id);
          if (role === "spine") {
            layoutOptions["elk.layered.layering.layerConstraint"] = "FIRST";
          } else if (role === "leaf") {
            layoutOptions["elk.layered.layering.layerConstraint"] = "LAST";
          }
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
        layoutOptions: presetOptions(preset, nodes.length),
        children: rootChildren,
        edges: edges.map((edge) => ({
          id: edge.id,
          sources: [edge.source],
          targets: [edge.target],
        })),
      };

      const layouted = await elk.layout(elkGraph);

      const targetPosition =
        preset === "layered" ? Position.Left : Position.Top;
      const sourcePosition =
        preset === "layered" ? Position.Right : Position.Bottom;

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
