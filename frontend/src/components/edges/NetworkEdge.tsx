import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import { COLORS } from "../../lib/colors";

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

  let strokeColor: string = COLORS.NEUTRAL;
  if (isDown) strokeColor = COLORS.DOWN;
  else if (isOnPath) strokeColor = COLORS.PATH;
  if (selected) strokeColor = COLORS.SELECTED;

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
