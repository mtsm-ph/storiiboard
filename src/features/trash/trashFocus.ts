import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { TrashKind } from './trash';

// A request to show the Trash tile filtered to one kind and scene (5.4: a live card whose frame is in the Trash opens the
// tile on it). The tile takes the request once and the store forgets it, so a tile opened later never re-applies an old one;
// a request for another project is dropped. It is where the person is looking, never saved.

export interface TrashAsk {
  kind: TrashKind;
  sceneId: string | null;
  /** The project it was asked in. */
  projectId: string;
}

interface FocusState {
  asked: TrashAsk | null;
  ask: (kind: TrashKind, sceneId: string | null, projectId: string) => void;
  /** Takes the request if it is for this project, and clears it either way. */
  take: (projectId: string | null) => TrashAsk | null;
}

export const trashFocus = createStore<FocusState>()((set, get) => ({
  asked: null,
  ask: (kind, sceneId, projectId) => {
    set({ asked: { kind, sceneId, projectId } });
  },
  take: (projectId) => {
    const asked = get().asked;
    if (asked) set({ asked: null });
    return asked && asked.projectId === projectId ? asked : null;
  },
}));

export function useTrashAsk(): TrashAsk | null {
  return useStore(trashFocus, (s) => s.asked);
}
