import { describe, expect, it } from 'vitest';
import { loadSettings, loadTrackpadMode, saveTrackpadMode, TRACKPAD_MODE_KEY, trackpadModeOf } from '../../core/storage/settings';
import { isPinchWheel, WHEEL_NOTCH_STEP, WHEEL_ZOOM, wheelAction, type WheelAction, type WheelInput } from './wheel';

// Trackpad mode (6.5.3, Kevin, Nov 16): the one reader of the setting, by platform, and what a wheel does in each mode.

const memory = () => {
  const kept = new Map<string, string>();
  return { kept, storage: { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) } };
};

describe('trackpadModeOf', () => {
  it('reads never chosen as on on a Mac and off elsewhere', () => {
    expect(trackpadModeOf(null, 'mac')).toBe(true);
    expect(trackpadModeOf(null, 'windows')).toBe(false);
    expect(trackpadModeOf(null, 'other')).toBe(false);
  });

  it('keeps a choice whatever the platform', () => {
    for (const platform of ['mac', 'windows', 'other'] as const) {
      expect(trackpadModeOf(true, platform)).toBe(true);
      expect(trackpadModeOf(false, platform)).toBe(false);
    }
  });

  it('reads an odd stored value as never chosen', () => {
    for (const odd of [undefined, 'true', 'false', 0, 1, {}, [], 'on']) {
      expect(trackpadModeOf(odd, 'mac')).toBe(true);
      expect(trackpadModeOf(odd, 'windows')).toBe(false);
    }
  });

  it('is kept under its own key, read defensively, apart from the other settings', () => {
    const { kept, storage } = memory();
    expect(loadTrackpadMode(storage)).toBeNull();
    expect(loadTrackpadMode(undefined)).toBeNull();
    saveTrackpadMode(false, storage);
    expect(loadTrackpadMode(storage)).toBe(false);
    saveTrackpadMode(true, storage);
    expect(loadTrackpadMode(storage)).toBe(true);
    expect([...kept.keys()]).toEqual([TRACKPAD_MODE_KEY]);
    expect(loadSettings(storage)).not.toHaveProperty('trackpadMode');
    kept.set(TRACKPAD_MODE_KEY, '{not json');
    expect(loadTrackpadMode(storage)).toBeNull();
    kept.set(TRACKPAD_MODE_KEY, '"true"');
    expect(loadTrackpadMode(storage)).toBeNull();
    kept.set(TRACKPAD_MODE_KEY, '1');
    expect(loadTrackpadMode(storage)).toBeNull();
  });
});

const wheel = (fields: Partial<WheelInput>): WheelInput => ({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false, ...fields });
const zoomOf = (factor: number): WheelAction => ({ kind: 'zoom', factor });
const pan = (dx: number, dy: number): WheelAction => ({ kind: 'pan', dx, dy });

/** A Ctrl + mouse wheel notch, the key seen going down. */
const notch = wheel({ deltaY: 100, ctrlKey: true });
/** A pinch as Chromium sends it: ctrlKey with no key down, a small fractional delta. */
const pinch = wheel({ deltaY: -3.75, ctrlKey: true });

describe('wheelAction', () => {
  // [what, event, Control key seen down, trackpad mode on, mode off]
  const table: Array<[string, WheelInput, boolean, WheelAction, WheelAction]> = [
    ['a plain wheel notch', wheel({ deltaY: 100 }), false, pan(-0, -100), zoomOf(1 / WHEEL_NOTCH_STEP)],
    ['a plain wheel notch up', wheel({ deltaY: -120 }), false, pan(-0, 120), zoomOf(Math.pow(WHEEL_NOTCH_STEP, 1.2))],
    ['a two-finger scroll, mostly down', wheel({ deltaX: 12, deltaY: 30.5 }), false, pan(-12, -30.5), zoomOf(Math.pow(WHEEL_NOTCH_STEP, -0.305))],
    ['a notch with a little sideways', wheel({ deltaX: 5, deltaY: 100 }), false, pan(-5, -100), zoomOf(1 / WHEEL_NOTCH_STEP)],
    ['a sideways swipe with vertical jitter', wheel({ deltaX: 40, deltaY: 3 }), false, pan(-40, -3), pan(-40, 0)],
    ['a sideways swipe left with jitter up', wheel({ deltaX: -25.5, deltaY: -7.25 }), false, pan(25.5, 7.25), pan(25.5, 0)],
    ['a wheel in lines', wheel({ deltaY: 3, deltaMode: 1 }), false, pan(-0, -48), zoomOf(1 / WHEEL_NOTCH_STEP)],
    ['a sideways tilt', wheel({ deltaX: 100 }), false, pan(-100, -0), pan(-100, 0)],
    ['Ctrl + wheel notch', notch, true, zoomOf(Math.exp(-100 * WHEEL_ZOOM)), pan(0, -100)],
    ['Ctrl + wheel notch, the key missed', notch, false, zoomOf(Math.exp(-100 * WHEEL_ZOOM)), pan(0, -100)],
    ['Ctrl + wheel 120 a notch', wheel({ deltaY: -120, ctrlKey: true }), true, zoomOf(Math.exp(120 * WHEEL_ZOOM)), pan(0, 120)],
    ['Ctrl + wheel in lines', wheel({ deltaY: 3, deltaMode: 1, ctrlKey: true }), false, zoomOf(Math.exp(-48 * WHEEL_ZOOM)), pan(0, -48)],
    ['⌘ + wheel', wheel({ deltaY: 100, metaKey: true }), false, zoomOf(Math.exp(-100 * WHEEL_ZOOM)), pan(0, -100)],
    ['Shift + wheel as deltaY', wheel({ deltaY: 100, shiftKey: true }), false, pan(-100, 0), pan(-100, 0)],
    ['Shift + wheel turned into deltaX', wheel({ deltaX: 100, shiftKey: true }), false, pan(-100, -0), pan(-100, 0)],
    ['Ctrl + Shift + wheel', wheel({ deltaY: 100, ctrlKey: true, shiftKey: true }), true, zoomOf(Math.exp(-100 * WHEEL_ZOOM)), pan(-100, 0)],
    ['a pinch', pinch, false, zoomOf(Math.exp(3.75 * WHEEL_ZOOM)), zoomOf(Math.exp(3.75 * WHEEL_ZOOM))],
    ['a pinch out', wheel({ deltaY: 2.2, ctrlKey: true }), false, zoomOf(Math.exp(-2.2 * WHEEL_ZOOM)), zoomOf(Math.exp(-2.2 * WHEEL_ZOOM))],
    ['a pinch with a small whole delta', wheel({ deltaY: 15, ctrlKey: true }), false, zoomOf(Math.exp(-15 * WHEEL_ZOOM)), zoomOf(Math.exp(-15 * WHEEL_ZOOM))],
  ];

  for (const [what, event, controlDown, on, off] of table) {
    it(`${what}: trackpad mode on`, () => {
      const got = wheelAction(event, true, controlDown);
      expect(got.kind).toBe(on.kind);
      if (got.kind === 'zoom' && on.kind === 'zoom') expect(got.factor).toBeCloseTo(on.factor, 10);
      else expect(got).toEqual(on);
    });
    it(`${what}: trackpad mode off`, () => {
      const got = wheelAction(event, false, controlDown);
      expect(got.kind).toBe(off.kind);
      if (got.kind === 'zoom' && off.kind === 'zoom') expect(got.factor).toBeCloseTo(off.factor, 10);
      else expect(got).toEqual(off);
    });
  }

  it('is today’s canvas with the mode on, whatever the Control key', () => {
    for (const event of [notch, pinch, wheel({ deltaY: 40, deltaX: -7 }), wheel({ deltaY: 100, shiftKey: true })]) {
      expect(wheelAction(event, true, true)).toEqual(wheelAction(event, true, false));
    }
  });

  it('never scrolls Shift + wheel twice or on a slant with the mode off', () => {
    const both = wheelAction(wheel({ deltaX: 100, deltaY: 100, shiftKey: true }), false, false);
    expect(both).toEqual(pan(-100, 0));
  });

  it('zooms in for a wheel up and out for a wheel down with the mode off', () => {
    const up = wheelAction(wheel({ deltaY: -100 }), false, false);
    const down = wheelAction(wheel({ deltaY: 100 }), false, false);
    expect(up.kind === 'zoom' && up.factor).toBeCloseTo(WHEEL_NOTCH_STEP, 10);
    expect(down.kind === 'zoom' && down.factor).toBeCloseTo(1 / WHEEL_NOTCH_STEP, 10);
  });
});

describe('isPinchWheel', () => {
  it('is a pinch only when Ctrl is flagged with neither the key down nor a notch', () => {
    expect(isPinchWheel(pinch, false)).toBe(true);
    expect(isPinchWheel(pinch, true)).toBe(false);
    expect(isPinchWheel(notch, false)).toBe(false);
    expect(isPinchWheel(wheel({ deltaY: -3.75 }), false)).toBe(false);
    expect(isPinchWheel(wheel({ deltaY: -3.75, ctrlKey: true, metaKey: true }), false)).toBe(false);
    expect(isPinchWheel(wheel({ deltaY: 1, deltaMode: 1, ctrlKey: true }), false)).toBe(false);
    expect(isPinchWheel(wheel({ deltaY: 49, ctrlKey: true }), false)).toBe(true);
    expect(isPinchWheel(wheel({ deltaY: 50, ctrlKey: true }), false)).toBe(false);
  });
});
