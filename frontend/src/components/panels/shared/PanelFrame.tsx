import React from 'react';

export function PanelFrame({
  title, onClose, children, wide = false
}: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`${wide ? "w-96" : "w-80"} bg-white border-l border-slate-200 p-4 flex flex-col gap-3 overflow-y-auto`}>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-800 text-sm">{title}</h2>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
      </div>
      {children}
    </div>
  );
}