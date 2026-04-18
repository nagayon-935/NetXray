import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import type { Node as IRNode } from "../../types/netxray-ir";
import { NetworkNode } from "./NetworkNode";

const SwitchIcon = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-label="Switch">
    <rect x="3" y="8" width="18" height="8" rx="1" />
    <circle cx="7" cy="12" r="1" fill="currentColor" />
    <circle cx="11" cy="12" r="1" fill="currentColor" />
    <circle cx="15" cy="12" r="1" fill="currentColor" />
    <circle cx="19" cy="12" r="1" fill="currentColor" />
  </svg>
);

function SwitchNodeComponent({ data, selected, sourcePosition, targetPosition }: NodeProps) {
  const node = data as unknown as IRNode;
  const ifaceCount = node.interfaces ? Object.keys(node.interfaces).length : 0;
  return (
    <NetworkNode
      selected={selected}
      sourcePosition={sourcePosition}
      targetPosition={targetPosition}
      borderCls="border-slate-300"
      selectedCls="border-emerald-500 ring-2 ring-emerald-200"
      handleCls="!bg-emerald-400"
      icon={SwitchIcon}
      label={node.hostname || node.id}
      subtitle={`${node.vendor ?? "generic"} | ${ifaceCount} IFs`}
      nodeId={node.id}
    />
  );
}

export const SwitchNode = memo(SwitchNodeComponent);
