/**
 * useTimeline — Playback state management for the timeline panel.
 *
 * Wraps the snapshot-store navigation with auto-play logic.
 * The consumer calls `loadSnapshot` with the restored IR to apply it to the topology.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useSnapshotStore } from "../stores/snapshot-store";
import type { NetXrayIR } from "../types/netxray-ir";

export type PlayDirection = "forward" | "backward";

export interface UseTimelineReturn {
  /** Index of the currently previewed snapshot (-1 = live). */
  currentIndex: number;
  /** True while auto-playing. */
  isPlaying: boolean;
  /** Playback direction. */
  direction: PlayDirection;
  /** Interval in ms between steps (default: 1000). */
  intervalMs: number;

  play: (dir?: PlayDirection) => void;
  pause: () => void;
  /** Jump to a specific snapshot index; returns the restored IR or null. */
  seekTo: (index: number) => NetXrayIR | null;
  /** Step forward one snapshot; returns the restored IR or null. */
  stepForward: () => NetXrayIR | null;
  /** Step backward one snapshot; returns the restored IR or null. */
  stepBackward: () => NetXrayIR | null;
  /** Exit timeline preview and return to live view. */
  exitRestore: () => void;
  /** Change playback speed. */
  setIntervalMs: (ms: number) => void;
}

export function useTimeline(
  onRestore: (ir: NetXrayIR) => void,
  options?: { defaultIntervalMs?: number }
): UseTimelineReturn {
  const { currentIndex, restoreByIndex, stepIndex, exitRestore } = useSnapshotStore();

  const [isPlaying, setIsPlaying] = useState(false);
  const [direction, setDirection] = useState<PlayDirection>("forward");
  const [intervalMs, setIntervalMs] = useState(options?.defaultIntervalMs ?? 1000);

  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopInterval = useCallback(() => {
    if (playIntervalRef.current !== null) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => () => stopInterval(), [stopInterval]);

  const play = useCallback(
    (dir: PlayDirection = "forward") => {
      stopInterval();
      setDirection(dir);
      setIsPlaying(true);
      const delta = dir === "forward" ? 1 : -1;
      playIntervalRef.current = setInterval(() => {
        const ir = useSnapshotStore.getState().stepIndex(delta);
        if (ir) {
          onRestore(ir);
        } else {
          // Hit the boundary — stop automatically
          stopInterval();
        }
      }, intervalMs);
    },
    [intervalMs, onRestore, stopInterval]
  );

  const pause = useCallback(() => {
    stopInterval();
  }, [stopInterval]);

  const seekTo = useCallback(
    (index: number) => {
      stopInterval();
      const ir = restoreByIndex(index);
      if (ir) onRestore(ir);
      return ir;
    },
    [restoreByIndex, onRestore, stopInterval]
  );

  const stepForward = useCallback(() => {
    stopInterval();
    const ir = stepIndex(1);
    if (ir) onRestore(ir);
    return ir;
  }, [stepIndex, onRestore, stopInterval]);

  const stepBackward = useCallback(() => {
    stopInterval();
    const ir = stepIndex(-1);
    if (ir) onRestore(ir);
    return ir;
  }, [stepIndex, onRestore, stopInterval]);

  const handleExitRestore = useCallback(() => {
    stopInterval();
    exitRestore();
  }, [exitRestore, stopInterval]);

  return {
    currentIndex,
    isPlaying,
    direction,
    intervalMs,
    play,
    pause,
    seekTo,
    stepForward,
    stepBackward,
    exitRestore: handleExitRestore,
    setIntervalMs,
  };
}
