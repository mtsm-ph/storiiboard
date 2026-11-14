import { create } from 'zustand';
import { openTile } from '../../app/shell/docking/layout';
import { layoutsOf, layoutStore } from '../../app/shell/docking/layoutStore';
import type { WorkspaceId } from '../../app/shell/workspaces';

// The day the Shoot days tile shows (3.7), kept in memory only, never in the project, as the Call sheet tile's is
// (sheetDay.ts). It lives here, not in the tile's own state, so the Inspector's Shoot day row (5.11) can open the tile
// on a frame's day. An id that isn't a live day of the open project is ignored by the tile, which then shows its first.

export const useShownDay = create<{ dayId: string | null }>(() => ({ dayId: null }));

export const showDay = (dayId: string | null): void => {
  useShownDay.setState({ dayId });
};

/** The Shoot days tile, in front in this workspace, on this day, with focus on the day's row in its list. */
export function openShootDay(workspaceId: WorkspaceId, dayId: string): void {
  showDay(dayId);
  const { layouts, change } = layoutStore.getState();
  change(workspaceId, openTile(layoutsOf(layouts, workspaceId).current, 'days'));
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>(`[data-day-id="${CSS.escape(dayId)}"]`)?.focus();
  });
}
