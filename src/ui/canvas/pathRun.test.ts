import { describe, expect, it } from 'vitest';
import { nextPoint, NO_MODS, runClick, runKey, runPoints, runStart, toolEndsRun, type PathDraft, type PathSnap } from './pathRun';
import type { GridSpec } from './types';

// A run drawn point to point (6.2a, a plan's walls), step by step as the canvas takes them: what Escape, Enter, a
// typed length, the arrows, Backspace and Delete, a double-click, Shift, another tool and leaving the view do to it.
// World units are a plan's centimetres here; a typed length is read as metres.

const GRID: GridSpec = { step: 50, major: 2, fine: 5 };
const snap: PathSnap = { ends: [], grid: GRID, zoom: 1 };
const parse = (text: string): number | null => {
  const m = /^(\d+(?:\.\d+)?)\s*m$/.exec(text.trim());
  return m ? Number(m[1]) * 100 : null;
};
const key = (k: string, mods: { metaKey?: boolean; ctrlKey?: boolean } = {}) => ({ key: k, metaKey: false, ctrlKey: false, ...mods });

/** A run with points fixed at these places, the pointer at `cursor`. */
const runAt = (points: { x: number; y: number }[], cursor: { x: number; y: number } | null = null): PathDraft => ({ tool: 'host:wall', points, cursor, angle: 0, typed: '' });

/** Keys pressed one after another; returns the run, or what ended it. */
function press(run: PathDraft, keys: string[]): { run: PathDraft | null; finished: boolean } {
  let now: PathDraft | null = run;
  for (const k of keys) {
    if (!now) break;
    const result = runKey(now, key(k), parse);
    if (!result) continue;
    if (result.kind === 'finish') return { run: now, finished: true };
    if (result.kind === 'run' || result.kind === 'taken') now = result.run;
  }
  return { run: now, finished: false };
}

describe('a run’s keys', () => {
  it('Escape finishes the run with only its fixed points, never where the pointer is', () => {
    const run = runAt([{ x: 0, y: 0 }, { x: 300, y: 0 }], { x: 300, y: 250 });
    expect(runKey(run, key('Escape'), parse)).toEqual({ kind: 'finish' });
    expect(runPoints(run)).toEqual([{ x: 0, y: 0 }, { x: 300, y: 0 }]);
    // Escape with a length typed only clears what was typed.
    expect(runKey({ ...run, typed: '3' }, key('Escape'), parse)).toEqual({ kind: 'run', run: { ...run, typed: '' } });
    // One point is no wall: nothing to write.
    expect(runPoints(runAt([{ x: 0, y: 0 }]))).toBeNull();
  });

  it('draws from the keyboard: Enter starts, the arrows set the direction, a typed length adds a segment, Enter finishes', () => {
    const start = runStart('host:wall', { x: 0, y: 0 }, null);
    const { run, finished } = press(start, ['ArrowRight', '3', '.', '5', ' ', 'm', 'Enter', 'ArrowDown', '2', 'm', 'Enter', 'Enter']);
    expect(finished).toBe(true);
    expect(runPoints(run)).toEqual([
      { x: 0, y: 0 },
      { x: 350, y: 0 },
      { x: 350, y: 200 },
    ]);
  });

  it('refuses a typed length it can’t read, and keeps the run as it was', () => {
    const run = { ...runAt([{ x: 0, y: 0 }]), typed: '3 parsecs' };
    expect(runKey(run, key('Enter'), parse)).toEqual({ kind: 'refused', typed: '3 parsecs' });
  });

  it('takes the last point off with Backspace or Delete, swallows them always, and never deletes anything', () => {
    const run = runAt([{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 200 }]);
    for (const k of ['Backspace', 'Delete']) {
      const result = runKey(run, key(k), parse);
      expect(result).toMatchObject({ kind: 'run', run: { points: [{ x: 0, y: 0 }, { x: 300, y: 0 }] } });
      // With ⌘ or Ctrl too: never the delete command while a run is on.
      expect(runKey(run, key(k, { ctrlKey: true }), parse)?.kind).toBe('run');
      expect(runKey(run, key(k, { metaKey: true }), parse)?.kind).toBe('run');
    }
    // While a length is typed, Backspace takes its last character.
    expect(runKey({ ...run, typed: '3.5' }, key('Backspace'), parse)).toMatchObject({ kind: 'run', run: { typed: '3.', points: run.points } });
    // The only point taken off drops the run: nothing written.
    expect(runKey(runAt([{ x: 0, y: 0 }]), key('Backspace'), parse)).toEqual({ kind: 'run', run: null });
  });

  it('keeps an arrow from nudging while a length is typed, and leaves other keys to the canvas', () => {
    const run = { ...runAt([{ x: 0, y: 0 }]), typed: '3' };
    expect(runKey(run, key('ArrowUp'), parse)).toEqual({ kind: 'run', run });
    expect(runKey(runAt([{ x: 0, y: 0 }]), key('z', { metaKey: true }), parse)).toBeNull();
    expect(runKey(runAt([{ x: 0, y: 0 }]), key('Tab'), parse)).toBeNull();
  });
});

describe('a run’s clicks', () => {
  /** A press during a run that must fix a point (not a double-click's second). */
  const clicked = (run: PathDraft, at: { x: number; y: number }, press: { time: number; x: number; y: number }, zoom = 1): PathDraft => {
    const next = runClick(run, at, zoom, press);
    if (next === 'double') throw new Error('read as a double-click');
    return next;
  };

  it('fixes a point with each click, and knows a double-click’s second press by its time and place, not by `detail`', () => {
    // Started by a press at screen (100, 100), at 1000 ms.
    const run = runStart('host:wall', { x: 0, y: 0 }, { x: 0, y: 0 }, { time: 1000, x: 100, y: 100 });
    // A second click 2 s later and 300 px away: a point.
    const two = clicked(run, { x: 300, y: 0 }, { time: 3000, x: 400, y: 100 });
    expect(two.points).toEqual([{ x: 0, y: 0 }, { x: 300, y: 0 }]);
    // The second press of a double-click, 120 ms later and 4 px off: no point, however it jittered; the run ends.
    expect(runClick(two, { x: 304, y: 2 }, 1, { time: 3120, x: 404, y: 100 })).toBe('double');
    // As far off as 6 px, at as much as 500 ms: still the double-click's.
    expect(runClick(two, { x: 306, y: 0 }, 1, { time: 3500, x: 406, y: 100 })).toBe('double');
    // Later than 500 ms, or further than 6 px: a click of its own, which fixes a point.
    expect(clicked(two, { x: 304, y: 0 }, { time: 3501, x: 404, y: 100 }).points).toHaveLength(3);
    expect(clicked(two, { x: 307, y: 0 }, { time: 3100, x: 407, y: 100 }).points).toHaveLength(3);
    // A click where the last point is (but not soon enough to be a double-click's) adds nothing, and is remembered.
    const same = clicked(two, { x: 300.5, y: 0 }, { time: 5000, x: 400, y: 100 });
    expect(same.points).toEqual(two.points);
    expect(same.press).toEqual({ time: 5000, x: 400, y: 100 });
    // A run started from the keyboard has no press before: its first click is never a double-click's second.
    expect(clicked(runStart('host:wall', { x: 0, y: 0 }, null), { x: 300, y: 0 }, { time: 10, x: 0, y: 0 }).points).toHaveLength(2);
  });

  it('holds Shift’s direction to 15° steps from the last point', () => {
    const run = runAt([{ x: 0, y: 0 }]);
    // 100 along, 20 down is 11.3°: Shift turns it to 15°, its length kept.
    const p = nextPoint({ x: 100, y: 20 }, { ...NO_MODS, shiftKey: true }, run, snap);
    const length = Math.hypot(100, 20);
    expect(p.x).toBeCloseTo(Math.cos(Math.PI / 12) * length, 1);
    expect(p.y).toBeCloseTo(Math.sin(Math.PI / 12) * length, 1);
    // 100 along, 5 down: 0°.
    expect(nextPoint({ x: 100, y: 5 }, { ...NO_MODS, shiftKey: true }, run, snap).y).toBe(0);
  });

  it('joins a nearby end, else snaps to the grid, and with Ctrl neither', () => {
    const withEnd: PathSnap = { ...snap, ends: [{ x: 207, y: 93 }] };
    expect(nextPoint({ x: 203, y: 96 }, NO_MODS, null, withEnd)).toEqual({ x: 207, y: 93 });
    expect(nextPoint({ x: 153, y: 98 }, NO_MODS, null, snap)).toEqual({ x: 150, y: 100 });
    expect(nextPoint({ x: 203, y: 96 }, { ...NO_MODS, ctrlKey: true }, null, withEnd)).toEqual({ x: 203, y: 96 });
  });
});

describe('a run’s end', () => {
  it('ends when another tool is picked, not when its own is', () => {
    const run = runAt([{ x: 0, y: 0 }, { x: 300, y: 0 }]);
    expect(toolEndsRun(run, 'select')).toBe(true);
    expect(toolEndsRun(run, 'host:door')).toBe(true);
    expect(toolEndsRun(run, 'host:wall')).toBe(false);
    expect(toolEndsRun(null, 'select')).toBe(false);
  });

  it('leaving the view writes the same points Escape would', () => {
    // The canvas going away (another view picked) hands the host runPoints, as Escape does.
    const run = runAt([{ x: 0, y: 0 }, { x: 300, y: 0 }], { x: 300, y: 400 });
    expect(runKey(run, key('Escape'), parse)).toEqual({ kind: 'finish' });
    expect(runPoints(run)).toEqual(run.points);
  });
});
