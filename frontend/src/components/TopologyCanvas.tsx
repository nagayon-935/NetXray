import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

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

const edgeTypes = {
  network: NetworkEdge,
  bgp: BgpEdge,
  heatmap: HeatmapEdge,
};

export function TopologyCanvas() {
  const ir = useTopologyStore((s) => s.ir);
  const loadIR = useTopologyStore((s) => s.loadIR);
  const selectNode = useTopologyStore((s) => s.selectNode);
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
              stroke: "#ef4444",
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
              outline: "2px dashed #ef4444",
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

  const [nodes, setNodes, onNodesChange] = useNodesState(styledNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(styledEdges);
  const { applyLayout } = useTopologyLayout();
  const layoutApplied = useRef(false);

  const onIRLoad = useCallback(() => {
    layoutApplied.current = false;
  }, []);
  const { handleFile } = useIRLoad(onIRLoad);

  // Sync nodes and edges into ReactFlow state when derived view or What-If changes
  useEffect(() => {
    // If view pre-computes positions (needsLayout: false), just set them
    if (!activeView.needsLayout) {
      setNodes(styledNodes);
      setEdges(styledEdges);
      layoutApplied.current = true;
      return;
    }

    // Otherwise (Physical view), apply ELK layout if needed
    if (styledNodes.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }

    // Re-layout if IR changed or node count changed or we specifically want a fresh layout
    if (!layoutApplied.current || styledNodes.length !== nodes.length) {
      applyLayout(styledNodes, styledEdges, "spine-leaf").then(({ nodes: laid }) => {
        setNodes(laid);
        setEdges(styledEdges);
        layoutApplied.current = true;
      });
    } else {
      // Just update styles (What-If) without full relayout if node structure is same
      setNodes((prev) =>
        prev.map((n) => {
          const styled = styledNodes.find((s) => s.id === n.id);
          return styled ? { ...n, style: styled.style, data: styled.data } : n;
        })
      );
      setEdges(styledEdges);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styledNodes, styledEdges, activeView.needsLayout]);

  const handleLayoutChange = useCallback(
    (preset: LayoutPreset) => {
      applyLayout(styledNodes, styledEdges, preset).then(({ nodes: laid }) => {
        setNodes(laid);
      });
    },
    [styledNodes, styledEdges, applyLayout, setNodes]
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

  const onPaneClick = useCallback(() => {
    selectNode(null);
  }, [selectNode]);

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
            onPaneClick={onPaneClick}
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
                  case "router": return "#3b82f6";
                  case "switch": return "#10b981";
                  case "host": return "#8b5cf6";
                  default: return "#94a3b8";
                }
              }}
            />
          </ReactFlow>
        </div>

        {/* Side panels — only one shown at a time */}
        {activePanel === "detail" && <NodeDetailPanel />}
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
