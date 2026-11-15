import { describe, expect, it } from 'vitest';
import { elementsFor, type ItemContext, type MadeFor } from './itemCache';
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

  it('is made again for a new zoom, as every item is', () => {
    const { calls, zooms, draw } = setup();
    const plan = { ...item('plan'), sameInAndOut: true };
    draw([plan], context());
    draw([plan], context({ zoom: 2, liveZoom: 2, away: new Set(['plan']) }));
    expect(calls).toEqual(['plan', 'plan']);
    expect(zooms.plan).toBe(2);
  });
});
