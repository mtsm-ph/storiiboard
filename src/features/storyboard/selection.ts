import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

// What the storyboard is on: the active scene (its sidebar entry and Scenes row carry the orange marker) and the
// selected frame. Shared by the sidebar, the Scenes tile and the board, and never saved: it's where the person is
// looking, not part of the project.

interface SelectionState {
  sceneId: string | null;
  shotId: string | null;
  /** A note the keys are on: it keeps the board's Tab stop, though the inspector shows its scene. */
  noteId: string | null;
  /**
   * Counts every pick, the item already selected picked again too: what was picked latest wins over a shoot day's own
   * history (historyDay.ts), which a pick that changes no id would otherwise leave on.
   */
  picks: number;
  /** Picking a scene elsewhere (sidebar, Scenes tile) keeps the frame only if it's in that scene. */
  selectScene: (sceneId: string | null) => void;
  /** Picking a frame makes its scene the active one. */
  selectShot: (shotId: string | null, sceneId: string | null) => void;
  /** Picking a note makes its scene the active one, with no frame selected. */
  selectNote: (noteId: string | null, sceneId: string | null) => void;
}

export const selectionStore = createStore<SelectionState>()((set, get) => ({
  sceneId: null,
  shotId: null,
  noteId: null,
  picks: 0,
  selectScene: (sceneId) => {
    const same = sceneId === get().sceneId;
    set({ sceneId, shotId: same ? get().shotId : null, noteId: same ? get().noteId : null, picks: get().picks + 1 });
  },
  selectShot: (shotId, sceneId) => {
    set({ shotId, noteId: null, sceneId: sceneId ?? get().sceneId, picks: get().picks + 1 });
  },
  selectNote: (noteId, sceneId) => {
    set({ noteId, shotId: null, sceneId: sceneId ?? get().sceneId, picks: get().picks + 1 });
  },
}));

export function useSelection<T>(select: (state: SelectionState) => T): T {
  return useStore(selectionStore, select);
}
