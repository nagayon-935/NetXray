import { memo } from "react";
import { getBezierPath, useInternalNode, type EdgeProps } from "@xyflow/react";
import { COLORS } from "../../lib/colors";
import { getEdgeParams } from "../../lib/floating-edges";

interface BgpEdgeData {
  sourceAs: number;
  targetAs: number;
  state: string;
  sourceRole: string | null;
}

function BgpEdgeComponent({
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
  style,
}: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const edgeParams = getEdgeParams(sourceNode, targetNode);

  const d = data as unknown as BgpEdgeData;
  const state = d?.state ?? "unknown";
  const isEstablished = state === "established";

  // Use higher curvature than NetworkEdge (default 0.25) to visually separate
  // BGP overlay edges from coincident physical links.
  const [edgePath] = getBezierPath({
    sourceX: edgeParams?.sx ?? sourceX,
    sourceY: edgeParams?.sy ?? sourceY,
    targetX: edgeParams?.tx ?? targetX,
    targetY: edgeParams?.ty ?? targetY,
    sourcePosition: edgeParams?.sourcePos ?? sourcePosition,
    targetPosition: edgeParams?.targetPos ?? targetPosition,
    curvature: 0.55,
  });

  const strokeColor = isEstablished ? COLORS.UP : COLORS.WARN;

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
    </>
  );
}

export const BgpEdge = memo(BgpEdgeComponent);
