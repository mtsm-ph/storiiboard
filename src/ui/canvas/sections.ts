import { marqueeHolds } from './hitTest';
import type { CanvasItem, Geometry, Point, Rect } from './types';

// Sections (5.3). What a section holds is worked out, never stored: the items (and other sections) whose upright rectangle
// lies wholly inside it. These are pure, over boxes, so the canvas (for a drag's preview), the host (for a nudge, an align,
// a write) and the tests all agree on it.

/** The width of the band along a section's edges that picks it, in screen pixels. */
export const EDGE_BAND_PIXELS = 8;

/** The ids of what the section holds, in the order given: everything wholly inside its box except itself. */
export function sectionContents(section: Geometry & { id: string }, items: readonly (Geometry & { id: string })[]): string[] {
  return items.filter((item) => item.id !== section.id && marqueeHolds(item, section)).map((item) => item.id);
}

/** The tab's box in the world, from the section's place. */
export const tabRect = (section: Pick<CanvasItem, 'x' | 'y' | 'section'>): Rect | null =>
  section.section ? { x: section.x + section.section.tab.x, y: section.y + section.section.tab.y, width: section.section.tab.width, height: section.section.tab.height } : null;

const within = (r: Rect, p: Point): boolean => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;

/**
 * How far outside a section's box its edge still picks it, in screen pixels (6.28). The outline is a 1.5 px rule centred
 * on the edge, so 0.75 px of it is drawn outside the box, and a pointer on whole pixels (a mouse; every pointer in a
 * Mac's WebKit) over a pixel the rule inks is reported at that pixel's corner, up to a pixel further out still. With no
 * reach, whether a click on the outline picked the section hung on which fraction of a pixel the edge fell on at this
 * zoom: a deck page fitted at 41% had its top edge 0.66 px below the pixel clicked, and the click picked nothing. Two
 * pixels take in every pixel the rule touches, wherever the edge falls.
 */
export const EDGE_REACH_PIXELS = 2;

/**
 * Whether a point picks a section: on its name tab, or in the band along its edges (8 screen pixels wide at this zoom,
 * inside the box, and the outline's own pixels just outside it: EDGE_REACH_PIXELS). Anywhere else inside it is empty
 * space, where a click starts a marquee. A section is always upright, so its box is its edges.
 */
export function sectionHit(section: CanvasItem, point: Point, zoom: number): boolean {
  const tab = tabRect(section);
  if (tab && within(tab, point)) return true;
  // How far inside each edge the point is; negative outside it.
  const inside = [point.x - section.x, section.x + section.width - point.x, point.y - section.y, section.y + section.height - point.y];
  const reach = EDGE_REACH_PIXELS / zoom;
  if (inside.some((depth) => depth < -reach)) return false;
  const band = EDGE_BAND_PIXELS / zoom;
  return inside.some((depth) => depth <= band);
}

/** The topmost section a point picks; `inOrder` runs back to front. */
export function topmostSectionAt(inOrder: readonly CanvasItem[], point: Point, zoom: number): CanvasItem | undefined {
  for (let i = inOrder.length - 1; i >= 0; i -= 1) {
    const section = inOrder[i];
    if (section && sectionHit(section, point, zoom)) return section;
  }
  return undefined;
}

/**
 * Sections in the order they are drawn: the board's order, except that a section wholly inside a larger one is always drawn
 * after (above) it, so moving or resizing a larger section never buries a smaller one.
 */
export function drawOrder<T extends CanvasItem>(sections: readonly T[]): T[] {
  const area = (s: T) => s.width * s.height;
  const holds = (outer: T, inner: T) => outer !== inner && area(outer) > area(inner) && marqueeHolds(inner, outer);
  const left = [...sections];
  const out: T[] = [];
  while (left.length > 0) {
    const next = left.find((s) => !left.some((other) => holds(other, s))) ?? left[0];
    if (!next) break;
    out.push(next);
    left.splice(left.indexOf(next), 1);
  }
  return out;
}
