import { describe, expect, it } from 'vitest';
import { elementsFor, staleFor, type ItemContext, type MadeFor } from './itemCache';
import type { CanvasColours, CanvasItem } from './types';

// What the canvas keeps of the elements it made for its items (5.7). "Made" is counted by the create function, which stands
// in for the item's drawing: an item whose element is kept is an item whose draw isn't called again.

const colours: CanvasColours = { ink: '#000', paper: '#fff', raised: '#ccc' };
const register = () => undefined;
const item = (id: string, x = 0): CanvasItem => ({ id, label: id, x, y: 0, width: 100, height: 100, rotation: 0 });
const context = (over: Partial<ItemContext> = {}): ItemContext => ({ colours, zoom: 1, liveZoom: 1, away: null, register, ratio: 1, ...over });

function setup() {
  const made = new Map<string, MadeFor<string>>();
  const calls: string[] = [];
  const zooms: Record<string, number> = {};
  const draw = (list: readonly CanvasItem[], ctx: ItemContext) =>
    elementsFor(made, list, ctx, (it, inView, zoom) => {
      calls.push(it.id);
      zooms[it.id] = zoom;
      return `${it.id}:${String(inView)}:${String(zoom)}`;
    });
  return { made, calls, zooms, draw };
}

describe('the elements kept for the items', () => {
  it('makes an element for each item once, and none again while nothing changed', () => {
    const { calls, draw } = setup();
    const list = [item('a'), item('b'), item('c')];
    const first = draw(list, context());
    expect(calls).toEqual(['a', 'b', 'c']);
    expect(draw(list, context())).toEqual(first);
    expect(calls).toHaveLength(3);
  });

  it('draws again only an item that is a new object, as a moved one is', () => {
    const { calls, draw } = setup();
    const a = item('a');
    const b = item('b');
    draw([a, b], context());
    calls.length = 0;
    draw([a, item('b', 40)], context());
    expect(calls).toEqual(['b']);
  });

  it('draws every item again when the colours, the zoom, the pixel ratio or the register change', () => {
    const { calls, draw } = setup();
    const list = [item('a'), item('b')];
    draw(list, context());
    for (const over of [{ colours: { ...colours } }, { zoom: 2, liveZoom: 2 }, { ratio: 2 }, { register: () => undefined }]) {
      calls.length = 0;
      draw(list, context(over));
      expect(calls).toEqual(['a', 'b']);
      // The next render with those same values keeps them.
      calls.length = 0;
      draw(list, context(over));
      expect(calls).toEqual([]);
    }
  });

  it('draws again the items that go out of view or come into it', () => {
    const { calls, draw } = setup();
    const list = [item('a'), item('b'), item('c')];
    draw(list, context());
    calls.length = 0;
    expect(draw(list, context({ away: new Set(['b']) }))).toEqual(['a:true:1', 'b:false:1', 'c:true:1']);
    expect(calls).toEqual(['b']);
  });

  it('lets go of the items that leave, so one that comes back is made new', () => {
    const { made, calls, draw } = setup();
    const a = item('a');
    const b = item('b');
    draw([a, b], context());
    draw([a], context());
    expect([...made.keys()]).toEqual(['a']);
    calls.length = 0;
    draw([a, b], context());
    expect(calls).toEqual(['b']);
  });

  it('draws an item that comes into view during a zoom out at the live zoom, not at the zoom the others settled at', () => {
    const { zooms, draw } = setup();
    const a = item('a');
    // Settled at 400%; the view is zooming out and is at 90% now.
    draw([a], context({ zoom: 4, liveZoom: 4 }));
    draw([a, item('b')], context({ zoom: 4, liveZoom: 0.9 }));
    expect(zooms).toEqual({ a: 4, b: 0.9 });
    // A step of the zoom alone, with the same items, leaves them as they are.
    draw([a, item('b')], context({ zoom: 4, liveZoom: 0.8 }));
    expect(zooms.a).toBe(4);
  });

  it('keeps the zoom an item was drawn at when it is made again for another reason', () => {
    const { zooms, draw } = setup();
    const a = item('a');
    draw([a], context({ zoom: 4, liveZoom: 4 }));
    // Moved while zooming out: still the picture it was.
    draw([item('a', 30)], context({ zoom: 4, liveZoom: 0.7 }));
    expect(zooms.a).toBe(4);
  });

  it('treats a picked item drawn out of sight as new when it comes into view', () => {
    const { zooms, draw } = setup();
    const a = item('a');
    draw([a], context({ zoom: 4, liveZoom: 4, away: new Set(['a']) }));
    draw([a], context({ zoom: 4, liveZoom: 0.6, away: null }));
    expect(zooms.a).toBe(0.6);
  });

  it('draws everything for the zoom the view settled at', () => {
    const { zooms, draw } = setup();
    const list = [item('a'), item('b')];
    draw(list, context({ zoom: 4, liveZoom: 4 }));
    draw(list, context({ zoom: 4, liveZoom: 0.5 }));
    draw(list, context({ zoom: 0.5, liveZoom: 0.5 }));
    expect(zooms).toEqual({ a: 0.5, b: 0.5 });
  });
});

describe('an item drawn the same in view and out of it (6.11)', () => {
  it('keeps its element as it crosses the view’s edge, while a board’s item is drawn again', () => {
    const { calls, draw } = setup();
    const plan = { ...item('plan'), sameInAndOut: true };
    const board = item('board');
    draw([plan, board], context());
    expect(calls).toEqual(['plan', 'board']);
    // Both boxes leave the view, then come back: only the board's item, which may choose its picture by it, is made again.
    draw([plan, board], context({ away: new Set(['plan', 'board']) }));
    draw([plan, board], context());
    expect(calls).toEqual(['plan', 'board', 'board', 'board']);
  });

  it('is made again for a new zoom, as every item is, by the catch-up after the settle (6.11)', () => {
    const { calls, zooms, draw } = setup();
    const plan = { ...item('plan'), sameInAndOut: true };
    draw([plan], context());
    draw([plan], context({ zoom: 2, liveZoom: 2, away: new Set(['plan']) }));
    expect(calls).toEqual(['plan']);
    draw([plan], context({ zoom: 2, liveZoom: 2, away: new Set(['plan']), catchUp: 1 }));
    expect(calls).toEqual(['plan', 'plan']);
    expect(zooms.plan).toBe(2);
  });
});

describe('a settled zoom on a plan, its items made again a slice a frame (6.11)', () => {
  // 300 plan items in a row, 10 apart; at 400% the first 40 are in view, the rest mounted hidden.
  const plan = Array.from({ length: 300 }, (_, i) => ({ ...item(`p${String(i)}`, i * 10), sameInAndOut: true }));
  const hiddenFrom = (first: number) => new Set(plan.slice(first).map((p) => p.id));
  const SLICE = 8;

  it('makes none in the settle’s own render, then no more than the slice in each, and all within 300 / slice renders', () => {
    const { made, calls, zooms, draw } = setup();
    draw(plan, context({ zoom: 0.3, liveZoom: 0.3 }));
    calls.length = 0;
    // Settled at fit, every one of the 300 in view: the settle's render keeps every element.
    const settled = draw(plan, context({ zoom: 0.25, liveZoom: 0.25, hidden: new Set() }));
    expect(calls).toEqual([]);
    expect(settled[0]).toBe('p0:true:0.3');
    expect(staleFor(made, 0.25)).toBe(300);
    let renders = 0;
    while (staleFor(made, 0.25) > 0 && renders < 1000) {
      calls.length = 0;
      draw(plan, context({ zoom: 0.25, liveZoom: 0.25, hidden: new Set(), catchUp: SLICE }));
      expect(calls.length).toBeLessThanOrEqual(SLICE);
      renders += 1;
    }
    expect(renders).toBe(Math.ceil(300 / SLICE));
    expect(new Set(Object.values(zooms))).toEqual(new Set([0.25]));
    // Done: a render after it makes nothing.
    calls.length = 0;
    draw(plan, context({ zoom: 0.25, liveZoom: 0.25, hidden: new Set(), catchUp: SLICE }));
    expect(calls).toEqual([]);
  });

  it('makes the items in view first, nearest the view’s centre first, and the hidden ones after', () => {
    const { calls, draw } = setup();
    draw(plan, context({ zoom: 0.3, liveZoom: 0.3 }));
    // At 400%, centred on p20 (x 200 + 50): p0 to p39 in view.
    const at = context({ zoom: 4, liveZoom: 4, hidden: hiddenFrom(40), centre: { x: 250, y: 50 } });
    draw(plan, at);
    calls.length = 0;
    draw(plan, { ...at, catchUp: SLICE });
    expect(calls.sort()).toEqual(['p16', 'p17', 'p18', 'p19', 'p20', 'p21', 'p22', 'p23'].sort());
    for (let n = 0; n < 4; n += 1) draw(plan, { ...at, catchUp: SLICE });
    // Five slices: the 40 in view, and none of the hidden yet.
    const inViewMade = calls.filter((id) => !hiddenFrom(40).has(id));
    expect(calls).toHaveLength(40);
    expect(inViewMade).toHaveLength(40);
    calls.length = 0;
    draw(plan, { ...at, catchUp: SLICE });
    expect(calls).toEqual(plan.slice(40, 48).map((p) => p.id));
  });

  it('starts over for a new zoom that settles before the catch-up is done, and makes nothing more for the old one', () => {
    const { made, calls, zooms, draw } = setup();
    draw(plan, context({ zoom: 0.3, liveZoom: 0.3 }));
    draw(plan, context({ zoom: 4, liveZoom: 4, hidden: hiddenFrom(40), centre: { x: 0, y: 50 } }));
    draw(plan, context({ zoom: 4, liveZoom: 4, hidden: hiddenFrom(40), centre: { x: 0, y: 50 }, catchUp: SLICE }));
    expect(staleFor(made, 4)).toBe(300 - SLICE);
    // The view zooms out again before the rest are made: the list's render while it zooms makes none (ItemNodes asks for
    // no slice while the view's zoom isn't the one drawn for).
    calls.length = 0;
    draw(plan, context({ zoom: 4, liveZoom: 2.5, hidden: hiddenFrom(64), centre: { x: 1500, y: 50 } }));
    expect(calls).toEqual([]);
    // Settled at 200%, centred on p150: the first slice is round p150, at 200%, none at 400%.
    const at = context({ zoom: 2, liveZoom: 2, hidden: new Set([...plan.slice(0, 110), ...plan.slice(190)].map((p) => p.id)), centre: { x: 1500 + 50, y: 50 } });
    draw(plan, at);
    calls.length = 0;
    draw(plan, { ...at, catchUp: SLICE });
    expect(calls.sort()).toEqual(['p146', 'p147', 'p148', 'p149', 'p150', 'p151', 'p152', 'p153'].sort());
    expect(calls.every((id) => zooms[id] === 2)).toBe(true);
    expect(staleFor(made, 2)).toBe(300 - SLICE);
    for (let n = 0; n < 40; n += 1) draw(plan, { ...at, catchUp: SLICE });
    expect(staleFor(made, 2)).toBe(0);
  });

  it('keeps the element an item had while it waits: the older zoom’s, so its labels stay sized for the live zoom', () => {
    const { draw } = setup();
    draw(plan, context({ zoom: 0.3, liveZoom: 0.3 }));
    const out = draw(plan, context({ zoom: 4, liveZoom: 4, hidden: hiddenFrom(40), catchUp: SLICE }));
    expect(out[0]).toBe('p0:true:4');
    expect(out[39]).toBe('p39:true:0.3');
  });

  it('makes a hidden item again at once for anything but the zoom (an edit, the colours)', () => {
    const { calls, draw } = setup();
    const list = [{ ...item('a'), sameInAndOut: true }, { ...item('b'), sameInAndOut: true }];
    draw(list, context());
    calls.length = 0;
    const edited = [list[0] as CanvasItem, { ...item('b', 30), sameInAndOut: true }];
    draw(edited, context({ zoom: 2, liveZoom: 2, hidden: new Set(['a', 'b']) }));
    expect(calls).toEqual(['b']);
    calls.length = 0;
    draw(edited, context({ zoom: 2, liveZoom: 2, hidden: new Set(['a', 'b']), colours: { ...colours } }));
    expect(calls).toEqual(['a', 'b']);
  });

  it('leaves a board as it was: its items (no sameInAndOut) are all made for a new zoom, whatever is listed hidden', () => {
    const { calls, zooms, draw } = setup();
    const board = Array.from({ length: 10 }, (_, i) => item(`b${String(i)}`, i * 10));
    draw(board, context({ zoom: 0.3, liveZoom: 0.3 }));
    calls.length = 0;
    draw(board, context({ zoom: 4, liveZoom: 4, hidden: new Set(board.slice(4).map((b) => b.id)), catchUp: 0 }));
    expect(calls).toEqual(board.map((b) => b.id));
    expect(zooms.b9).toBe(4);
  });

  it('makes all 300 of a board’s items in the settle’s render, a slice asked for or not, and leaves nothing waiting', () => {
    const { made, calls, draw } = setup();
    const board = Array.from({ length: 300 }, (_, i) => item(`b${String(i)}`, i * 10));
    draw(board, context({ zoom: 0.3, liveZoom: 0.3 }));
    for (const catchUp of [0, SLICE]) {
      calls.length = 0;
      const zoom = catchUp === 0 ? 4 : 2;
      draw(board, context({ zoom, liveZoom: zoom, catchUp, centre: { x: 0, y: 0 } }));
      expect(calls).toHaveLength(300);
      expect(staleFor(made, zoom)).toBe(0);
    }
  });
});
