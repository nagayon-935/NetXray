import { create } from "zustand";

export interface CaptureSession {
  id: string;
  node: string;
  interface: string;
  filter: string;
  startedAt: string;
  running: boolean;
  /** Received pcap byte count */
  bytesReceived: number;
}

interface CaptureState {
  sessions: Record<string, CaptureSession>;
  /** WS connections keyed by session ID */
  _sockets: Record<string, WebSocket>;

  addSession: (s: CaptureSession) => void;
  removeSession: (id: string) => void;
  incrementBytes: (id: string, n: number) => void;
  registerSocket: (id: string, ws: WebSocket) => void;
  unregisterSocket: (id: string) => void;
}

export const useCaptureStore = create<CaptureState>((set) => ({
  sessions: {},
  _sockets: {},

  addSession: (s) =>
    set((st) => ({ sessions: { ...st.sessions, [s.id]: s } })),

  removeSession: (id) =>
    set((st) => {
      const next = { ...st.sessions };
      delete next[id];
      return { sessions: next };
    }),

  incrementBytes: (id, n) =>
    set((st) => {
      const s = st.sessions[id];
      if (!s) return st;
      return { sessions: { ...st.sessions, [id]: { ...s, bytesReceived: s.bytesReceived + n } } };
    }),

  registerSocket: (id, ws) =>
    set((st) => ({ _sockets: { ...st._sockets, [id]: ws } })),

  unregisterSocket: (id) =>
    set((st) => {
      const next = { ...st._sockets };
      delete next[id];
      return { _sockets: next };
    }),
}));

// ── helpers ───────────────────────────────────────────────────────────────────

export async function startCapture(
  node: string,
  iface: string,
  filter: string,
  preset?: string,
): Promise<string> {
  const res = await fetch("/api/capture/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ node, interface: iface, filter, preset }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(body.detail ?? `HTTP ${res.status}`);
  }
  const data = (await res.json()) as { id: string };
  return data.id;
}

export async function stopCapture(id: string): Promise<void> {
  const { _sockets, unregisterSocket } = useCaptureStore.getState();
  const ws = _sockets[id];
  if (ws) { ws.close(); unregisterSocket(id); }
  await fetch(`/api/capture/${id}`, { method: "DELETE" });
  useCaptureStore.getState().removeSession(id);
}
