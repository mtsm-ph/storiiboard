import type { AlignMode, CanvasCommand, Point, Side, Tool } from './types';

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

/** A tool's letter: V, H, R, T (text), S (sticky), O (ellipse), L (link), C (connector); read from the letter typed, so it follows the keyboard's layout. */
export function toolForKey(event: KeyLike): Tool | null {
  if (event.altKey || event.metaKey || event.ctrlKey) return null;
  // Shift+S is the Section tool (5.3), since S alone is the sticky.
  if (event.shiftKey && event.key.toLowerCase() === 's') return 'section';
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
    case 'l':
      return 'link';
    case 'c':
      return 'connector';
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

const ARROW_SIDE: Readonly<Record<string, Side>> = { ArrowUp: 'top', ArrowRight: 'right', ArrowDown: 'bottom', ArrowLeft: 'left' };

/**
 * ⌘⌥ + an arrow on a Mac, Ctrl+Shift + an arrow elsewhere (5.2): the side to make a connected copy of the selected item
 * on. Not Ctrl+Alt, which graphics drivers use to turn the screen.
 */
export function quickSideFor(event: KeyLike, mac: boolean): Side | null {
  const chord = mac ? event.metaKey && event.altKey && !event.ctrlKey && !event.shiftKey : event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey;
  return chord ? (ARROW_SIDE[event.key] ?? null) : null;
}

const ALIGN_KEY: Readonly<Record<string, AlignMode>> = { a: 'left', h: 'center', d: 'right', w: 'top', v: 'middle', s: 'bottom' };

/**
 * The letter a layout key stands for. On a Mac Option changes what is typed, so the key's place names it; on Windows and
 * Linux Alt leaves the letter alone, so the letter typed is read, and a layout that moves the keys still matches the
 * letters the menu shows.
 */
const letterOf = (event: KeyLike, mac: boolean): string => (mac ? (event.code.startsWith('Key') ? event.code.slice(3) : '') : event.key).toLowerCase();

/**
 * The layout keys (5.3): Alt+A, H, D, W, V, S align to the left, centre, right, top, middle and bottom; Alt+Shift+H and V
 * distribute across and down; Alt+Shift+T tidies into a grid; ⌘⌥G (Ctrl+Alt+G elsewhere) draws a section round the selection.
 */
export function arrangeForKey(event: KeyLike, mac: boolean): CanvasCommand | null {
  const letter = letterOf(event, mac);
  if (event.altKey && letter === 'g' && !event.shiftKey) {
    return (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) ? { kind: 'sectionAround' } : null;
  }
  if (!event.altKey || event.metaKey || event.ctrlKey) return null;
  if (event.shiftKey) {
    if (letter === 'h') return { kind: 'distribute', axis: 'horizontal' };
    if (letter === 'v') return { kind: 'distribute', axis: 'vertical' };
    if (letter === 't') return { kind: 'tidy', mode: 'grid' };
    return null;
  }
  const mode = ALIGN_KEY[letter];
  return mode ? { kind: 'align', mode } : null;
}
