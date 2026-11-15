import { boundsFor } from './hitTest';
import { tabRect } from './sections';
import type { CanvasItem, Rect } from './types';
import { rectsMeet, unionBounds } from './viewport';

// Which items a canvas draws (5.7): those whose drawing meets the view, and always the selected ones, so the handles
// have every node. An item's drawing is its rotated box, a section's name tab with it, and what it draws past its box
// (6.4: a camera's cone, `beyond`), so a cone stays drawn while its camera's box is off screen. Picking stays on the box.

// Worked out once per item object (6.11), as boundsFor is: a pan asks for every item's reach on every frame, and an item
// never changes (a host makes a new object when it does).
const reaches = new WeakMap<CanvasItem, Rect>();

/** How far an item's drawing reaches, world units. */
export function drawReach(item: CanvasItem): Rect {
  const known = reaches.get(item);
  if (known) return known;
  const extra = [tabRect(item), item.beyond?.bounds].filter((r): r is Rect => r !== undefined && r !== null);
  const reach = (extra.length > 0 ? unionBounds([boundsFor(item), ...extra]) : null) ?? boundsFor(item);
  reaches.set(item, reach);
  return reach;
}

/** The items to draw for a view of the world, in their order. */
export function drawnItems(items: readonly CanvasItem[], picked: ReadonlySet<string>, world: Rect): CanvasItem[] {
  return items.filter((item) => picked.has(item.id) || rectsMeet(drawReach(item), world));
}

/**
 * What a view mounts (6.11): the items drawn, and every item that draws the same in view and out of it (`sameInAndOut`,
 * a plan's), in their order; those of them out of view are mounted hidden. So a pan or a zoom that carries a plan's items
 * out of view and back makes none of them again, and nothing hidden is drawn. A board's items are mounted only while
 * drawn, as they always were.
 */
export function mountedItems(items: readonly CanvasItem[], drawn: readonly CanvasItem[]): { items: CanvasItem[]; hidden: ReadonlySet<string> } {
  const shown = new Set(drawn.map((item) => item.id));
  const mounted = items.filter((item) => shown.has(item.id) || item.sameInAndOut === true);
  return { items: mounted, hidden: new Set(mounted.filter((item) => !shown.has(item.id)).map((item) => item.id)) };
}
