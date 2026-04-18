import { memo, useMemo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useInternalNode,
  type EdgeProps,
} from "@xyflow/react";
import { useTopologyStore } from "../../stores/topology-store";
import { useHeatmapStore } from "../../stores/heatmap-store";
import { useLayerStore } from "../../stores/layer-store";
import { getHeatmapStyle } from "../../lib/heatmap";
import { COLORS } from "../../lib/colors";
import { getEdgeParams } from "../../lib/floating-edges";

export const HeatmapEdgeComponent = ({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps) => {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const edgeParams = getEdgeParams(sourceNode, targetNode);

  const ir = useTopologyStore((s) => s.ir);
  const heatmapEnabled = useLayerStore((s) => s.layers.heatmap);
  const { maxBps } = useHeatmapStore();

  const edgeData = data as any;
  const isDown = edgeData?.state === "down";
  
  // Find traffic data in IR for this edge
  const traffic = useMemo(() => {
    if (!ir || !edgeData) return { tx: 0, rx: 0 };
    const node = ir.topology.nodes.find(n => n.id === edgeData.sourceNode);
    if (!node || !node.interfaces) return { tx: 0, rx: 0 };
    const iface = node.interfaces[edgeData.sourceInterface];
    return {
      tx: iface?.traffic_out_bps ?? 0,
      rx: iface?.traffic_in_bps ?? 0
    };
  }, [ir, edgeData]);

  const result = getBezierPath({
    sourceX: edgeParams?.sx ?? sourceX,
    sourceY: edgeParams?.sy ?? sourceY,
    targetX: edgeParams?.tx ?? targetX,
    targetY: edgeParams?.ty ?? targetY,
    sourcePosition: edgeParams?.sourcePos ?? sourcePosition,
    targetPosition: edgeParams?.targetPos ?? targetPosition,
  });
  const [edgePath] = result;
  const labelX = result[1] as number;
  const labelY = result[2] as number;

  const maxTraffic = Math.max(traffic.tx, traffic.rx);

  const style = useMemo(() => {
    if (isDown) {
      return { stroke: COLORS.DOWN, strokeWidth: 2, strokeDasharray: "6,4" };
    }
    if (!heatmapEnabled) {
        return { stroke: selected ? COLORS.SELECTED : COLORS.NEUTRAL, strokeWidth: 2 };
    }
    const h = getHeatmapStyle(maxTraffic, maxBps);
    return { stroke: h.stroke, strokeWidth: h.strokeWidth };
  }, [heatmapEnabled, maxTraffic, maxBps, selected, isDown]);

  const formatTraffic = (bps: number) => {
    if (bps > 1000000) return `${(bps / 1000000).toFixed(1)} Mbps`;
    if (bps > 1000) return `${(bps / 1000).toFixed(1)} kbps`;
    return `${bps} bps`;
  };

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} />
      {heatmapEnabled && !isDown && (
        <EdgeLabelRenderer>
          <div
            className="absolute text-[9px] font-bold px-1 py-0.5 rounded pointer-events-none flex flex-col items-center leading-tight shadow-sm"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              backgroundColor: style.stroke,
              color: 'white',
              opacity: 0.95
            }}
          >
            <span>tx: {formatTraffic(traffic.tx)}</span>
            <span>rx: {formatTraffic(traffic.rx)}</span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};

export const HeatmapEdge = memo(HeatmapEdgeComponent);
