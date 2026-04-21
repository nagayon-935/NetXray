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
  type OnConnect,
  addEdge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { COLORS } from "../lib/colors";
import { useTopologyStore } from "../stores/topology-store";
import { useViewStore } from "../stores/view-store";
import { useTopologyLayout, type LayoutPreset } from "../hooks/useTopologyLayout";
import { loadIRFromUrl } from "../lib/ir-loader";
import { useIRLoad } from "../hooks/useIRLoad";
import { VIEW_REGISTRY, type ViewResult } from "../lib/views";
import { nodeTypes } from "./nodes/registry";
import { NetworkEdge } from "./edges/NetworkEdge";
import { BgpEdge } from "./edges/BgpEdge";
import { SimToolbar } from "./toolbar/SimToolbar";
import { EditToolbar } from "./toolbar/EditToolbar";
import { NodeDetailPanel } from "./panels/NodeDetailPanel";
import { NodeEditPanel } from "./panels/NodeEditPanel";
import { AclTablePanel } from "./panels/AclTablePanel";
import { PacketSimPanel } from "./panels/PacketSimPanel";
import { LinkDetailPanel } from "./panels/LinkDetailPanel";
import { LabControlPanel } from "./panels/LabControlPanel";

const edgeTypes = {
  network: NetworkEdge,
  bgp: BgpEdge,
};

export function TopologyCanvas() {
  const ir = useTopologyStore((s) => s.ir);
  const loadIR = useTopologyStore((s) => s.loadIR);
  const selectNode = useTopologyStore((s) => s.selectNode);
  const selectLink = useTopologyStore((s) => s.selectLink);
  const activePanel = useTopologyStore((s) => s.activePanel);
  const editMode = useTopologyStore((s) => s.editMode);
  const addNode = useTopologyStore((s) => s.addNode);
  const addLink = useTopologyStore((s) => s.addLink);
  const deleteNode = useTopologyStore((s) => s.deleteNode);
  const deleteLink = useTopologyStore((s) => s.deleteLink);
  const selectedNodeId = useTopologyStore((s) => s.selectedNodeId);
  const selectedLinkId = useTopologyStore((s) => s.selectedLinkId);

  const activeViewId = useViewStore((s) => s.activeView);
  const activeView = VIEW_REGISTRY[activeViewId];

  const viewResult = useMemo<ViewResult>(() => {
    if (!ir) return { nodes: [], edges: [] };
    return activeView.derive(ir);
  }, [ir, activeView]);

  const styledNodes = viewResult.nodes;
  const styledEdges = viewResult.edges;

  const [nodes, setNodes, onNodesChangeState] = useNodesState(styledNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(styledEdges);
  const { applyLayout } = useTopologyLayout();
  const layoutApplied = useRef(false);
  const prevViewId = useRef(activeViewId);
  const updateNodePositions = useTopologyStore((s) => s.updateNodePositions);

  const onNodesChange = onNodesChangeState;

  const onNodeDragStop: NodeMouseHandler = useCallback(
    (...[, ]) => {
      const { nodePositions } = useTopologyStore.getState();
      const nextPositions = { ...nodePositions };

      const getAbsPos = (nodeId: string): { x: number; y: number } => {
        const n = nodes.find((curr) => curr.id === nodeId);
        if (!n) return { x: 0, y: 0 };
        if (!n.parentId) return n.position;
        const parentPos = getAbsPos(n.parentId);
        return { x: parentPos.x + n.position.x, y: parentPos.y + n.position.y };
      };

      nodes.forEach((n) => {
        const abs = getAbsPos(n.id);
        nextPositions[n.id] = {
          x: abs.x,
          y: abs.y,
          width: n.measured?.width || (n.style?.width as number) || 180,
          height: n.measured?.height || (n.style?.height as number) || 60,
        };
      });

      useTopologyStore.setState({ nodePositions: nextPositions });
    },
    [nodes]
  );

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
      const hasSavedPositions =
        Object.keys(nodePositions).length > 0 &&
        styledNodes.every((n) => nodePositions[n.id]);
      if (hasSavedPositions) {
        layoutApplied.current = true;
        // fall through to merge-with-stored-positions branch below
      } else {
        applyLayout(styledNodes, styledEdges, "spine-leaf").then(({ nodes: laid }) => {
          setNodes(laid);
          setEdges(styledEdges);
          layoutApplied.current = true;
          updateNodePositions(laid);
        });
        return;
      }
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
            width: maxX - minX + padding * 2,
            height: maxY - minY + padding * 2,
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
      if (edge.type === "network" || edge.type === "default") {
        const linkId = edge.id.replace(/^(l\d+-)?phy-|^ospf-/, "");
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

  // Delete key handler for edit mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!editMode) return;
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (selectedNodeId) deleteNode(selectedNodeId);
      else if (selectedLinkId) deleteLink(selectedLinkId);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editMode, selectedNodeId, selectedLinkId, deleteNode, deleteLink]);

  // Drag-to-connect: create a link in edit mode
  const onConnect: OnConnect = useCallback(
    (params) => {
      if (!editMode) return;
      const srcNode = ir?.topology.nodes.find((n) => n.id === params.source);
      const tgtNode = ir?.topology.nodes.find((n) => n.id === params.target);
      if (!srcNode || !tgtNode) return;
      const srcIfaces = Object.keys(srcNode.interfaces ?? {});
      const tgtIfaces = Object.keys(tgtNode.interfaces ?? {});
      const srcIface = srcIfaces[0] ?? "eth0";
      const tgtIface = tgtIfaces[0] ?? "eth0";
      addLink(params.source!, srcIface, params.target!, tgtIface);
      setEdges((eds) => addEdge(params, eds));
    },
    [editMode, ir, addLink, setEdges]
  );

  const handleAddNode = useCallback(
    (type: "router" | "switch" | "host") => {
      const viewportCenter = { x: 300, y: 200 };
      const id = addNode(type, viewportCenter);
      layoutApplied.current = true;
      selectNode(id);
    },
    [addNode, selectNode]
  );

  return (
    <div className="flex flex-col h-full">
      <SimToolbar onLayoutChange={handleLayoutChange} onLoadSample={handleLoadSample} />
      <EditToolbar onAddNode={handleAddNode} />
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
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            minZoom={0.1}
            maxZoom={3}
            defaultEdgeOptions={{ type: "network" }}
            connectOnClick={editMode}
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

        {activePanel === "detail" && <NodeDetailPanel />}
        {activePanel === "edit" && <NodeEditPanel />}
        {activePanel === "link-detail" && <LinkDetailPanel />}
        {activePanel === "acl" && <AclTablePanel />}
        {activePanel === "packet" && <PacketSimPanel />}
        {activePanel === "lab" && <LabControlPanel />}
      </div>
    </div>
  );
}
