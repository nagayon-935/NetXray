import { useCallback } from "react";
import ELK from "elkjs/lib/elk.bundled.js";
import type { Node as FlowNode, Edge as FlowEdge } from "@xyflow/react";

const elk = new ELK();

export type LayoutPreset = "spine-leaf" | "layered" | "force";

const presetOptions: Record<LayoutPreset, Record<string, string>> = {
  "spine-leaf": {
    "elk.algorithm": "layered",
    "elk.direction": "DOWN",
    "elk.layered.spacing.nodeNodeBetweenLayers": "100",
    "elk.spacing.nodeNode": "80",
    "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
  },
  layered: {
    "elk.algorithm": "layered",
    "elk.direction": "RIGHT",
    "elk.layered.spacing.nodeNodeBetweenLayers": "120",
    "elk.spacing.nodeNode": "60",
  },
  force: {
    "elk.algorithm": "force",
    "elk.spacing.nodeNode": "120",
    "elk.force.iterations": "300",
  },
};

const NODE_WIDTH = 180;
const NODE_HEIGHT = 60;

export function useTopologyLayout() {
  const applyLayout = useCallback(
    async (
      nodes: FlowNode[],
      edges: FlowEdge[],
      preset: LayoutPreset = "spine-leaf"
    ): Promise<{ nodes: FlowNode[]; edges: FlowEdge[] }> => {
      if (nodes.length === 0) return { nodes, edges };

      const elkGraph = {
        id: "root",
        layoutOptions: presetOptions[preset],
        children: nodes.map((node) => ({
          id: node.id,
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
        })),
        edges: edges.map((edge) => ({
          id: edge.id,
          sources: [edge.source],
          targets: [edge.target],
        })),
      };

      const layouted = await elk.layout(elkGraph);

      const layoutedNodes = nodes.map((node) => {
        const elkNode = layouted.children?.find((n) => n.id === node.id);
        return {
          ...node,
          position: {
            x: elkNode?.x ?? 0,
            y: elkNode?.y ?? 0,
          },
        };
      });

      return { nodes: layoutedNodes, edges };
    },
    []
  );

  return { applyLayout };
}
