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
import { useLayerStore } from "../stores/layer-store";
import { useTopologyLayout, type LayoutPreset } from "../hooks/useTopologyLayout";
import { loadIRFromUrl } from "../lib/ir-loader";
import { useIRLoad } from "../hooks/useIRLoad";
import { deriveBgpEdges } from "../lib/bgp-overlay";
import { nodeTypes } from "./nodes/registry";
import { NetworkEdge } from "./edges/NetworkEdge";
import { BgpEdge } from "./edges/BgpEdge";
import { SimToolbar } from "./toolbar/SimToolbar";
import { NodeDetailPanel } from "./panels/NodeDetailPanel";
import { AclTablePanel } from "./panels/AclTablePanel";
import { PacketSimPanel } from "./panels/PacketSimPanel";
import { SnapshotPanel } from "./panels/SnapshotPanel";

const edgeTypes = {
  network: NetworkEdge,
  bgp: BgpEdge,
};

export function TopologyCanvas() {
  const ir = useTopologyStore((s) => s.ir);
  const storeNodes = useTopologyStore((s) => s.flowNodes);
  const storeEdges = useTopologyStore((s) => s.flowEdges);
  const loadIR = useTopologyStore((s) => s.loadIR);
  const selectNode = useTopologyStore((s) => s.selectNode);
  const activePanel = useTopologyStore((s) => s.activePanel);

  const bgpVisible = useLayerStore((s) => s.layers.bgp);

  // Compute BGP overlay edges from IR whenever the layer is toggled or IR changes
  const bgpEdges = useMemo(() => {
    if (!ir || !bgpVisible) return [];
    return deriveBgpEdges(ir);
  }, [ir, bgpVisible]);

  // Combined edge list: physical edges from store + optional BGP overlay
  const combinedEdges = useMemo(
    () => [...storeEdges, ...bgpEdges],
    [storeEdges, bgpEdges]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(storeNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(combinedEdges);
  const { applyLayout } = useTopologyLayout();
  const layoutApplied = useRef(false);

  const onIRLoad = useCallback(() => {
    layoutApplied.current = false;
  }, []);
  const { handleFile } = useIRLoad(onIRLoad);

  // Sync combined edges into ReactFlow state (physical + BGP overlay)
  useEffect(() => {
    setEdges(combinedEdges);
  }, [combinedEdges, setEdges]);

  // Apply layout only when nodes change (not on edge-only updates)
  useEffect(() => {
    if (storeNodes.length === 0) return;
    if (layoutApplied.current && storeNodes.length === nodes.length) return;

    applyLayout(storeNodes, storeEdges, "spine-leaf").then(({ nodes: laid }) => {
      setNodes(laid);
      layoutApplied.current = true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- layout depends only on node list changes
  }, [storeNodes, applyLayout, setNodes]);

  const handleLayoutChange = useCallback(
    (preset: LayoutPreset) => {
      applyLayout(storeNodes, storeEdges, preset).then(({ nodes: laid }) => {
        setNodes(laid);
      });
    },
    [storeNodes, storeEdges, applyLayout, setNodes]
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
      </div>
    </div>
  );
}
