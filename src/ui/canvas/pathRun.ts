import { tidy } from './placement';
import { constrainAngle, nearestPoint, pointAlong, snapToGrid, type GridSnap } from './scale';
import type { GridSpec, HostToolId, Point } from './types';

// A run drawn point to point (6.2a, a plan's walls), as pure steps the canvas takes on its pointer and keys, so what a
// click, a key or leaving the view does to a run is tested without a browser. The canvas keeps the run; the host is
// handed its fixed points once, when it ends (Enter, a double-click, Escape, another tool, or the view going away).

/**
 * A run being drawn: the points fixed so far, where the next would go (the pointer, snapped), the direction a typed
 * length goes in (radians), and what has been typed.
 */
export interface PathDraft {
  tool: HostToolId;
  points: Point[];
  cursor: Point | null;
  angle: number;
  typed: string;
  /** The last press of the run (when and where on screen), to know a double-click's second press by. */
  press?: PathPress;
}

/** A pointer press: its time (ms) and where it was on screen (px). */
export interface PathPress {
  time: number;
  x: number;
  y: number;
}

/**
 * How near in time and on screen a press must be to the one before to be a double-click's second press. Not the event's
 * `detail`, which a pointerdown leaves at 0 in Chromium (WebView2) and WebKit.
 */
export const DOUBLE_PRESS_MS = 500;
export const DOUBLE_PRESS_PX = 6;

export const isDoublePress = (before: PathPress | undefined, press: PathPress): boolean =>
  before !== undefined && press.time - before.time >= 0 && press.time - before.time <= DOUBLE_PRESS_MS && Math.hypot(press.x - before.x, press.y - before.y) <= DOUBLE_PRESS_PX;

export interface PathMods {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

export const NO_MODS: PathMods = { shiftKey: false, ctrlKey: false, metaKey: false, altKey: false };

/** Ctrl (⌘ on a Mac) turns snapping off, as for items; Alt snaps to the grid's fine step. */
export const gridModeOf = (event: Pick<PathMods, 'ctrlKey' | 'metaKey' | 'altKey'>): GridSnap => (event.ctrlKey || event.metaKey ? 'off' : event.altKey ? 'fine' : 'magnet');

/** How near (screen pixels) a run's click must be to another end to join it. */
export const END_SNAP = 10;

export interface PathSnap {
  /** Ends a click joins when near (other walls' ends), world units. */
  ends: readonly Point[];
  grid: GridSpec | undefined;
  zoom: number;
}

/** Where a run's next point goes: Shift holds it to 15° steps from the last; else another end near it, else the grid. */
export function nextPoint(raw: Point, mods: PathMods, run: PathDraft | null, snap: PathSnap): Point {
  const last = run?.points.at(-1);
  const tidied = (p: Point): Point => ({ x: tidy(p.x), y: tidy(p.y) });
  if (last && mods.shiftKey) return tidied(constrainAngle(last, raw));
  const mode = gridModeOf(mods);
  if (mode !== 'off') {
    const end = nearestPoint(raw, [...snap.ends, ...(run?.points ?? [])], END_SNAP / snap.zoom);
    if (end) return end;
  }
  return tidied(snap.grid ? snapToGrid(raw, snap.grid, snap.zoom, mode) : raw);
}

/** The direction the next segment goes: towards the pointer, else the run's last direction. */
export const pathAngle = (run: PathDraft): number => {
  const last = run.points.at(-1);
  if (last && run.cursor && Math.hypot(run.cursor.x - last.x, run.cursor.y - last.y) > 1e-6) return Math.atan2(run.cursor.y - last.y, run.cursor.x - last.x);
  return run.angle;
};

export const runStart = (tool: HostToolId, at: Point, cursor: Point | null = at, press?: PathPress): PathDraft => ({ tool, points: [at], cursor, angle: 0, typed: '', ...(press ? { press } : {}) });

/**
 * A press during a run: the point it fixes, ending a segment and starting the next; or 'double' for a double-click's
 * second press (within 500 ms and 6 screen px of the press before), which adds nothing however it jittered and ends the
 * run. A press where the last point is (under 2 px) adds nothing either.
 */
export function runClick(run: PathDraft, at: Point, zoom: number, press: PathPress): PathDraft | 'double' {
  if (isDoublePress(run.press, press)) return 'double';
  const last = run.points.at(-1);
  if (!last) return { ...run, points: [at], cursor: at, typed: '', press };
  if (Math.hypot(at.x - last.x, at.y - last.y) * zoom < 2) return { ...run, press };
  return { ...run, points: [...run.points, at], cursor: at, angle: Math.atan2(at.y - last.y, at.x - last.x), typed: '', press };
}

/** The points a run leaves to be written when it ends: the fixed ones, two or more, never where the pointer is. */
export const runPoints = (run: PathDraft | null): Point[] | null => (run && run.points.length >= 2 ? run.points : null);

/** Whether picking this tool ends the run (any tool but the run's own). */
export const toolEndsRun = (run: PathDraft | null, tool: string): boolean => run !== null && run.tool !== tool;

const ARROW_ANGLE: Readonly<Record<string, number>> = { ArrowRight: 0, ArrowDown: Math.PI / 2, ArrowLeft: Math.PI, ArrowUp: -Math.PI / 2 };

export type RunKeyResult =
  /** The run as it is now (a typed character, a direction, a point taken off). */
  | { kind: 'run'; run: PathDraft | null }
  /** A typed length taken: the new point, and the length for the screen reader. */
  | { kind: 'taken'; run: PathDraft; length: number }
  /** What was typed isn't a length: nothing changes, and it's said. */
  | { kind: 'refused'; typed: string }
  /** The run ends, its fixed points written (Enter alone, Escape alone). */
  | { kind: 'finish' };

/**
 * What a key does to a run, or null when the key isn't the run's (it goes on to the canvas's own keys). Typed lengths,
 * Enter, Escape, Backspace and Delete, and the arrows (its direction) are the run's first. Backspace and Delete with
 * nothing typed take the last fixed point off; they never reach the delete command, so a run never deletes records.
 * `parse` reads a typed length into world units, or null.
 */
export function runKey(run: PathDraft, event: { key: string; metaKey: boolean; ctrlKey: boolean }, parse: (text: string) => number | null): RunKeyResult | null {
  if (event.key === 'Backspace' || event.key === 'Delete') {
    if (run.typed !== '') return { kind: 'run', run: { ...run, typed: event.key === 'Backspace' ? run.typed.slice(0, -1) : run.typed } };
    // The only point taken off: the run is dropped, nothing written, the tool kept.
    if (run.points.length <= 1) return { kind: 'run', run: null };
    const points = run.points.slice(0, -1);
    const last = points.at(-1);
    const before = points.at(-2);
    return { kind: 'run', run: { ...run, points, angle: last && before ? Math.atan2(last.y - before.y, last.x - before.x) : run.angle } };
  }
  if (event.metaKey || event.ctrlKey) return null;
  if (event.key === 'Escape') return run.typed !== '' ? { kind: 'run', run: { ...run, typed: '' } } : { kind: 'finish' };
  if (event.key === 'Enter') {
    if (run.typed === '') return { kind: 'finish' };
    const length = parse(run.typed);
    const last = run.points.at(-1);
    if (length === null || !Number.isFinite(length) || length <= 0 || !last) return { kind: 'refused', typed: run.typed };
    const angle = pathAngle(run);
    const next = pointAlong(last, angle, length);
    return { kind: 'taken', run: { ...run, points: [...run.points, { x: tidy(next.x), y: tidy(next.y) }], cursor: null, angle, typed: '' }, length };
  }
  // A digit or a decimal mark starts a length; once started, anything printable is part of it (12' 6", 3.5 m).
  if (event.key.length === 1 && (run.typed !== '' || /[0-9.,]/.test(event.key))) return { kind: 'run', run: { ...run, typed: run.typed + event.key } };
  const turn = ARROW_ANGLE[event.key];
  // From the keyboard, the next segment's direction; while a length is typed, an arrow does nothing (it never nudges).
  if (turn !== undefined) return { kind: 'run', run: run.typed === '' ? { ...run, cursor: null, angle: turn } : run };
  return null;
}
