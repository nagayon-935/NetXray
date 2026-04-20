import { useCallback } from "react";
import ELK from "elkjs/lib/elk.bundled.js";
import { Position, type Node as FlowNode, type Edge as FlowEdge } from "@xyflow/react";

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

      interface ElkNode {
        id: string;
        width?: number;
        height?: number;
        x?: number;
        y?: number;
        layoutOptions?: Record<string, string>;
        children: ElkNode[];
      }

      const elkNodeMap = new Map<string, ElkNode>();
      const rootChildren: ElkNode[] = [];

      nodes.forEach((node) => {
        const isGroup = node.type === "group";
        const elkNode: ElkNode = {
          id: node.id,
          width: isGroup ? undefined : NODE_WIDTH,
          height: isGroup ? undefined : NODE_HEIGHT,
          layoutOptions: isGroup
            ? { "elk.padding": "[top=40,left=20,bottom=20,right=20]" }
            : undefined,
          children: [],
        };
        elkNodeMap.set(node.id, elkNode);
      });

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
        layoutOptions: presetOptions[preset],
        children: rootChildren,
        edges: edges.map((edge) => ({
          id: edge.id,
          sources: [edge.source],
          targets: [edge.target],
        })),
      };

      const layouted = await elk.layout(elkGraph);

      let targetPosition = Position.Top;
      let sourcePosition = Position.Bottom;
      if (preset === "layered") {
        targetPosition = Position.Left;
        sourcePosition = Position.Right;
      } else if (preset === "force") {
        targetPosition = Position.Top;
        sourcePosition = Position.Bottom;
      }

      // Helper to find node positions recursively from layouted graph
      const positionMap = new Map<string, { x: number; y: number; width?: number; height?: number }>();
      const extractPositions = (elkNodes: ElkNode[]) => {
        for (const n of elkNodes) {
          positionMap.set(n.id, { x: n.x ?? 0, y: n.y ?? 0, width: n.width, height: n.height });
          if (n.children && n.children.length > 0) {
            extractPositions(n.children);
          }
        }
      };
      extractPositions(layouted.children || []);

      const layoutedNodes = nodes.map((node) => {
        const pos = positionMap.get(node.id);
        const baseNode = {
          ...node,
          targetPosition,
          sourcePosition,
          position: {
            x: pos?.x ?? 0,
            y: pos?.y ?? 0,
          },
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
    []
  );

  return { applyLayout };
}
