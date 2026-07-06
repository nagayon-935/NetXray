import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useInternalNode,
  type EdgeProps,
} from "@xyflow/react";
import { COLORS } from "../../lib/colors";
import { getEdgeParams } from "../../lib/floating-edges";
import { useImpairmentStore } from "../../stores/impairment-store";

interface NetworkEdgeData {
  state: "up" | "down";
  sourceInterface: string;
  targetInterface: string;
  isOnPath: boolean;
}

/**
 * getBezierPath always places the label at the curve's exact midpoint, so
 * two edges that cross each other symmetrically (e.g. a spine-leaf full
 * mesh) get labels sitting on top of each other at the crossing point. A
 * small deterministic per-edge offset (stable across re-renders, derived
 * from the edge id) nudges them apart without needing real collision math.
 */
function labelOffset(id: string): { dx: number; dy: number } {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  const dx = ((Math.abs(hash) % 17) - 8) * 2;
  const dy = ((Math.abs(hash >> 4) % 17) - 8) * 2;
  return { dx, dy };
}

function NetworkEdgeComponent({
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
}: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const edgeParams = getEdgeParams(sourceNode, targetNode);

  const edgeData = data as unknown as NetworkEdgeData;
  const isDown = edgeData?.state === "down";
  const isOnPath = edgeData?.isOnPath ?? false;

  // Strip view-prefix (e.g. "l3-phy-") to get the raw link ID used as impairment key
  const rawLinkId = id.replace(/^(l\d+-)?phy-/, "");
  const impairment = useImpairmentStore((s) => s.impairments[rawLinkId]);

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
  const { dx, dy } = labelOffset(id);

  let strokeColor: string = COLORS.NEUTRAL;
  if (isDown) strokeColor = COLORS.DOWN;
  else if (isOnPath) strokeColor = COLORS.PATH;
  if (selected) strokeColor = COLORS.SELECTED;

  // Build impairment badge text: show only non-zero / non-null values
  const impairmentParts: string[] = [];
  if (impairment) {
    if (impairment.delay_ms != null && impairment.delay_ms > 0)
      impairmentParts.push(`${impairment.delay_ms}ms`);
    if (impairment.loss_pct != null && impairment.loss_pct > 0)
      impairmentParts.push(`${impairment.loss_pct}% loss`);
    if (impairment.rate_kbit != null && impairment.rate_kbit > 0)
      impairmentParts.push(`${impairment.rate_kbit}kbit`);
  }
  const impairmentLabel = impairmentParts.join(" / ");

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: impairment ? COLORS.WARN : strokeColor,
          strokeWidth: isOnPath ? 3 : 2,
          strokeDasharray: isDown ? "6,4" : undefined,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="absolute text-[10px] bg-white/90 px-1 rounded pointer-events-none"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX + dx}px, ${labelY + dy}px)`,
          }}
        >
          <span className="text-slate-500">
            {edgeData?.sourceInterface} — {edgeData?.targetInterface}
          </span>
          {isDown && <span className="ml-1 text-red-500 font-bold">DOWN</span>}
          {impairmentLabel && (
            <span className="ml-1 text-amber-600 font-semibold">{impairmentLabel}</span>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const NetworkEdge = memo(NetworkEdgeComponent);
