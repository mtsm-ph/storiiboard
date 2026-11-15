import { useRowDrag, type RowDrag, type RowDragList } from '../../ui/useRowDrag';

// Reordering a scene's setups by drag (6.0), through the shared row drag (src/ui/useRowDrag.ts, pointer events, never
// HTML5 drag and drop: docs/DESKTOP_GAPS.md, B1). A scene is the group: an ink bar shows where the setup will land among
// its scene's rows, and outside the scene's own box (over another scene's rows, or out of the tile) there is no place.
// Up and Down on each row do the same from the keyboard.

export type SetupDrag = RowDrag;

const SETUP_ROWS: RowDragList = {
  rows: (sceneId) => [...document.querySelectorAll<HTMLElement>(`[data-setup-row][data-scene="${CSS.escape(sceneId)}"]`)],
  idOf: (row) => row.dataset.setupRow,
  area: (sceneId) => document.querySelector<HTMLElement>(`[data-setups-scene="${CSS.escape(sceneId)}"]`),
};

/** `to` is the setup's place among the scene's live setups once dropped (0 for first), as moveSetup takes it. */
export function useSetupDrag(onDrop: (id: string, to: number) => void) {
  return useRowDrag(SETUP_ROWS, onDrop);
}
