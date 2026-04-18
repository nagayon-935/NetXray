import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import type { Node as IRNode } from "../../types/netxray-ir";
import { NetworkNode } from "./NetworkNode";

const HostIcon = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-label="Host">
    <rect x="4" y="4" width="16" height="12" rx="1" />
    <line x1="8" y1="20" x2="16" y2="20" />
    <line x1="12" y1="16" x2="12" y2="20" />
  </svg>
);

function HostNodeComponent({ data, selected, sourcePosition, targetPosition }: NodeProps) {
  const node = data as unknown as IRNode;
  const firstIface = node.interfaces ? Object.values(node.interfaces)[0] : null;
  return (
    <NetworkNode
      selected={selected}
      sourcePosition={sourcePosition}
      targetPosition={targetPosition}
      borderCls="border-slate-200"
      selectedCls="border-purple-500 ring-2 ring-purple-200"
      handleCls="!bg-slate-300"
      minWidth="min-w-[140px]"
      icon={HostIcon}
      label={node.hostname || node.id}
      subtitle={firstIface?.ip ?? "no IP"}
      nodeId={node.id}
    />
  );
}

export const HostNode = memo(HostNodeComponent);
