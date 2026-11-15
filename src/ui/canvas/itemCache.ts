import type { CanvasColours, CanvasItem } from './types';

// What the canvas keeps of the elements it made for its items (5.7). React skips a child it is handed again as the very same
// element, so an item nothing changed for costs no element at all. Pure, over a map, so the rules are tested without a screen.

export interface MadeFor<E> {
  item: CanvasItem;
  inView: boolean;
  /** The zoom the items were being drawn for when this was made. */
  zoom: number;
  colours: CanvasColours;
  register: unknown;
  ratio: number;
  /** The zoom this very element was made at (below `zoom` for an item that came into view during a zoom out). */
  drawnAt: number;
  element: E;
}

export interface ItemContext {
  colours: CanvasColours;
  /** The zoom the items are drawn for: it follows the view's zoom a moment after the view stops zooming. */
  zoom: number;
  /** The view's zoom this instant. */
  liveZoom: number;
  /** Ids of the items that are not in view. */
  away: ReadonlySet<string> | null;
  /**
   * Ids of the items mounted hidden (6.11: a plan's out of view, culling.ts's mountedItems). One drawn already keeps the
   * zoom it has while hidden, so a settled zoom makes only the items in view again (6.11 review, M1).
   */
  hidden?: ReadonlySet<string> | null;
  /** How many hidden items left at an older zoom this call may make for the zoom now (the catch-up after a settle). */
  catchUp?: number;
  register: unknown;
  ratio: number;
}

/**
 * The elements for these items. One made before is kept while its item, its place in view, the colours, the zoom, the pixel
 * ratio and the register are the same. One made now for an item that was not drawn a moment ago is drawn at the smaller of
 * the two zooms, so a zoom out that follows a zoom in doesn't ask every picture coming into view for its full size. An item
 * already drawn keeps the zoom it has. What is not in `items` is let go, so one that comes back is new.
 *
 * A plan's item mounted hidden (`sameInAndOut`, in `hidden`) whose only change is the zoom keeps its element: nothing of it
 * is drawn, so making it again at a settle would only cost the frame (6.11 review, M1: 300 at 400%, where 40 are in view).
 * It is made for the zoom now in the very render it comes into view, before the canvas shows it, so nothing is ever shown at
 * an older zoom; and `catchUp` of them are made each call besides, so a pan soon after finds them ready.
 */
export function elementsFor<E>(made: Map<string, MadeFor<E>>, items: readonly CanvasItem[], ctx: ItemContext, create: (item: CanvasItem, inView: boolean, zoom: number) => E): E[] {
  let catchUp = ctx.catchUp ?? 0;
  const list = items.map((item) => {
    // An item that draws the same in view and out of it (`sameInAndOut`) is drawn as in view, so crossing the edge keeps it.
    const inView = item.sameInAndOut === true || !ctx.away?.has(item.id);
    const have = made.get(item.id);
    const same = have !== undefined && have.item === item && have.inView === inView && have.colours === ctx.colours && have.register === ctx.register && have.ratio === ctx.ratio;
    if (same && have.zoom === ctx.zoom) return have.element;
    if (same && item.sameInAndOut === true && ctx.hidden?.has(item.id) === true) {
      if (catchUp <= 0) return have.element;
      catchUp -= 1;
    }
    // Drawn already, in view, at this zoom: it stays at what it was drawn at. One that has only now come into view (a picked item
    // drawn out of sight until now) is as new as one just made: the smaller. After the zoom settled, the zoom it settled at.
    const drawnAt = have ? (have.zoom !== ctx.zoom ? ctx.zoom : have.inView ? have.drawnAt : Math.min(ctx.zoom, ctx.liveZoom)) : Math.min(ctx.zoom, ctx.liveZoom);
    const element = create(item, inView, drawnAt);
    made.set(item.id, { item, inView, zoom: ctx.zoom, colours: ctx.colours, register: ctx.register, ratio: ctx.ratio, drawnAt, element });
    return element;
  });
  if (made.size > items.length) {
    const here = new Set(items.map((item) => item.id));
    for (const id of made.keys()) if (!here.has(id)) made.delete(id);
  }
  return list;
}

/** How many of the elements kept are left at a zoom other than `zoom` (hidden items not yet made for it). */
export function staleFor<E>(made: ReadonlyMap<string, MadeFor<E>>, zoom: number): number {
  let stale = 0;
  for (const have of made.values()) if (have.zoom !== zoom) stale += 1;
  return stale;
}
