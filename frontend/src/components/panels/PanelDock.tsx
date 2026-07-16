import { useCallback, useRef } from "react";
import { useTopologyStore, type PanelId } from "../../stores/topology-store";
import { NodeDetailPanel } from "./NodeDetailPanel";
import { NodeEditPanel } from "./NodeEditPanel";
import { LinkDetailPanel } from "./LinkDetailPanel";
import { AclTablePanel } from "./AclTablePanel";
import { PacketSimPanel } from "./PacketSimPanel";
import { LabControlPanel } from "./LabControlPanel";

const PANEL_LABEL: Record<PanelId, string> = {
  detail: "Node",
  "link-detail": "Link",
  acl: "ACL",
  packet: "Packet Sim",
  lab: "Lab Control",
  edit: "Edit Node",
};

const PANEL_COMPONENT: Record<PanelId, React.ComponentType> = {
  detail: NodeDetailPanel,
  "link-detail": LinkDetailPanel,
  acl: AclTablePanel,
  packet: PacketSimPanel,
  lab: LabControlPanel,
  edit: NodeEditPanel,
};

const MIN_WIDTH = 280;
const MAX_WIDTH = 640;

export function PanelDock() {
  const openTabs = useTopologyStore((s) => s.openTabs);
  const activeTab = useTopologyStore((s) => s.activeTab);
  const dockWidth = useTopologyStore((s) => s.dockWidth);
  const dockCollapsed = useTopologyStore((s) => s.dockCollapsed);
  const openPanel = useTopologyStore((s) => s.openPanel);
  const closePanelTab = useTopologyStore((s) => s.closePanelTab);
  const setDockWidth = useTopologyStore((s) => s.setDockWidth);
  const toggleDockCollapsed = useTopologyStore((s) => s.toggleDockCollapsed);

  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);

  const onResizeDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragState.current = { startX: e.clientX, startWidth: dockWidth };

      const move = (ev: MouseEvent) => {
        if (!dragState.current) return;
        const { startX, startWidth } = dragState.current;
        const next = startWidth - (ev.clientX - startX);
        setDockWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next)));
      };
      const up = () => {
        dragState.current = null;
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    },
    [dockWidth, setDockWidth]
  );

  if (openTabs.length === 0) return null;

  if (dockCollapsed) {
    return (
      <div className="w-10 bg-white border-l border-slate-200 flex flex-col items-center py-2 gap-1">
        <button
          onClick={toggleDockCollapsed}
          className="text-slate-400 hover:text-slate-600 text-xs mb-2"
          title="Expand panel"
        >
          ◂
        </button>
        {openTabs.map((id) => (
          <button
            key={id}
            onClick={() => {
              openPanel(id);
              toggleDockCollapsed();
            }}
            className={`w-7 h-7 rounded text-[10px] font-semibold flex items-center justify-center ${
              activeTab === id
                ? "bg-blue-50 text-blue-700 border border-blue-300"
                : "text-slate-500 hover:bg-slate-100"
            }`}
            title={PANEL_LABEL[id]}
          >
            {PANEL_LABEL[id].slice(0, 2)}
          </button>
        ))}
      </div>
    );
  }

  const ActivePanelComponent = activeTab ? PANEL_COMPONENT[activeTab] : null;

  return (
    <div className="relative flex bg-white border-l border-slate-200" style={{ width: dockWidth }}>
      <div
        onMouseDown={onResizeDown}
        className="absolute left-0 top-0 h-full w-1.5 -translate-x-1/2 cursor-col-resize z-10 hover:bg-blue-300/50"
      />
      <div className="flex flex-col flex-1 min-w-0">
        <div className="flex items-center border-b border-slate-100 px-1 shrink-0">
          <div className="flex flex-1 overflow-x-auto">
            {openTabs.map((id) => (
              <button
                key={id}
                onClick={() => openPanel(id)}
                className={`group flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === id
                    ? "border-blue-500 text-blue-700"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                {PANEL_LABEL[id]}
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    closePanelTab(id);
                  }}
                  className="text-slate-300 group-hover:text-slate-500 hover:text-slate-700"
                >
                  ✕
                </span>
              </button>
            ))}
          </div>
          <button
            onClick={toggleDockCollapsed}
            className="text-slate-400 hover:text-slate-600 px-1.5 shrink-0"
            title="Collapse panel"
          >
            ▸
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3 min-w-0">
          {ActivePanelComponent && <ActivePanelComponent />}
        </div>
      </div>
    </div>
  );
}
