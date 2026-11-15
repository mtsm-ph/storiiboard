import { withDraft } from './placement';
import type { CanvasItem, Geometry, LiveBy, Rect } from './types';

// What the canvas draws during a gesture (5.7, 6.18 review): the items, a drag's draft put on the ones it moves, and the
// ones the host draws anew for the gesture (CanvasProps.liveItems, a plan's cut cones) in place of their own. Pure, so a
// board's path is tested without a screen: with nothing moving and nothing remade, the list is the very items given.

/** What the host draws anew for the live geometry (none without `liveItems`: a board), and whether it is a draft's. */
export function remadeFor(
  liveItems: ((live: ReadonlyMap<string, Geometry> | null, by: LiveBy, seen: Rect | null) => ReadonlyMap<string, CanvasItem>) | undefined,
  draft: ReadonlyMap<string, Geometry> | null,
  handles: ReadonlyMap<string, Geometry> | null,
  seen: Rect | null = null,
): ReadonlyMap<string, CanvasItem> | null {
  if (!liveItems) return null;
  return draft ? liveItems(draft, 'drag', seen) : liveItems(handles, 'handles', seen);
}

/**
 * The items as drawn now: only one the gesture moves (or the host draws anew for it) is a new object, so what is drawn
 * for the others is kept; with no draft and nothing remade, `items` itself.
 */
export function shownWith(items: readonly CanvasItem[], draft: ReadonlyMap<string, Geometry> | null, remade: ReadonlyMap<string, CanvasItem> | null): readonly CanvasItem[] {
  if (!draft && (!remade || remade.size === 0)) return items;
  return items.map((item) => {
    const base = remade?.get(item.id) ?? item;
    const moved = draft?.get(item.id);
    return moved ? withDraft(base, moved) : base;
  });
}
