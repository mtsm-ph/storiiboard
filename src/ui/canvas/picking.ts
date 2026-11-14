import { marqueeHolds, marqueeTouches, topmostAt } from './hitTest';
import { topmostSectionAt } from './sections';
import type { CanvasItem, Point, Rect } from './types';

// What can be picked (6.2a): a locked item (a locked layer, an underlay) is drawn but never picked, by a click, a
// marquee, Tab or Select all. Pure, so the rule is tested without a browser; the canvas picks only through these.

/** The items a click can pick, in the order given. */
export const pickable = <T extends Pick<CanvasItem, 'locked'>>(items: readonly T[]): T[] => items.filter((item) => item.locked !== true);

/** What a marquee picks: an item it touches, a section only when it holds the whole of it; never a locked one. */
export const marqueePicks = (items: readonly CanvasItem[], box: Rect): string[] =>
  pickable(items)
    .filter((item) => (item.section ? marqueeHolds(item, box) : marqueeTouches(item, box)))
    .map((item) => item.id);

/** Tab's order and Select all: sections, then connectors, then the other items, back to front, none locked. */
export const pickOrder = (sections: readonly CanvasItem[], links: readonly string[], plain: readonly CanvasItem[]): string[] => [
  ...pickable(sections).map((item) => item.id),
  ...links,
  ...pickable(plain).map((item) => item.id),
];

/** What a double-click lands on: the topmost item there that can be picked, never a locked one. */
export const itemAt = (plain: readonly CanvasItem[], point: Point): CanvasItem | undefined => topmostAt(pickable(plain), point);

/** What a right-click picks: the topmost item there, else a section by its tab or edge band; never a locked one. */
export const menuPickAt = (plain: readonly CanvasItem[], sections: readonly CanvasItem[], point: Point, zoom: number): CanvasItem | undefined =>
  itemAt(plain, point) ?? topmostSectionAt(pickable(sections), point, zoom);
