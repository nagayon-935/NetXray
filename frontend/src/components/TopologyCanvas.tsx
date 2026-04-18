import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type NodeMouseHandler,
  type EdgeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { COLORS } from "../lib/colors";
import { useTopologyStore } from "../stores/topology-store";
import { useViewStore } from "../stores/view-store";
import { useWhatIfStore } from "../stores/whatif-store";
import { useTopologyLayout, type LayoutPreset } from "../hooks/useTopologyLayout";
import { loadIRFromUrl } from "../lib/ir-loader";
import { useIRLoad } from "../hooks/useIRLoad";
import { VIEW_REGISTRY, type ViewResult } from "../lib/views";
import { nodeTypes } from "./nodes/registry";
import { NetworkEdge } from "./edges/NetworkEdge";
import { BgpEdge } from "./edges/BgpEdge";
import { HeatmapEdge } from "./edges/HeatmapEdge";
import { SimToolbar } from "./toolbar/SimToolbar";
import { useTelemetryWS } from "../hooks/useTelemetryWS";
import { useLayerStore } from "../stores/layer-store";
import { NodeDetailPanel } from "./panels/NodeDetailPanel";
import { AclTablePanel } from "./panels/AclTablePanel";
import { PacketSimPanel } from "./panels/PacketSimPanel";
import { SnapshotPanel } from "./panels/SnapshotPanel";
import { WhatIfPanel } from "./panels/WhatIfPanel";
import { ConvergencePanel } from "./panels/ConvergencePanel";
import { TimelinePanel } from "./panels/TimelinePanel";
import { ConfigGenPanel } from "./panels/ConfigGenPanel";
import { DiagnosisPanel } from "./panels/DiagnosisPanel";
import { LinkDetailPanel } from "./panels/LinkDetailPanel";

const edgeTypes = {
  network: NetworkEdge,
  bgp: BgpEdge,
  heatmap: HeatmapEdge,
};

export function TopologyCanvas() {
  const ir = useTopologyStore((s) => s.ir);
  const loadIR = useTopologyStore((s) => s.loadIR);
  const selectNode = useTopologyStore((s) => s.selectNode);
  const selectLink = useTopologyStore((s) => s.selectLink);
  const activePanel = useTopologyStore((s) => s.activePanel);
  const heatmapEnabled = useLayerStore((s) => s.layers.heatmap);
  // Connect telemetry WebSocket only when an IR is loaded.
  // "default" is a placeholder topology name — the backend mock loop
  // broadcasts to all WS clients keyed by this name.
  useTelemetryWS(ir ? "default" : undefined);

  const activeViewId = useViewStore((s) => s.activeView);
  const activeView = VIEW_REGISTRY[activeViewId];

  // Derived view state (nodes/edges from IR for the current view)
  const viewResult = useMemo<ViewResult>(() => {
    if (!ir) return { nodes: [], edges: [] };
    return activeView.derive(ir);
  }, [ir, activeView]);

  // What-If state for ghost rendering
  const whatIfActive = useWhatIfStore((s) => s.isActive);
  const whatIfFailures = useWhatIfStore((s) => s.failures);
  const whatIfAffected = useWhatIfStore((s) => s.affectedNodes);

  // What-If: build sets of failed node / link IDs for styling
  const failedNodeIds = useMemo(
    () =>
      new Set(
        whatIfActive
          ? whatIfFailures.filter((f) => f.kind === "node").map((f) => f.id)
          : []
      ),
    [whatIfActive, whatIfFailures]
  );
  const failedLinkIds = useMemo(
    () =>
      new Set(
        whatIfActive
          ? whatIfFailures.filter((f) => f.kind === "link").map((f) => f.id)
          : []
      ),
    [whatIfActive, whatIfFailures]
  );

  // Apply What-If ghost styling to edges
  const styledEdges = useMemo(
    () =>
      viewResult.edges.map((e) => {
        const edge = { ...e };
        if (heatmapEnabled) {
          edge.type = "heatmap";
        }
        if (!whatIfActive) return edge;
        if (failedLinkIds.has(e.id)) {
          return {
            ...edge,
            style: {
              ...edge.style,
              stroke: COLORS.DOWN,
              strokeDasharray: "6,4",
              strokeWidth: 2,
              opacity: 0.5,
            },
            animated: false,
          };
        }
        return edge;
      }),
    [viewResult.edges, whatIfActive, failedLinkIds, heatmapEnabled]
  );

  // Apply What-If ghost styling to nodes: failed=red ghost, affected=orange tint
  const styledNodes = useMemo(
    () =>
      viewResult.nodes.map((n) => {
        if (!whatIfActive) return n;
        if (failedNodeIds.has(n.id)) {
          return {
            ...n,
            style: {
              ...n.style,
              opacity: 0.35,
              filter: "grayscale(60%) sepia(30%)",
              outline: `2px dashed ${COLORS.DOWN}`,
              outlineOffset: "2px",
              borderRadius: "6px",
            },
          };
        }
        if (whatIfAffected.has(n.id)) {
          return {
            ...n,
            style: {
              ...n.style,
              outline: "2px solid #f97316",
              outlineOffset: "2px",
              borderRadius: "6px",
            },
          };
        }
        return n;
      }),
    [viewResult.nodes, whatIfActive, failedNodeIds, whatIfAffected]
  );

  const [nodes, setNodes, onNodesChangeState] = useNodesState(styledNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(styledEdges);
  const { applyLayout } = useTopologyLayout();
  const layoutApplied = useRef(false);
  const prevViewId = useRef(activeViewId);
  const updateNodePositions = useTopologyStore((s) => s.updateNodePositions);

  const onNodesChange = onNodesChangeState;

  const onNodeDragStop: NodeMouseHandler = useCallback(
    (_event, _draggedNode) => {
      const { nodePositions } = useTopologyStore.getState();
      const nextPositions = { ...nodePositions };
      
      const getAbsPos = (nodeId: string): { x: number; y: number } => {
        const n = nodes.find(curr => curr.id === nodeId);
        if (!n) return { x: 0, y: 0 };
        if (!n.parentId) return n.position;
        const parentPos = getAbsPos(n.parentId);
        return { x: parentPos.x + n.position.x, y: parentPos.y + n.position.y };
      };

      nodes.forEach(n => {
        const abs = getAbsPos(n.id);
        nextPositions[n.id] = {
          x: abs.x,
          y: abs.y,
          width: n.measured?.width || (n.style?.width as number) || 180,
          height: n.measured?.height || (n.style?.height as number) || 60
        };
      });
      
      useTopologyStore.setState({ nodePositions: nextPositions });
    },
    [nodes]
  );

  // Sync nodes and edges into ReactFlow state when derived view or What-If changes
  useEffect(() => {
    const { nodePositions, updateNodePositions } = useTopologyStore.getState();

    if (prevViewId.current !== activeViewId) {
      prevViewId.current = activeViewId;
    }

    if (styledNodes.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }

    if (!layoutApplied.current) {
      applyLayout(styledNodes, styledEdges, "spine-leaf").then(({ nodes: laid }) => {
        setNodes(laid);
        setEdges(styledEdges);
        layoutApplied.current = true;
        updateNodePositions(laid);
      });
      return;
    }

    const mergedNodes = styledNodes.map((sn) => {
      const stored = nodePositions[sn.id];
      if (stored) {
        return {
          ...sn,
          position: { x: stored.x, y: stored.y },
          style: {
            ...sn.style,
            width: sn.type === "group" ? (stored.width ?? sn.style?.width) : sn.style?.width,
            height: sn.type === "group" ? (stored.height ?? sn.style?.height) : sn.style?.height,
          },
        };
      }
      return sn;
    });

    const finalNodes = [...mergedNodes];
    
    finalNodes.forEach((n) => {
      if (n.type === "group" && !nodePositions[n.id]) {
        const children = finalNodes.filter((child) => child.parentId === n.id);
        const childPos = children.map((c) => nodePositions[c.id]).filter(Boolean);
        if (childPos.length > 0) {
          const minX = Math.min(...childPos.map((p) => p!.x));
          const minY = Math.min(...childPos.map((p) => p!.y));
          const maxX = Math.max(...childPos.map((p) => p!.x + (p!.width || 180)));
          const maxY = Math.max(...childPos.map((p) => p!.y + (p!.height || 60)));
          const padding = 40;
          n.position = { x: minX - padding, y: minY - padding };
          n.style = { 
            ...n.style, 
            width: (maxX - minX) + padding * 2, 
            height: (maxY - minY) + padding * 2 
          };
        }
      }
    });

    finalNodes.forEach((n) => {
      if (n.parentId) {
        const parent = finalNodes.find((p) => p.id === n.parentId);
        const stored = nodePositions[n.id];
        if (parent && stored) {
          n.position = {
            x: stored.x - parent.position.x,
            y: stored.y - parent.position.y,
          };
        }
      }
    });

    setNodes(finalNodes);
    setEdges(styledEdges);
  }, [styledNodes, styledEdges, activeViewId]);

  const handleLayoutChange = useCallback(
    (preset: LayoutPreset) => {
      applyLayout(styledNodes, styledEdges, preset).then(({ nodes: laid }) => {
        setNodes(laid);
        updateNodePositions(laid);
      });
    },
    [styledNodes, styledEdges, applyLayout, setNodes, updateNodePositions]
  );

  const handleLoadSample = useCallback(
    async (name: string) => {
      const ir = await loadIRFromUrl(`/sample-topologies/${name}.json`);
      loadIR(ir);
      layoutApplied.current = false;
    },
    [loadIR]
  );

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      selectNode(node.id);
    },
    [selectNode]
  );

  const onEdgeClick: EdgeMouseHandler = useCallback(
    (_event, edge) => {
      if (edge.type === "network" || edge.type === "heatmap" || edge.type === "default") {
        const linkId = edge.id.replace(/^(l\d+-)?phy-/, "");
        selectLink(linkId);
      }
    },
    [selectLink]
  );

  const onPaneClick = useCallback(() => {
    selectNode(null);
    selectLink(null);
  }, [selectNode, selectLink]);

  const onIRLoad = useCallback(() => {
    layoutApplied.current = false;
  }, []);
  const { handleFile } = useIRLoad(onIRLoad);

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) await handleFile(file);
    },
    [handleFile]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  return (
    <div className="flex flex-col h-full">
      <SimToolbar onLayoutChange={handleLayoutChange} onLoadSample={handleLoadSample} />
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 relative" onDrop={onDrop} onDragOver={onDragOver}>
          {!ir && (
            <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
              <div className="text-center text-slate-400 pointer-events-auto">
                <div className="text-4xl mb-2">&#128752;</div>
                <div className="text-lg font-semibold">NetXray</div>
                <div className="text-sm mt-1">
                  Load a sample topology or drag &amp; drop an IR JSON file
                </div>
                <div className="text-xs mt-2 text-slate-300">
                  Supports IR v0.1 and v0.2 (BGP · SRv6 · EVPN)
                </div>
              </div>
            </div>
          )}
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            onNodeDragStop={onNodeDragStop}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            minZoom={0.1}
            maxZoom={3}
            defaultEdgeOptions={{ type: "network" }}
          >
            <Background gap={20} size={1} color="#e2e8f0" />
            <Controls position="bottom-left" />
            <MiniMap
              position="bottom-right"
              nodeColor={(n) => {
                switch (n.type) {
                  case "router": return COLORS.PATH;
                  case "switch": return COLORS.UP;
                  case "host": return "#8b5cf6";
                  default: return COLORS.NEUTRAL;
                }
              }}
            />
          </ReactFlow>
        </div>

        {/* Side panels — only one shown at a time */}
        {activePanel === "detail" && <NodeDetailPanel />}
        {activePanel === "link-detail" && <LinkDetailPanel />}
        {activePanel === "acl" && <AclTablePanel />}
        {activePanel === "packet" && <PacketSimPanel />}
        {activePanel === "snapshot" && <SnapshotPanel />}
        {activePanel === "whatif" && <WhatIfPanel />}
        {activePanel === "convergence" && <ConvergencePanel />}
        {activePanel === "timeline" && <TimelinePanel />}
        {activePanel === "config" && (
          <div className="w-96 border-l bg-white shadow-xl flex flex-col">
            <ConfigGenPanel selectedNodeId={useTopologyStore.getState().selectedNodeId} />
          </div>
        )}
        {activePanel === "diagnosis" && (
          <div className="w-96 border-l bg-white shadow-xl flex flex-col">
            <DiagnosisPanel />
          </div>
        )}
      </div>
    </div>
  );
}
