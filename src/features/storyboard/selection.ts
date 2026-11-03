import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

// What the storyboard is on: the active scene (its sidebar entry and Scenes row carry the orange marker) and the
// selected frame. Shared by the sidebar, the Scenes tile and the board, and never saved: it's where the person is
// looking, not part of the project.

interface SelectionState {
  sceneId: string | null;
  shotId: string | null;
  /** Picking a scene elsewhere (sidebar, Scenes tile) keeps the frame only if it's in that scene. */
  selectScene: (sceneId: string | null) => void;
  /** Picking a frame makes its scene the active one. */
  selectShot: (shotId: string | null, sceneId: string | null) => void;
}

export const selectionStore = createStore<SelectionState>()((set, get) => ({
  sceneId: null,
  shotId: null,
  selectScene: (sceneId) => {
    set({ sceneId, shotId: sceneId === get().sceneId ? get().shotId : null });
  },
  selectShot: (shotId, sceneId) => {
    set({ shotId, sceneId: sceneId ?? get().sceneId });
  },
}));

export function useSelection<T>(select: (state: SelectionState) => T): T {
  return useStore(selectionStore, select);
}
