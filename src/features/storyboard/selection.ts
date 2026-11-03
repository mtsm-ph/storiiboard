import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

// What the storyboard is on: the active scene (its sidebar entry and Scenes row carry the orange marker) and, from
// 1.7, the selected frame. Shared by the sidebar, the Scenes tile and the board, and never saved: it's where the
// person is looking, not part of the project.

interface SelectionState {
  sceneId: string | null;
  shotId: string | null;
  selectScene: (sceneId: string | null) => void;
}

export const selectionStore = createStore<SelectionState>()((set) => ({
  sceneId: null,
  shotId: null,
  selectScene: (sceneId) => {
    set({ sceneId });
  },
}));

export function useSelection<T>(select: (state: SelectionState) => T): T {
  return useStore(selectionStore, select);
}
