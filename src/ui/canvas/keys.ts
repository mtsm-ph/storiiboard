import type { CanvasCommand, Point, Tool } from './types';

// The canvas's keys as pure functions, so the table is tested without a browser.

export interface KeyLike {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** ⌘ on a Mac, Ctrl elsewhere. */
export const isCommand = (event: Pick<KeyLike, 'metaKey' | 'ctrlKey'>, mac: boolean): boolean =>
  mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;

/** A tool's letter: V, H, R, T (text), S (sticky), O (ellipse); read from the letter typed, so it follows the keyboard's layout. */
export function toolForKey(event: KeyLike): Tool | null {
  if (event.altKey || event.metaKey || event.ctrlKey) return null;
  switch (event.key.toLowerCase()) {
    case 'v':
      return 'select';
    case 'h':
      return 'hand';
    case 'r':
      return 'rect';
    case 't':
      return 'text';
    case 's':
      return 'sticky';
    case 'o':
      return 'ellipse';
    default:
      return null;
  }
}

/** The command a key asks of the selection, or null. `pointer`: where the pointer is in world units, over the canvas. */
export function commandForKey(event: KeyLike, mac: boolean, pointer: Point | null): CanvasCommand | null {
  if (event.key === 'Delete' || event.key === 'Backspace') return event.metaKey || event.ctrlKey || event.altKey ? null : { kind: 'delete' };
  if (!isCommand(event, mac) || event.altKey) return null;
  // The brackets by their place: Shift turns [ into {, and layouts put them elsewhere.
  if (event.code === 'BracketRight') return { kind: event.shiftKey ? 'front' : 'forward' };
  if (event.code === 'BracketLeft') return { kind: event.shiftKey ? 'back' : 'backward' };
  if (event.shiftKey) return null;
  switch (event.key.toLowerCase()) {
    case 'c':
      return { kind: 'copy' };
    case 'x':
      return { kind: 'cut' };
    case 'v':
      return { kind: 'paste', at: pointer };
    case 'd':
      return { kind: 'duplicate' };
    default:
      return null;
  }
}

/** Shift+0, Shift+1, Shift+2: 100%, fit everything, fit the selection. By the key's place, since Shift changes what it types. */
export function zoomShortcut(event: KeyLike): 'actual' | 'all' | 'selection' | null {
  if (!event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return null;
  if (event.code === 'Digit0') return 'actual';
  if (event.code === 'Digit1') return 'all';
  if (event.code === 'Digit2') return 'selection';
  return null;
}

/** + and - (and = and _, the same keys unshifted): a step of zoom in or out. */
export function zoomStepFor(event: Pick<KeyLike, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>): 1 | -1 | 0 {
  if (event.metaKey || event.ctrlKey || event.altKey) return 0;
  if (event.key === '+' || event.key === '=') return 1;
  if (event.key === '-' || event.key === '_') return -1;
  return 0;
}
