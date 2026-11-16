// What a wheel event does to a canvas's view (6.5.3, Kevin, Nov 16), worked out from the event's fields alone so it can be
// tested without a browser. Trackpad mode on is the canvas as it always was: the deltas pan in both axes, and Ctrl (a
// pinch) or ⌘ zooms at the pointer. Off is a mouse's canvas: the wheel zooms at the pointer, Ctrl + wheel scrolls up and
// down, Shift + wheel sideways, and a pinch still zooms.
//
// Telling a pinch from Ctrl + wheel, needed only when the mode is off: Chromium (and WebKit's wheel, besides its gesture
// events) sends a trackpad pinch as a wheel with ctrlKey set although no Control key is down, with small pixel deltas that
// are seldom whole numbers. A real Ctrl + mouse wheel has the Control key down (the canvas has seen its keydown) and its
// delta is a notch: in lines (deltaMode 1 or 2) or a whole number of pixels of at least NOTCH_LEAST (100 or 120 a notch
// on Windows, Linux and the Mac). Either sign of a mouse makes it Ctrl + wheel; only a wheel with neither is a pinch, so a
// key press missed while the window had no focus still reads right from the notch, and a pinch's odd whole delta still
// reads right from the key not being down. WebKit's gesture events zoom on their own; between gesturestart and gestureend
// the canvas leaves every Ctrl- or ⌘-flagged wheel alone, in both modes, so the pinch never zooms twice or pans.

/** How far one wheel delta pixel zooms a pinch or a Ctrl + wheel in trackpad mode (as it always has). */
export const WHEEL_ZOOM = 0.004;

/** The zoom control's step: in mouse mode one 100 px notch zooms by it, so the wheel and the + button agree. */
export const WHEEL_NOTCH_STEP = 1.25;

/** The pixels one notch is taken to be when the zoom is worked out per notch. */
const NOTCH_PX = 100;

/** The least whole-pixel delta read as a mouse notch rather than a pinch's step. */
export const NOTCH_LEAST = 50;

export interface WheelInput {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export type WheelAction =
  /** Move the view by this many screen pixels (the world moves with them). */
  | { kind: 'pan'; dx: number; dy: number }
  /** Zoom by this factor around the pointer. */
  | { kind: 'zoom'; factor: number };

/** Pixels per delta unit: a line is 16 px, as the canvas has always read it. */
const pixelsPer = (deltaMode: number): number => (deltaMode === 1 ? 16 : 1);

/** Whether a Ctrl-flagged wheel is a trackpad pinch rather than Ctrl + mouse wheel (see above). */
export function isPinchWheel(event: WheelInput, controlDown: boolean): boolean {
  if (!event.ctrlKey || event.metaKey || controlDown) return false;
  if (event.deltaMode !== 0) return false;
  const notch = Number.isInteger(event.deltaY) && Math.abs(event.deltaY) >= NOTCH_LEAST;
  return !notch;
}

/**
 * What this wheel does. `trackpad` is the mode; `controlDown` whether the canvas has seen the Control key go down and not
 * come up (read only when the mode is off).
 */
export function wheelAction(event: WheelInput, trackpad: boolean, controlDown: boolean): WheelAction {
  const lines = pixelsPer(event.deltaMode);
  if (trackpad) {
    // Exactly the canvas before 6.5.3.
    if (event.ctrlKey || event.metaKey) return { kind: 'zoom', factor: Math.exp(-event.deltaY * lines * WHEEL_ZOOM) };
    if (event.shiftKey && event.deltaX === 0) return { kind: 'pan', dx: -event.deltaY * lines, dy: 0 };
    return { kind: 'pan', dx: -event.deltaX * lines, dy: -event.deltaY * lines };
  }
  if (isPinchWheel(event, controlDown)) return { kind: 'zoom', factor: Math.exp(-event.deltaY * WHEEL_ZOOM) };
  // Shift first, so Ctrl + Shift goes sideways too. Some systems turn Shift + wheel into deltaX already; either way it
  // moves sideways once, never down as well.
  if (event.shiftKey) return { kind: 'pan', dx: -(event.deltaX !== 0 ? event.deltaX : event.deltaY) * lines, dy: 0 };
  // ⌘ on a Mac stands for Ctrl here: a pinch never sets it.
  if (event.ctrlKey || event.metaKey) return { kind: 'pan', dx: 0, dy: -event.deltaY * lines };
  // Mostly sideways (a tilt of the wheel, a sideways swipe with a little vertical jitter) scrolls sideways and never
  // zooms; mostly vertical zooms and leaves deltaX alone, so a zoom never drifts sideways.
  if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return { kind: 'pan', dx: -event.deltaX * lines, dy: 0 };
  if (event.deltaY === 0) return { kind: 'pan', dx: 0, dy: 0 };
  const notches = event.deltaMode === 0 ? event.deltaY / NOTCH_PX : event.deltaMode === 1 ? event.deltaY / 3 : event.deltaY;
  return { kind: 'zoom', factor: Math.pow(WHEEL_NOTCH_STEP, -notches) };
}
