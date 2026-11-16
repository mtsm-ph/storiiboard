import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { loadBoardGrid, saveBoardGrid, type BoardGrid } from '../core/storage/settings';

// The dot grid and its snap (6.5.7a, Kevin, Nov 16): one choice on this computer for every board and deck, never a plan
// (a plan has its own scale and grid). A view, never an edit: no op, nothing in History, nothing undone by ⌘Z, nothing
// written to the project, never printed, exported or in a thumbnail.

const store = createStore<BoardGrid>()(() => loadBoardGrid());

/** Whether the grid shows, and whether a drag or resize snaps to it, on every board now. */
export const useBoardGrid = (): BoardGrid => useStore(store, (s) => s);

/** The grid and its snap as they are now, read outside React (a settings preset, 6.5.8). */
export const boardGridNow = (): BoardGrid => ({ ...store.getState() });

/** Changes either for every board on this computer, and keeps the choice. */
export function setBoardGrid(patch: Partial<BoardGrid>): void {
  const now = store.getState();
  const next = { ...now, ...patch };
  if (next.boardGrid === now.boardGrid && next.boardGridSnap === now.boardGridSnap) return;
  store.setState(saveBoardGrid(next));
}
