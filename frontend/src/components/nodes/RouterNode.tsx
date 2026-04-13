import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import type { Node as IRNode } from "../../types/netxray-ir";
import { NetworkNode } from "./NetworkNode";

const RouterIcon = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-label="Router">
    <circle cx="12" cy="12" r="9" />
    <line x1="12" y1="3" x2="12" y2="21" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <path d="M5.6 5.6l12.8 12.8" />
    <path d="M18.4 5.6L5.6 18.4" />
  </svg>
);

function RouterNodeComponent({ data, selected }: NodeProps) {
  const node = data as unknown as IRNode;
  const ifaceCount = node.interfaces ? Object.keys(node.interfaces).length : 0;
  return (
    <NetworkNode
      selected={selected}
      borderCls="border-slate-300"
      selectedCls="border-blue-500 ring-2 ring-blue-200"
      handleCls="!bg-slate-400"
      icon={RouterIcon}
      label={node.hostname || node.id}
      subtitle={`${node.vendor ?? "generic"} | ${ifaceCount} IFs`}
    />
  );
}

export const RouterNode = memo(RouterNodeComponent);
