import { memo, useMemo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import { useTopologyStore } from "../../stores/topology-store";
import { useHeatmapStore } from "../../stores/heatmap-store";
import { useLayerStore } from "../../stores/layer-store";
import { getHeatmapStyle } from "../../lib/heatmap";

export const HeatmapEdgeComponent = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps) => {
  const ir = useTopologyStore((s) => s.ir);
  const heatmapEnabled = useLayerStore((s) => s.layers.heatmap);
  const { maxBps } = useHeatmapStore();

  const edgeData = data as any;
  
  // Find traffic data in IR for this edge
  const traffic = useMemo(() => {
    if (!ir || !edgeData) return 0;
    const node = ir.topology.nodes.find(n => n.id === edgeData.sourceNode);
    if (!node || !node.interfaces) return 0;
    const iface = node.interfaces[edgeData.sourceInterface];
    return iface?.traffic_out_bps ?? 0;
  }, [ir, edgeData]);

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const style = useMemo(() => {
    if (!heatmapEnabled) {
        return { stroke: selected ? "#6366f1" : "#94a3b8", strokeWidth: 2 };
    }
    const h = getHeatmapStyle(traffic, maxBps);
    return { stroke: h.stroke, strokeWidth: h.strokeWidth };
  }, [heatmapEnabled, traffic, maxBps, selected]);

  const formatTraffic = (bps: number) => {
    if (bps > 1000000) return `${(bps / 1000000).toFixed(1)} Mbps`;
    if (bps > 1000) return `${(bps / 1000).toFixed(1)} kbps`;
    return `${bps} bps`;
  };

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} />
      {heatmapEnabled && (
        <EdgeLabelRenderer>
          <div
            className="absolute text-[9px] font-bold px-1 rounded pointer-events-none"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              backgroundColor: style.stroke,
              color: 'white',
              opacity: 0.9
            }}
          >
            {formatTraffic(traffic)}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};

export const HeatmapEdge = memo(HeatmapEdgeComponent);
