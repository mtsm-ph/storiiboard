import { boundsOf } from './hitTest';
import type { Geometry, PlaceTool, Point } from './types';
import { unionBounds } from './viewport';

// Where things go: a nudge by an arrow key, a paste, a rectangle placed by a click or Enter.

export const NUDGE = 1;
export const NUDGE_LONG = 10;
export const PASTE_OFFSET = 16;
export const MIN_SIZE = 8;
/** What a click, or Enter, places. */
export const NEW_WIDTH = 200;
export const NEW_HEIGHT = 120;

const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** How far an arrow key nudges in world units (Shift: 10), or null for any other key. */
export function nudgeFor(key: string, shift: boolean): Point | null {
  const arrow = ARROWS[key];
  if (!arrow) return null;
  const step = shift ? NUDGE_LONG : NUDGE;
  return { x: arrow[0] * step, y: arrow[1] * step };
}

export const moved = <T extends Geometry>(g: T, dx: number, dy: number): T => ({ ...g, x: g.x + dx, y: g.y + dy });

/** A size no smaller than the least an item can be. */
export const atLeastMinimum = (value: number): number => Math.max(MIN_SIZE, value);

/** Two decimals are far finer than anyone sees, and keep rotations and sizes from carrying float noise into History. */
export const tidy = (value: number): number => Math.round(value * 100) / 100;

/** Rotation in degrees, 0 up to but not including 360. */
export const normalisedRotation = (degrees: number): number => tidy(((degrees % 360) + 360) % 360) % 360;

/**
 * Items pasted: with a point (the pointer over the canvas), the group's middle lands on it; without, each is offset by
 * 16 units from its original.
 */
export function pasted<T extends Geometry>(items: readonly T[], at: Point | null): T[] {
  const bounds = unionBounds(items.map(boundsOf));
  if (!bounds || !at) return items.map((g) => moved(g, PASTE_OFFSET, PASTE_OFFSET));
  const dx = at.x - (bounds.x + bounds.width / 2);
  const dy = at.y - (bounds.y + bounds.height / 2);
  return items.map((g) => moved(g, tidy(dx), tidy(dy)));
}

/** What a click places, by tool: a sticky note is square, a text box is wide and one line tall (it grows with its text). */
export const PLACED_SIZE: Readonly<Record<PlaceTool, { width: number; height: number }>> = {
  rect: { width: NEW_WIDTH, height: NEW_HEIGHT },
  ellipse: { width: NEW_WIDTH, height: NEW_HEIGHT },
  triangle: { width: NEW_WIDTH, height: NEW_HEIGHT },
  diamond: { width: NEW_WIDTH, height: NEW_HEIGHT },
  text: { width: 240, height: 29 },
  sticky: { width: 200, height: 200 },
  link: { width: 280, height: 88 },
  section: { width: 480, height: 320 },
};

/** The default item for a tool, centred on a world point. */
export function placedAt(point: Point, tool: PlaceTool = 'rect'): Geometry {
  const { width, height } = PLACED_SIZE[tool];
  return { x: tidy(point.x - width / 2), y: tidy(point.y - height / 2), width, height, rotation: 0 };
}
