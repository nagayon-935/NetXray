import { useEffect } from "react";
import { useTopologyStore } from "../../stores/topology-store";
import { getEngine } from "../../engine/wasm-engine";
import { PanelFrame } from "./shared/PanelFrame";

export function AclTablePanel() {
  const ir = useTopologyStore((s) => s.ir);
  const selectedAclName = useTopologyStore((s) => s.selectedAclName);
  const selectAcl = useTopologyStore((s) => s.selectAcl);
  const shadowedRules = useTopologyStore((s) => s.shadowedRules);
  const setShadowedRules = useTopologyStore((s) => s.setShadowedRules);

  const aclNames = ir?.policies?.acls ? Object.keys(ir.policies.acls) : [];

  useEffect(() => {
    if (!selectedAclName || !ir) return;
    const shadows = getEngine().detectAclShadows(selectedAclName);
    setShadowedRules(selectedAclName, shadows);
  }, [selectedAclName, ir, setShadowedRules]);

  if (!ir?.policies?.acls || aclNames.length === 0) {
    return (
      <PanelFrame title="ACL Viewer" onClose={() => selectAcl(null)} wide>
        <div className="text-sm text-slate-400">No ACLs defined</div>
      </PanelFrame>
    );
  }

  const rules = selectedAclName ? ir.policies.acls[selectedAclName] ?? [] : [];
  const shadows = selectedAclName ? shadowedRules[selectedAclName] ?? [] : [];
  const shadowedSeqs = new Set(shadows.map((s) => s.shadowed_seq));

  return (
    <PanelFrame title="ACL Viewer" onClose={() => selectAcl(null)} wide>
      <div className="border-b border-slate-100 -mx-4 px-3 pb-3">
        <div className="text-xs text-slate-500 uppercase tracking-wide mb-2">Select ACL</div>
        <div className="flex flex-wrap gap-1">
          {aclNames.map((name) => (
            <button
              key={name}
              onClick={() => selectAcl(name)}
              className={`text-xs px-2 py-1 rounded border ${
                selectedAclName === name
                  ? "bg-blue-50 border-blue-300 text-blue-700"
                  : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      {selectedAclName && (
        <>
          <div className="p-3">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="pb-1 pr-2">Seq</th>
                  <th className="pb-1 pr-2">Action</th>
                  <th className="pb-1 pr-2">Proto</th>
                  <th className="pb-1 pr-2">Src</th>
                  <th className="pb-1 pr-2">Dst</th>
                  <th className="pb-1">Port</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => {
                  const isShadowed = shadowedSeqs.has(rule.seq);
                  return (
                    <tr
                      key={rule.seq}
                      className={`border-t border-slate-50 ${
                        isShadowed ? "bg-amber-50 line-through opacity-60" : ""
                      }`}
                    >
                      <td className="py-1 pr-2 font-mono text-slate-600">{rule.seq}</td>
                      <td className="py-1 pr-2">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            rule.action === "permit"
                              ? "bg-green-100 text-green-700"
                              : "bg-red-100 text-red-700"
                          }`}
                        >
                          {rule.action}
                        </span>
                      </td>
                      <td className="py-1 pr-2 text-slate-600">{rule.protocol}</td>
                      <td className="py-1 pr-2 font-mono text-slate-600 max-w-[80px] truncate">
                        {rule.src}
                      </td>
                      <td className="py-1 pr-2 font-mono text-slate-600 max-w-[80px] truncate">
                        {rule.dst}
                      </td>
                      <td className="py-1 font-mono text-slate-600">
                        {rule.dst_port ?? "*"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {shadows.length > 0 && (
            <div className="p-3 border-t border-slate-100">
              <div className="text-xs text-amber-600 font-semibold mb-2">
                Shadowed Rules ({shadows.length})
              </div>
              {shadows.map((s, i) => (
                <div key={i} className="text-xs text-slate-600 mb-1 bg-amber-50 p-2 rounded">
                  <span className="font-mono">Seq {s.shadowed_seq}</span> shadowed by{" "}
                  <span className="font-mono">Seq {s.shadowed_by_seq}</span>
                  <div className="text-slate-500 mt-0.5">{s.reason}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </PanelFrame>
  );
}
