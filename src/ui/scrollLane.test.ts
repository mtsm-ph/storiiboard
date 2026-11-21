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
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
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

describe('watchLane measures the overflow without the lane', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** An area inside the scroller, scrolled sideways, whose reach is shorter while the scroller has no lane. */
  interface Inner {
    isConnected: boolean;
    scrollTop: number;
    scrollLeft: number;
    /** How many times the code wrote its position. */
    writes: number;
    /** The browser's own pull back, at a layout: never counted as a write. */
    clamp: (reach: number) => void;
  }

  /** A scroller around the one watched, scrolled down to `top`: it reaches less far when the one inside gets shorter. */
  interface Outer {
    parentElement: null;
    scrollLeft: number;
    scrollTop: number;
    writes: number;
    clamp: (reach: number) => void;
  }

  function outer(top: number): Outer {
    let at = top;
    const area: Outer = {
      parentElement: null,
      scrollLeft: 0,
      writes: 0,
      get scrollTop() {
        return at;
      },
      set scrollTop(value: number) {
        area.writes += 1;
        at = value;
      },
      clamp: (reach: number) => {
        at = Math.min(at, reach);
      },
    };
    return area;
  }

  /**
   * A scroller 400 px high whose content is `content.height(lane)` px high, so a test can make the lane's own room push
   * it taller, as a lane that makes a line wrap does. `resize()` is a resize observer's call followed by the frame it
   * asks for; `observe()` is the observer's call alone and `frame()` the frame alone, so a test can change the box in
   * between, as a drag does; `box()` changes the scroller's own box. The scroll
   * position is pulled back as a browser pulls it when the content gets shorter, and so is each area made by `inner()`:
   * without the lane it is 16 px wider, so it reaches 16 px less far.
   */
  function scroller(
    content: { height: (lane: string | null) => number },
    options: {
      overflowX?: string;
      scrollWidth?: number;
      paddingBottom?: (lane: string | null) => number;
      /** A scroller around this one, and how far it reaches with each lane on this one. */
      parent?: { area: Outer; reach: (lane: string | null) => number };
      /** The scroller's height inside, 400 unless given. */
      clientHeight?: number;
    } = {},
  ) {
    const boxHeight = options.clientHeight ?? 400;
    const frames: FrameRequestCallback[] = [];
    const resized: ((entries: { target: unknown }[]) => void)[] = [];
    const mutated: ((records: unknown[]) => void)[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: (entries: { target: unknown }[]) => void) {
          resized.push(callback);
        }
        observe() {
          return undefined;
        }
        disconnect() {
          return undefined;
        }
      },
    );
    vi.stubGlobal(
      'MutationObserver',
      class {
        constructor(callback: (records: unknown[]) => void) {
          mutated.push(callback);
        }
        observe() {
          return undefined;
        }
        disconnect() {
          return undefined;
        }
      },
    );
    const attributes = new Map<string, string>();
    const laneNow = () => attributes.get('data-scroll-lane') ?? null;
    /** Every write of the lane attribute, in order: its value, or 'removed'. */
    const writes: string[] = [];
    // The style is read live, as a browser's is: the bottom padding follows the lane.
    vi.stubGlobal('getComputedStyle', () => ({
      display: 'block',
      overflowX: options.overflowX ?? 'hidden',
      overflowY: 'auto',
      get paddingBottom() {
        return `${String(options.paddingBottom?.(laneNow()) ?? 0)}px`;
      },
    }));
    const lanes: (string | null)[] = [];
    const scrollListeners: ((event: { target: unknown }) => void)[] = [];
    const inners: { area: Inner; reach: (lane: string | null) => number }[] = [];
    let top = 0;
    let rect = { width: 300, height: boxHeight };
    /** Times the content was read without the lane: the lane taken off (or 'both' made 'x') and put back within one
     *  measure. */
    let bareReadings = 0;
    let off = false;
    const height = () => content.height(laneNow());
    // Each change of the lane lays the content out again, pulling every position back that no longer reaches.
    const relayout = () => {
      const lane = laneNow();
      top = Math.min(top, Math.max(0, height() - boxHeight));
      for (const { area, reach } of inners) area.clamp(reach(lane));
      options.parent?.area.clamp(options.parent.reach(lane));
    };
    const element = {
      children: [],
      parentElement: options.parent?.area ?? null,
      scrollWidth: options.scrollWidth ?? 300,
      clientWidth: 300,
      clientHeight: boxHeight,
      scrollLeft: 0,
      get scrollHeight() {
        return height();
      },
      get scrollTop() {
        return top;
      },
      set scrollTop(value: number) {
        top = Math.min(value, Math.max(0, height() - boxHeight));
      },
      getBoundingClientRect: () => rect,
      getAttribute: (name: string) => attributes.get(name) ?? null,
      setAttribute: (name: string, value: string) => {
        if (off) bareReadings += 1;
        // 'both' made 'x' is the reading of the lane up and down with the sideways one kept.
        off = value === 'x' && attributes.get(name) === 'both';
        writes.push(value);
        attributes.set(name, value);
        relayout();
      },
      removeAttribute: (name: string) => {
        if (attributes.has(name)) off = true;
        writes.push('removed');
        attributes.delete(name);
        relayout();
      },
      addEventListener: (type: string, listener: (event: { target: unknown }) => void) => {
        if (type === 'scroll') scrollListeners.push(listener);
      },
      removeEventListener: () => undefined,
    };
    const frame = () => {
      for (const callback of frames.splice(0)) callback(0);
      // A lane taken off and not put back in the same measure was dropped, not read without.
      off = false;
      lanes.push(laneNow());
    };
    /** A resize observer's call after a frame's layout, reporting the scroller's own box as it is then. */
    const observe = () => {
      for (const callback of resized) callback([{ target: element }]);
    };
    const stop = watchLane(element as unknown as HTMLElement);
    frame();
    return {
      element,
      stop,
      /** The lane after each measure so far. */
      lanes,
      readings: () => bareReadings,
      /** Every write of the lane attribute so far. */
      writes,
      frame,
      observe,
      /** The scroller's children replaced (a view switch): the children observer's call, then the frame it asks for. */
      replaceChildren: () => {
        for (const callback of mutated) callback([]);
        frame();
      },
      resize: () => {
        observe();
        frame();
      },
      box: (width: number, boxHeight = 400) => {
        rect = { width, height: boxHeight };
      },
      /** An area inside, scrolled to `left` by a person: its scroll event seen on the way down. */
      inner: (left: number, reach: (lane: string | null) => number): Inner => {
        let at = left;
        const area: Inner = {
          isConnected: true,
          scrollTop: 0,
          writes: 0,
          get scrollLeft() {
            return at;
          },
          set scrollLeft(value: number) {
            area.writes += 1;
            at = value;
          },
          clamp: (max: number) => {
            at = Math.min(at, max);
          },
        };
        inners.push({ area, reach });
        for (const listener of scrollListeners) listener({ target: area });
        return area;
      },
    };
  }

  it('takes the lane while the content overflows without it, and drops it after a change of size once the content fits without it', () => {
    const content: { height: (lane: string | null) => number } = { height: (lane) => (lane === null ? 600 : 640) };
    const s = scroller(content);
    expect(s.lanes).toEqual(['y']);
    // The tile widens and its content shrinks: it fits without the lane (400 px), but with the lane's room it wraps to
    // 440 px. The lane goes in the frame after the new size.
    content.height = (lane) => (lane === null ? 400 : 440);
    s.box(320);
    s.resize();
    expect(s.lanes.at(-1)).toBeNull();
    s.stop();
  });

  it('takes no lane where the content fits without it, though the lane would make it overflow (the latch of round 6b)', () => {
    // On, overflowing either way; then the tile changes size and the content fits without the lane, though not with it.
    const content: { height: (lane: string | null) => number } = { height: (lane) => (lane === null ? 600 : 640) };
    const s = scroller(content);
    content.height = (lane) => (lane === null ? 380 : 420);
    // Changed again before the next frame (a drag), then held.
    s.observe();
    s.box(320);
    s.frame();
    s.resize();
    s.resize();
    // Kept while the size changes, gone once it held, and never back.
    expect(s.lanes).toEqual(['y', 'y', null, null]);
    s.stop();
  });

  it('never flips at the boundary: a content exactly as high as the scroller takes none, a pixel more takes it and keeps it', () => {
    // Each starts with the lane on, from content that overflowed, and is then resized to content the lane changes.
    const fitsContent: { height: (lane: string | null) => number } = { height: (lane) => (lane === null ? 600 : 630) };
    const fits = scroller(fitsContent);
    fitsContent.height = (lane) => (lane === null ? 400 : 430);
    fits.observe();
    fits.box(320);
    fits.frame();
    for (let i = 0; i < 5; i += 1) fits.resize();
    expect(fits.lanes).toEqual(['y', 'y', null, null, null, null, null]);
    fits.stop();
    const overContent: { height: (lane: string | null) => number } = { height: (lane) => (lane === null ? 600 : 630) };
    const over = scroller(overContent);
    overContent.height = (lane) => (lane === null ? 401 : 431);
    over.observe();
    over.box(320);
    over.frame();
    for (let i = 0; i < 5; i += 1) over.resize();
    expect(over.lanes).toEqual(['y', 'y', 'y', 'y', 'y', 'y', 'y']);
    over.stop();
  });

  it('holds the lane where the content answers it a measure later, as the keys line does, and lets it go at a new size', () => {
    // A line shown only where it fits: shown while there is no lane, hidden under the lane, each a measure after the
    // lane changed. Shown, the content overflows; hidden, it fits.
    let shown = true;
    const s = scroller({ height: () => (shown ? 420 : 380) });
    for (let i = 0; i < 6; i += 1) {
      shown = s.lanes.at(-1) === null;
      s.resize();
    }
    // On; off once the line went; back on, and held, once the line came back: no flicker after that.
    expect(s.lanes).toEqual(['y', null, 'y', 'y', 'y', 'y', 'y']);
    // A new size lets the hold go; the content is read again there.
    s.box(320);
    shown = false;
    s.resize();
    s.frame();
    expect(s.lanes.at(-1)).toBeNull();
    s.stop();
  });

  it('reads without the lane once a resize has held for a frame: a drag takes one reading, and a change of content none', () => {
    const content: { height: (lane: string | null) => number } = { height: (lane) => (lane === null ? 600 : 640) };
    const s = scroller(content);
    expect(s.lanes).toEqual(['y']);
    // The content changes, the box doesn't: read with the lane on.
    content.height = (lane) => (lane === null ? 700 : 740);
    s.resize();
    s.resize();
    expect(s.readings()).toBe(0);
    // A 30-step drag: the box an observer saw after each frame's layout has changed again by the next frame. No reading
    // while it moves.
    for (let step = 1; step <= 30; step += 1) {
      s.observe();
      s.box(300 + step);
      s.frame();
    }
    expect(s.readings()).toBe(0);
    // It stops: one reading in the frame after, and none after that.
    s.frame();
    expect(s.readings()).toBe(1);
    s.resize();
    s.frame();
    expect(s.readings()).toBe(1);
    expect(s.lanes.at(-1)).toBe('y');
    // One change of size that holds: read in the frame after it.
    s.box(360);
    s.resize();
    expect(s.readings()).toBe(2);
    s.stop();
  });

  it('leaves the scroll position where it was after reading the content without the lane', () => {
    const s = scroller({ height: (lane) => (lane === null ? 500 : 700) });
    expect(s.lanes).toEqual(['y']);
    // Scrolled near the end: without the lane the content is shorter, and a browser would pull the position back to 100.
    s.element.scrollTop = 280;
    // A change of size, so the content is read without the lane once it holds.
    s.box(320);
    s.resize();
    expect(s.readings()).toBe(1);
    expect(s.lanes.at(-1)).toBe('y');
    expect(s.element.scrollTop).toBe(280);
    s.stop();
  });

  it('reads once without the lane when the content alone shrinks into the band and holds for a frame, and drops it', () => {
    // A 400 px box; the content ends 380 px down without the lane, 420 with it: it fits only without the lane.
    const content: { height: (lane: string | null) => number } = { height: (lane) => (lane === null ? 600 : 640) };
    const s = scroller(content);
    // The lane's own change resizes the content, and the browser reports it: that measure sets where the content was.
    s.resize();
    expect(s.lanes).toEqual(['y', 'y']);
    // Frames trashed: the content shrinks, the box doesn't. Read with the lane on first, so it stays a frame.
    content.height = (lane) => (lane === null ? 380 : 420);
    s.resize();
    expect(s.readings()).toBe(0);
    expect(s.lanes.at(-1)).toBe('y');
    // The smaller size has held for a frame: one reading without the lane, and the lane goes.
    s.frame();
    expect(s.readings()).toBe(1);
    expect(s.lanes.at(-1)).toBeNull();
    s.resize();
    s.resize();
    expect(s.readings()).toBe(1);
    expect(s.lanes.slice(-2)).toEqual([null, null]);
    s.stop();
  });

  it('reads nothing more when the content alone grows, into the band or past it, and keeps the lane', () => {
    // Content that grows past the band, the lane on: no reading at all.
    const tall: { height: (lane: string | null) => number } = { height: (lane) => (lane === null ? 600 : 640) };
    const s = scroller(tall);
    s.resize();
    tall.height = (lane) => (lane === null ? 700 : 740);
    s.resize();
    s.frame();
    expect(s.readings()).toBe(0);
    expect(s.lanes.at(-1)).toBe('y');
    s.stop();
    // Into the band: the lane is on with the content shorter than the box only while it is held (a line that shows
    // only without the lane, as the keys line does), and growth from there into the band reads nothing either.
    const band: { height: (lane: string | null) => number } = { height: (lane) => (lane === null ? 600 : 640) };
    const h = scroller(band);
    band.height = () => 390;
    h.resize();
    band.height = () => 420;
    h.resize();
    expect(h.lanes).toEqual(['y', null, 'y']);
    band.height = () => 360;
    h.resize();
    h.frame();
    expect(h.lanes.at(-1)).toBe('y');
    const before = h.readings();
    band.height = (lane) => (lane === null ? 380 : 420);
    h.resize();
    h.frame();
    h.resize();
    expect(h.readings()).toBe(before);
    expect(h.lanes.slice(-3)).toEqual(['y', 'y', 'y']);
    h.stop();
  });

  it('never takes a sideways lane off to read: its room up and down is taken away by arithmetic, and nothing moves', () => {
    // A table scrolling sideways in a 400 px box: 390 px high, 406 with the lane's bottom padding (its own is 0).
    const content: { height: (lane: string | null) => number } = { height: (lane) => (lane === 'x' ? 406 : 390) };
    const s = scroller(content, { overflowX: 'auto', scrollWidth: 900, paddingBottom: (lane) => (lane === 'x' ? 16 : 0) });
    expect(s.lanes).toEqual(['x']);
    s.resize();
    // A change of size that holds, and the content shrinking: still the sideways lane alone, and never read without it.
    s.box(320);
    s.resize();
    s.frame();
    content.height = (lane) => (lane === 'x' ? 396 : 380);
    s.resize();
    s.frame();
    expect(s.readings()).toBe(0);
    expect(s.lanes.every((lane) => lane === 'x')).toBe(true);
    s.stop();
  });

  it('puts back the position of a scroller around it that a reading without the lane pulled back', () => {
    // The scroller's height follows its content, so without the lane the one around it is shorter and reaches less far.
    const around = outer(500);
    const s = scroller({ height: (lane) => (lane === null ? 500 : 700) }, { parent: { area: around, reach: (lane) => (lane === null ? 300 : 500) } });
    s.box(320);
    s.resize();
    expect(s.readings()).toBe(1);
    expect(around.scrollTop).toBe(500);
    expect(around.writes).toBe(1);
    s.stop();
  });

  it('puts the scroller’s own position and each area inside back where a reading without the lane pulled them, and writes no other', () => {
    const s = scroller({ height: (lane) => (lane === null ? 500 : 700) });
    s.element.scrollTop = 280;
    // A table scrolled to its right end (it reaches 100 px with the lane, 84 without), and a list scrolled halfway.
    const table = s.inner(100, (lane) => (lane === null ? 84 : 100));
    const list = s.inner(50, () => 200);
    s.box(320);
    s.resize();
    s.frame();
    expect(s.readings()).toBe(1);
    expect(s.lanes.at(-1)).toBe('y');
    expect(s.element.scrollTop).toBe(280);
    expect(table.scrollLeft).toBe(100);
    // The list never moved: nothing written to it.
    expect(list.writes).toBe(0);
    s.stop();
  });

  it('reads once without the lane after its children are replaced, though the new content is taller, and drops it (round 6e)', () => {
    // The Shot list in a 600 px box, 620 px high with the lane: it overflows either way.
    const content: { height: (lane: string | null) => number } = { height: () => 620 };
    const s = scroller(content, { clientHeight: 600 });
    s.resize();
    expect(s.lanes).toEqual(['y', 'y']);
    // Switched to the Grid: 670 px with the lane, which takes a column away; 450 without it, where it fits.
    content.height = (lane) => (lane === null ? 450 : 670);
    s.replaceChildren();
    expect(s.readings()).toBe(0);
    expect(s.lanes.at(-1)).toBe('y');
    // The new size has held for a frame: one reading without the lane, and the lane goes.
    s.frame();
    expect(s.readings()).toBe(1);
    expect(s.lanes.at(-1)).toBeNull();
    s.resize();
    expect(s.readings()).toBe(1);
    expect(s.lanes.at(-1)).toBeNull();
    s.stop();
  });

  it('takes no reading for a shrink while the lane up and down is held at this box (round 6e)', () => {
    // A line shown only without the lane, as the Layers tile's keys line: on, off, back on and held.
    let shown = true;
    const content: { height: (lane: string | null) => number } = { height: () => (shown ? 420 : 380) };
    const s = scroller(content);
    for (let i = 0; i < 4; i += 1) {
      shown = s.lanes.at(-1) === null;
      s.resize();
    }
    expect(s.lanes).toEqual(['y', null, 'y', 'y', 'y']);
    const before = s.readings();
    // The content shrinks with the lane held on: nothing to read, and the lane stays.
    content.height = () => 360;
    s.resize();
    s.frame();
    s.frame();
    expect(s.readings()).toBe(before);
    expect(s.lanes.slice(-3)).toEqual(['y', 'y', 'y']);
    s.stop();
  });

  it('reads both lanes with the sideways one kept on, and takes away only the room it adds to the scroller’s own padding (round 6e)', () => {
    // Its own bottom padding 8, the sideways lane's 16; 396 px of content in a 400 px box. Without any lane it ends
    // 404 px down and overflows; with the sideways lane 412. Taking away the lane's whole 16 would read 396 and fit.
    const content: { height: (lane: string | null) => number } = {
      height: (lane) => (lane === 'both' ? 440 : lane === 'x' ? 412 : lane === 'y' ? 432 : 404),
    };
    const s = scroller(content, { overflowX: 'auto', scrollWidth: 900, paddingBottom: (lane) => (lane === 'x' || lane === 'both' ? 16 : 8) });
    expect(s.lanes).toEqual(['both']);
    const start = s.writes.length;
    // A change of size that holds: one reading, the attribute 'x' during it, never taken off.
    s.box(320);
    s.resize();
    expect(s.readings()).toBe(1);
    expect(s.writes.slice(start)).toEqual(['x', 'both']);
    expect(s.lanes.at(-1)).toBe('both');
    s.stop();
  });
});
