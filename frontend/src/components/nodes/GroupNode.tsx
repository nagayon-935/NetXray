import { memo } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";

function GroupNodeComponent({ data, selected }: NodeProps) {
  // We don't apply the backgroundColor/border directly here to a container,
  // because React Flow injects `style` props (width, height, etc) to the wrapping div it creates.
  // Instead, we just provide the label and resizer. The parent React Flow node wrapper handles
  // the dimensions and background colors based on the `style` we provided when defining the node.
  
  return (
    <>
      <NodeResizer 
        isVisible={selected} 
        minWidth={150} 
        minHeight={100}
        lineStyle={{ borderWidth: 2, borderColor: '#3b82f6' }} 
      />
      <div className="absolute top-2 left-3 font-bold text-sm text-slate-700 opacity-60 pointer-events-none">
        {data.label as string}
      </div>
    </>
  );
}

export const GroupNode = memo(GroupNodeComponent);
