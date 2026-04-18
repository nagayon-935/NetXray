import { Handle, Position } from "@xyflow/react";
import { useLabStore } from "../../stores/lab-store";

interface NetworkNodeProps {
  selected: boolean | undefined;
  /** Border class when not selected, e.g. "border-slate-300" */
  borderCls: string;
  /** Border + ring classes when selected, e.g. "border-blue-500 ring-2 ring-blue-200" */
  selectedCls: string;
  /** Handle color class, e.g. "!bg-slate-400" */
  handleCls: string;
  minWidth?: string;
  icon: React.ReactNode;
  label: string;
  subtitle: string;
  /** Node ID — used to look up runtime_state from lab-store */
  nodeId?: string;
  sourcePosition?: Position;
  targetPosition?: Position;
}

const STATE_DOT: Record<string, string> = {
  running:  "bg-emerald-500",
  stopped:  "bg-red-500",
  starting: "bg-amber-400",
  unknown:  "bg-slate-300",
};

export function NetworkNode({
  selected,
  borderCls,
  selectedCls,
  handleCls,
  minWidth = "min-w-[160px]",
  icon,
  label,
  subtitle,
  nodeId,
}: NetworkNodeProps) {
  const runtimeState = useLabStore((s) => nodeId ? s.nodeStates[nodeId] : undefined);

  return (
    <div
      className={`px-3 py-2 rounded-lg border-2 bg-white shadow-md ${minWidth} ${
        selected ? selectedCls : borderCls
      }`}
    >
      {/* We provide handles on all 4 sides so edges can dynamically connect to the closest one. */}
      <Handle type="target" id="top-t" position={Position.Top} className={`!w-2 !h-2 ${handleCls}`} />
      <Handle type="source" id="top-s" position={Position.Top} className={`!w-2 !h-2 ${handleCls}`} />

      <Handle type="target" id="right-t" position={Position.Right} className={`!w-2 !h-2 ${handleCls}`} />
      <Handle type="source" id="right-s" position={Position.Right} className={`!w-2 !h-2 ${handleCls}`} />

      <Handle type="target" id="bottom-t" position={Position.Bottom} className={`!w-2 !h-2 ${handleCls}`} />
      <Handle type="source" id="bottom-s" position={Position.Bottom} className={`!w-2 !h-2 ${handleCls}`} />

      <Handle type="target" id="left-t" position={Position.Left} className={`!w-2 !h-2 ${handleCls}`} />
      <Handle type="source" id="left-s" position={Position.Left} className={`!w-2 !h-2 ${handleCls}`} />

      <div className="flex items-center gap-2">
        <div className="text-lg">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-slate-800 truncate">{label}</div>
          <div className="text-xs text-slate-500">{subtitle}</div>
        </div>
        {runtimeState && (
          <div
            className={`w-2 h-2 rounded-full flex-shrink-0 ${STATE_DOT[runtimeState] ?? STATE_DOT.unknown}`}
            title={runtimeState}
          />
        )}
      </div>
    </div>
  );
}
