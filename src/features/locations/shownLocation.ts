import { create } from 'zustand';
import { focusWhenShown } from '../../app/focusWhenShown';
import { projectStore } from '../../app/projectStore';
import { openTile } from '../../app/shell/docking/layout';
import { layoutsOf, layoutStore } from '../../app/shell/docking/layoutStore';
import type { WorkspaceId } from '../../app/shell/workspaces';

// The location the Locations tile is asked to show (6.6: a sun path's "Open Locations"), kept in memory only, as the Shoot
// days tile's day is (src/features/schedule/shownDay.ts). Each ask is new (`at`), so asking for the location already
// asked for shows it again after the person picked another. An id that isn't a live location is ignored by the tile. The
// tile reads an ask on its first draw too (it may mount because of it), clears it once used, and a project change
// clears it (6.6 review).

export const useShownLocation = create<{ request: { id: string | null; at: number } | null }>(() => ({ request: null }));

projectStore.subscribe((state, before) => {
  if (state.project !== before.project) useShownLocation.setState({ request: null });
});

/** The Locations tile, in front in this workspace, on this location (or as it was, with none), with focus on its row. */
export function openLocation(workspaceId: WorkspaceId, locationId: string | null): void {
  useShownLocation.setState({ request: { id: locationId, at: Date.now() } });
  const { layouts, change } = layoutStore.getState();
  change(workspaceId, openTile(layoutsOf(layouts, workspaceId).current, 'locations'));
  focusWhenShown(() => {
    const row = locationId === null ? null : document.querySelector<HTMLElement>(`[data-location-id="${CSS.escape(locationId)}"]`);
    // With no location asked for, or one that isn't live, the first row; else wait for that location's own row.
    const live = locationId !== null && projectStore.getState().records[locationId]?.trashedAt === null;
    return row ?? (live ? null : document.querySelector<HTMLElement>('[data-location-id]'));
  });
}
