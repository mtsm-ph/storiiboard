import type { CanvasColours, CanvasItem, Point } from './types';

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
  /**
   * How many plan items (`sameInAndOut`) left at an older zoom this call may make for the zoom now: the catch-up after a
   * settle, a slice a frame (6.11). In view before hidden, nearest `centre` first.
   */
  catchUp?: number;
  /** The view's centre in the world: the catch-up starts from it. */
  centre?: Point;
  register: unknown;
  ratio: number;
}

/** The plan items to make for the zoom now in this call: at most `budget`, in view first, then nearest `centre`. */
function sliceFor<E>(made: ReadonlyMap<string, MadeFor<E>>, items: readonly CanvasItem[], ctx: ItemContext, budget: number): ReadonlySet<string> {
  if (budget <= 0) return new Set();
  const waiting: { id: string; away: number; far: number }[] = [];
  for (const item of items) {
    if (item.sameInAndOut !== true) continue;
    const have = made.get(item.id);
    if (have === undefined || have.zoom === ctx.zoom || have.item !== item || have.colours !== ctx.colours || have.register !== ctx.register || have.ratio !== ctx.ratio) continue;
    const dx = item.x + item.width / 2 - (ctx.centre?.x ?? 0);
    const dy = item.y + item.height / 2 - (ctx.centre?.y ?? 0);
    waiting.push({ id: item.id, away: ctx.hidden?.has(item.id) === true ? 1 : 0, far: dx * dx + dy * dy });
  }
  if (waiting.length > budget) waiting.sort((a, b) => a.away - b.away || a.far - b.far);
  return new Set(waiting.slice(0, budget).map((w) => w.id));
}

/**
 * The elements for these items. One made before is kept while its item, its place in view, the colours, the zoom, the pixel
 * ratio and the register are the same. One made now for an item that was not drawn a moment ago is drawn at the smaller of
 * the two zooms, so a zoom out that follows a zoom in doesn't ask every picture coming into view for its full size. An item
 * already drawn keeps the zoom it has. What is not in `items` is let go, so one that comes back is new.
 *
 * A plan's item (`sameInAndOut`) whose only change is the zoom keeps its element until the catch-up reaches it: making all
 * 300 again in the settle's one frame cost 200 ms in a dev build (6.11). `catchUp` of them are made each call, in view
 * first and nearest the view's centre, hidden ones after; one not yet made is shown as drawn for the older zoom, its
 * screen-sized labels scaled for the live zoom meanwhile (screenSized.ts), as during the zoom itself. A board's items are
 * all made for a new zoom at once, as before.
 */
export function elementsFor<E>(made: Map<string, MadeFor<E>>, items: readonly CanvasItem[], ctx: ItemContext, create: (item: CanvasItem, inView: boolean, zoom: number) => E): E[] {
  const slice = sliceFor(made, items, ctx, ctx.catchUp ?? 0);
  const list = items.map((item) => {
    // An item that draws the same in view and out of it (`sameInAndOut`) is drawn as in view, so crossing the edge keeps it.
    const inView = item.sameInAndOut === true || !ctx.away?.has(item.id);
    const have = made.get(item.id);
    const same = have !== undefined && have.item === item && have.inView === inView && have.colours === ctx.colours && have.register === ctx.register && have.ratio === ctx.ratio;
    if (same && have.zoom === ctx.zoom) return have.element;
    if (same && item.sameInAndOut === true && !slice.has(item.id)) return have.element;
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

/** How many of the elements kept are left at a zoom other than `zoom` (plan items the catch-up has not yet made for it). */
export function staleFor<E>(made: ReadonlyMap<string, MadeFor<E>>, zoom: number): number {
  let stale = 0;
  for (const have of made.values()) if (have.zoom !== zoom) stale += 1;
  return stale;
}
