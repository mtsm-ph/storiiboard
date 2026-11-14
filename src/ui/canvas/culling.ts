import { boundsFor } from './hitTest';
import { tabRect } from './sections';
import type { CanvasItem, Rect } from './types';
import { rectsMeet, unionBounds } from './viewport';

// Which items a canvas draws (5.7): those whose drawing meets the view, and always the selected ones, so the handles
// have every node. An item's drawing is its rotated box, a section's name tab with it, and what it draws past its box
// (6.4: a camera's cone, `beyond`), so a cone stays drawn while its camera's box is off screen. Picking stays on the box.

/** How far an item's drawing reaches, world units. */
export function drawReach(item: CanvasItem): Rect {
  const extra = [tabRect(item), item.beyond?.bounds].filter((r): r is Rect => r !== undefined && r !== null);
  return (extra.length > 0 ? unionBounds([boundsFor(item), ...extra]) : null) ?? boundsFor(item);
}

/** The items to draw for a view of the world, in their order. */
export function drawnItems(items: readonly CanvasItem[], picked: ReadonlySet<string>, world: Rect): CanvasItem[] {
  return items.filter((item) => picked.has(item.id) || rectsMeet(drawReach(item), world));
}
