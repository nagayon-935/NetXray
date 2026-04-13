import type { ComponentType } from "react";
import type { NodeProps } from "@xyflow/react";
import { RouterNode } from "./RouterNode";
import { SwitchNode } from "./SwitchNode";
import { HostNode } from "./HostNode";

export const nodeTypes: Record<string, ComponentType<NodeProps>> = {
  router: RouterNode,
  switch: SwitchNode,
  host: HostNode,
};
