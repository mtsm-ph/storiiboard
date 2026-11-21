import { create } from 'zustand';
import { focusWhenShown } from '../../app/focusWhenShown';
import { openTile } from '../../app/shell/docking/layout';
import { layoutsOf, layoutStore } from '../../app/shell/docking/layoutStore';
import type { WorkspaceId } from '../../app/shell/workspaces';
import { selectionStore } from '../storyboard/selection';

// The shoot day whose own history the History tile shows (Kevin, Nov 18): a day can't be selected as a frame, a note or a
// scene can, so its History button in Shoot days or the Calendar names it here, in memory only, never in the project.
// The day stays the History tile's item until another is picked (a frame, a note, a scene): the latest pick wins.

interface HistoryDayState {
  dayId: string | null;
  /** The tile's "Only shoot day …" switch: on when asked from a day's History button, off and on again from the tile. */
  only: boolean;
}

export const useHistoryDay = create<HistoryDayState>(() => ({ dayId: null, only: false }));

/** The History tile, in front in this workspace, filtered to this day's own history, with focus on its filter. */
export function openDayHistory(workspaceId: WorkspaceId, dayId: string): void {
  useHistoryDay.setState({ dayId, only: true });
  const { layouts, change } = layoutStore.getState();
  change(workspaceId, openTile(layoutsOf(layouts, workspaceId).current, 'history'));
  focusWhenShown(() => document.querySelector<HTMLElement>('[data-history-only] [role="switch"]'));
}

// Picking a frame, a note or a scene makes it the tile's item again.
selectionStore.subscribe((now, before) => {
  if (now.shotId === before.shotId && now.noteId === before.noteId && now.sceneId === before.sceneId) return;
  if (useHistoryDay.getState().dayId !== null) useHistoryDay.setState({ dayId: null, only: false });
});
