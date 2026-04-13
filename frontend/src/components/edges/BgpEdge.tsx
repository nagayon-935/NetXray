import { memo } from "react";
import { EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";

interface BgpEdgeData {
  sourceAs: number;
  targetAs: number;
  state: string;
  sourceRole: string | null;
}

function BgpEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style,
}: EdgeProps) {
  const d = data as unknown as BgpEdgeData;
  const state = d?.state ?? "unknown";
  const isEstablished = state === "established";

  // Use higher curvature than NetworkEdge (default 0.25) to visually separate
  // BGP overlay edges from coincident physical links.
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.55,
  });

  const strokeColor = isEstablished ? "#10b981" : "#f59e0b";

  return (
    <>
      <path
        id={id}
        d={edgePath}
        fill="none"
        className="react-flow__edge-path"
        style={{
          stroke: strokeColor,
          strokeWidth: 2,
          strokeDasharray: isEstablished ? undefined : "8,4",
          ...style,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan absolute pointer-events-none"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
        >
          <span
            className={`text-[9px] px-1 py-0.5 rounded-sm font-mono border ${
              isEstablished
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-amber-50 text-amber-700 border-amber-200"
            }`}
          >
            {d?.sourceAs !== undefined ? `AS${d.sourceAs}` : "BGP"}
            {" ↔ "}
            {d?.targetAs !== undefined ? `AS${d.targetAs}` : "?"}
          </span>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const BgpEdge = memo(BgpEdgeComponent);
