import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";

interface NetworkEdgeData {
  state: "up" | "down";
  sourceInterface: string;
  targetInterface: string;
  isOnPath: boolean;
}

function NetworkEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps) {
  const edgeData = data as unknown as NetworkEdgeData;
  const isDown = edgeData?.state === "down";
  const isOnPath = edgeData?.isOnPath ?? false;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  let strokeColor = "#94a3b8";
  if (isDown) strokeColor = "#ef4444";
  else if (isOnPath) strokeColor = "#3b82f6";
  if (selected) strokeColor = "#6366f1";

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: strokeColor,
          strokeWidth: isOnPath ? 3 : 2,
          strokeDasharray: isDown ? "6,4" : undefined,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="absolute text-[10px] bg-white/90 px-1 rounded pointer-events-none"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
        >
          <span className="text-slate-500">
            {edgeData?.sourceInterface} — {edgeData?.targetInterface}
          </span>
          {isDown && <span className="ml-1 text-red-500 font-bold">DOWN</span>}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const NetworkEdge = memo(NetworkEdgeComponent);
