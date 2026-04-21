import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";

interface VniNodeData {
  vni: number;
  vlans: number[];
  color: { bg: string; border: string };
}

function handleStyle(borderColor: string) {
  return { background: borderColor, width: 7, height: 7, border: "none" };
}

function VniNodeComponent({ data, selected }: NodeProps) {
  const { vni, vlans, color } = data as unknown as VniNodeData;

  return (
    <div
      style={{
        background: color.bg,
        border: `2px solid ${color.border}`,
        borderRadius: 10,
        padding: "10px 18px",
        minWidth: 140,
        textAlign: "center",
        boxShadow: selected
          ? `0 0 0 3px ${color.border}60`
          : "0 1px 4px rgba(0,0,0,0.08)",
      }}
    >
      <Handle type="source" id="top-s"    position={Position.Top}    style={handleStyle(color.border)} />
      <Handle type="target" id="top-t"    position={Position.Top}    style={handleStyle(color.border)} />
      <Handle type="source" id="right-s"  position={Position.Right}  style={handleStyle(color.border)} />
      <Handle type="target" id="right-t"  position={Position.Right}  style={handleStyle(color.border)} />
      <Handle type="source" id="bottom-s" position={Position.Bottom} style={handleStyle(color.border)} />
      <Handle type="target" id="bottom-t" position={Position.Bottom} style={handleStyle(color.border)} />
      <Handle type="source" id="left-s"   position={Position.Left}   style={handleStyle(color.border)} />
      <Handle type="target" id="left-t"   position={Position.Left}   style={handleStyle(color.border)} />

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
        {/* Broadcast domain icon */}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color.border} strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <circle cx="12" cy="12" r="7" strokeDasharray="3,2" />
          <circle cx="12" cy="12" r="11" strokeDasharray="3,2" opacity="0.5" />
        </svg>
        <div style={{ fontWeight: 700, fontSize: 13, color: "#1e293b", lineHeight: 1.2 }}>
          VNI {vni}
        </div>
        {vlans.length > 0 && (
          <div style={{ fontSize: 10, color: "#64748b" }}>
            VLAN {[...new Set(vlans)].sort().join(", ")}
          </div>
        )}
      </div>
    </div>
  );
}

export const VniNode = memo(VniNodeComponent);
