import { afterEach, describe, expect, it, vi } from 'vitest';
import { barsOverlay, laneAttribute, nextLane, NO_LANE, SCROLLBARS_ATTRIBUTE, watchLane, writeReading, type LaneMeasure, type LaneState } from './scrollLane';

const measure = (over: Partial<LaneMeasure> = {}): LaneMeasure => ({ overlay: true, overflowX: false, overflowY: false, box: '300x400', ...over });

/** Runs the rule over a sequence of measures, from no lane. */
function run(...measures: LaneMeasure[]): LaneState {
  return measures.reduce(nextLane, NO_LANE);
}

describe('barsOverlay', () => {
  it('reads overlay when a scrolling box is as wide inside as outside', () => {
    expect(barsOverlay(100, 100)).toBe(true);
  });

  it('reads classic bars when the bar takes room of its own', () => {
    expect(barsOverlay(100, 85)).toBe(false);
    expect(barsOverlay(100, 99)).toBe(false);
  });

  it('says nothing for a box with no width (no layout)', () => {
    expect(barsOverlay(0, 0)).toBe(false);
  });
});

describe('writeReading', () => {
  /** A root that counts its writes. */
  function fakeRoot() {
    const attributes = new Map<string, string>();
    const root = {
      writes: 0,
      getAttribute: (name: string) => attributes.get(name) ?? null,
      setAttribute: (name: string, value: string) => {
        root.writes += 1;
        attributes.set(name, value);
      },
      removeAttribute: (name: string) => {
        root.writes += 1;
        attributes.delete(name);
      },
    };
    return root;
  }

  it('writes the attribute when the answer changes, and nothing for a second reading with the same answer', () => {
    const root = fakeRoot();
    expect(writeReading(root, true)).toBe(true);
    expect(root.getAttribute(SCROLLBARS_ATTRIBUTE)).toBe('overlay');
    expect(writeReading(root, true)).toBe(false);
    expect(root.writes).toBe(1);
    expect(writeReading(root, false)).toBe(true);
    expect(root.getAttribute(SCROLLBARS_ATTRIBUTE)).toBeNull();
    expect(writeReading(root, false)).toBe(false);
    expect(root.writes).toBe(2);
  });

  it('writes nothing for classic bars on a root that has no attribute', () => {
    const root = fakeRoot();
    expect(writeReading(root, false)).toBe(false);
    expect(root.writes).toBe(0);
  });
});

describe('nextLane', () => {
  it('takes a lane up and down while the content overflows that way', () => {
    const state = run(measure({ overflowY: true }));
    expect(laneAttribute(state)).toBe('y');
  });

  it('takes a lane sideways while the content overflows sideways', () => {
    expect(laneAttribute(run(measure({ overflowX: true })))).toBe('x');
  });

  it('takes both lanes when the content overflows both ways', () => {
    expect(laneAttribute(run(measure({ overflowX: true, overflowY: true })))).toBe('both');
  });

  it('takes none where the content fits', () => {
    expect(laneAttribute(run(measure()))).toBeNull();
  });

  it('takes none with classic bars, however the content overflows, and drops one it had', () => {
    expect(laneAttribute(run(measure({ overlay: false, overflowX: true, overflowY: true })))).toBeNull();
    expect(laneAttribute(run(measure({ overflowY: true }), measure({ overlay: false, overflowY: true })))).toBeNull();
  });

  it('drops the lane once the content fits again', () => {
    const state = run(measure({ overflowY: true }), measure({ overflowY: false }));
    expect(laneAttribute(state)).toBeNull();
  });

  it('puts the lane back and keeps it while the box is the same, when taking it away made the content overflow', () => {
    // On, then off because the content fit with the lane, then overflowing again only because the lane went.
    const back = run(measure({ overflowY: true }), measure({ overflowY: false }), measure({ overflowY: true }));
    expect(laneAttribute(back)).toBe('y');
    // Held: even where the content would fit with it, the lane stays while the box doesn't change.
    const held = nextLane(back, measure({ overflowY: false }));
    expect(laneAttribute(held)).toBe('y');
    expect(laneAttribute(nextLane(held, measure({ overflowY: false })))).toBe('y');
  });

  it('lets a held lane go once the box changes', () => {
    const held = run(measure({ overflowY: true }), measure({ overflowY: false }), measure({ overflowY: true }), measure({ overflowY: false }));
    expect(laneAttribute(held)).toBe('y');
    expect(laneAttribute(nextLane(held, measure({ overflowY: false, box: '320x400' })))).toBeNull();
  });

  it('holds nothing when the content overflows again after the box changed', () => {
    // Off at one box, overflowing at another: an ordinary lane, dropped as soon as the content fits.
    const state = run(measure({ overflowY: true }), measure({ overflowY: false }), measure({ overflowY: true, box: '320x400' }));
    expect(laneAttribute(state)).toBe('y');
    expect(laneAttribute(nextLane(state, measure({ overflowY: false, box: '320x400' })))).toBeNull();
  });

  it('holds only an overflow on the very next measure after the drop: on, off, off, on is an ordinary lane', () => {
    const state = run(measure({ overflowY: true }), measure(), measure(), measure({ overflowY: true }));
    expect(laneAttribute(state)).toBe('y');
    // Not held: a later fit drops it again, at the same box.
    expect(laneAttribute(nextLane(state, measure()))).toBeNull();
  });

  it('holds the lane when the overflow comes back at once after the drop, at the same box', () => {
    const state = run(measure({ overflowY: true }), measure(), measure({ overflowY: true }));
    expect(state.y.heldAt).toBe('300x400');
    expect(laneAttribute(nextLane(state, measure()))).toBe('y');
  });

  it('holds each axis on its own', () => {
    const state = run(measure({ overflowX: true }), measure(), measure({ overflowX: true }), measure({ overflowY: true }));
    expect(laneAttribute(state)).toBe('both');
    expect(laneAttribute(nextLane(state, measure()))).toBe('x');
  });
});

describe('watchLane', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** A scroller with one child, in a page whose frames, observers and computed style the test drives. */
  function page() {
    const frames: FrameRequestCallback[] = [];
    const observed: unknown[] = [];
    const styleReads: unknown[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(target: unknown) {
          observed.push(target);
        }
        disconnect() {
          observed.length = 0;
        }
      },
    );
    vi.stubGlobal(
      'MutationObserver',
      class {
        observe() {
          return undefined;
        }
        disconnect() {
          return undefined;
        }
      },
    );
    vi.stubGlobal('getComputedStyle', (target: unknown) => {
      styleReads.push(target);
      return { display: 'block', overflowX: 'hidden', overflowY: 'auto' };
    });
    const attributes = new Map<string, string>();
    const child = { tag: 'child' };
    const scroller = {
      children: [child],
      scrollWidth: 300,
      clientWidth: 300,
      scrollHeight: 600,
      clientHeight: 400,
      getBoundingClientRect: () => ({ width: 300, height: 400 }),
      getAttribute: (name: string) => attributes.get(name) ?? null,
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      removeAttribute: (name: string) => attributes.delete(name),
    };
    return { frames, observed, styleReads, child, scroller, attributes };
  }

  it('reads nothing from the page while it starts, only in the next frame (WebKit then drops a dialog field’s focus)', () => {
    const p = page();
    const stop = watchLane(p.scroller as unknown as HTMLElement);
    // Started inside a component's effects: no computed style read there, none of the children's either.
    expect(p.styleReads).toEqual([]);
    expect(p.frames).toHaveLength(1);
    p.frames[0]?.(0);
    // In the frame: the child is watched, and the lane is taken, since the content overflows up and down.
    expect(p.styleReads).toContain(p.child);
    expect(p.observed).toEqual([p.scroller, p.child]);
    expect(p.attributes.get('data-scroll-lane')).toBe('y');
    stop();
    expect(p.attributes.has('data-scroll-lane')).toBe(false);
  });
});
