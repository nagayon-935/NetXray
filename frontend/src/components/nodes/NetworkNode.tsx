import { Handle, Position } from "@xyflow/react";

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
}

export function NetworkNode({
  selected,
  borderCls,
  selectedCls,
  handleCls,
  minWidth = "min-w-[160px]",
  icon,
  label,
  subtitle,
}: NetworkNodeProps) {
  return (
    <div
      className={`px-3 py-2 rounded-lg border-2 bg-white shadow-md ${minWidth} ${
        selected ? selectedCls : borderCls
      }`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className={`!w-2 !h-2 ${handleCls}`}
      />
      <div className="flex items-center gap-2">
        <div className="text-lg">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-slate-800 truncate">{label}</div>
          <div className="text-xs text-slate-500">{subtitle}</div>
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className={`!w-2 !h-2 ${handleCls}`}
      />
    </div>
  );
}
