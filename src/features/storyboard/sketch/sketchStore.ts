import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

// Which frame the sketch editor is open on, if any. Opened from the inspector's Sketch button or S on the board, and
// drawn by SketchHost in the app shell, so it works from either.

export const sketchStore = createStore<{ shotId: string | null }>()(() => ({ shotId: null }));

export function openSketch(shotId: string): void {
  sketchStore.setState({ shotId });
}

export function closeSketch(): void {
  sketchStore.setState({ shotId: null });
}

export function useSketchShot(): string | null {
  return useStore(sketchStore, (s) => s.shotId);
}
