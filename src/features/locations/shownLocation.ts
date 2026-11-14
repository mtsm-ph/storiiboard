import { create } from 'zustand';
import { openTile } from '../../app/shell/docking/layout';
import { layoutsOf, layoutStore } from '../../app/shell/docking/layoutStore';
import type { WorkspaceId } from '../../app/shell/workspaces';

// The location the Locations tile is asked to show (6.6: a sun path's "Open Locations"), kept in memory only, as the Shoot
// days tile's day is (src/features/schedule/shownDay.ts). Each ask is new (`at`), so asking for the location already
// asked for shows it again after the person picked another. An id that isn't a live location is ignored by the tile.

export const useShownLocation = create<{ request: { id: string | null; at: number } | null }>(() => ({ request: null }));

/** The Locations tile, in front in this workspace, on this location (or as it was, with none), with focus on its row. */
export function openLocation(workspaceId: WorkspaceId, locationId: string | null): void {
  useShownLocation.setState({ request: { id: locationId, at: Date.now() } });
  const { layouts, change } = layoutStore.getState();
  change(workspaceId, openTile(layoutsOf(layouts, workspaceId).current, 'locations'));
  requestAnimationFrame(() => {
    const row = locationId === null ? null : document.querySelector<HTMLElement>(`[data-location-id="${CSS.escape(locationId)}"]`);
    (row ?? document.querySelector<HTMLElement>('[data-location-id]'))?.focus();
  });
}
