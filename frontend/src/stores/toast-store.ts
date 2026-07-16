import { create } from "zustand";

export type ToastType = "error" | "success" | "info" | "warning";

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastState {
  toasts: Toast[];
  /** Show a toast. Returns its id. Auto-dismisses after `ttl` ms (0 = sticky). */
  notify: (type: ToastType, message: string, ttl?: number) => string;
  dismiss: (id: string) => void;
}

const DEFAULT_TTL: Record<ToastType, number> = {
  success: 3000,
  info: 4000,
  warning: 6000,
  error: 8000,
};

let seq = 0;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  notify: (type, message, ttl) => {
    const id = `toast-${++seq}`;
    set((s) => ({ toasts: [...s.toasts, { id, type, message }] }));
    const lifetime = ttl ?? DEFAULT_TTL[type];
    if (lifetime > 0) {
      setTimeout(() => get().dismiss(id), lifetime);
    }
    return id;
  },

  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Convenience for non-React callers (hooks, store actions). */
export const notify = (type: ToastType, message: string, ttl?: number) =>
  useToastStore.getState().notify(type, message, ttl);
