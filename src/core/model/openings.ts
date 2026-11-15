import { normalDegrees, wallEnds, type OpeningFields, type PlanGeometry, type PlanItemFields, type Point } from './plan';

// Where a door or window is (6.2b): worked out from its wall each time, never stored, so it moves, turns and stretches
// with the wall. All in metres. An opening sits on the wall's middle line, `along` from its start to its middle; its
// box (what is picked and kept in view) is its width along the wall by the wall's thickness, plus a door's swing on
// the side it opens to.

/** Two lengths this close are the same: a tenth of a millimetre, as lengths are kept. */
const EPS = 1e-4;
const tidy = (m: number): number => Math.round(m * 10000) / 10000;

/** The wall's direction from its start to its end, and the side its box grows to (a quarter turn clockwise on screen). */
export function wallAxes(wall: PlanGeometry): { dir: Point; normal: Point } {
  const turn = (wall.rotation * Math.PI) / 180;
  const dir = { x: Math.cos(turn), y: Math.sin(turn) };
  return { dir, normal: { x: -dir.y, y: dir.x } };
}

/**
 * Which side a door opens to, as a multiple of the wall's normal: right of the wall's direction is the normal's side
 * (y grows down the screen), left the other; a window opens to neither.
 */
export const swingSign = (o: Pick<OpeningFields, 'kind' | 'swing'>): 1 | -1 | 0 => (o.kind !== 'door' ? 0 : o.swing === 'right' ? 1 : -1);

export interface OpeningFrame {
  /** The opening's middle, on the wall's middle line. */
  centre: Point;
  /** Its box: along the wall by across it, turned as the wall is. */
  box: PlanGeometry;
  /** The box's near and far edges across the wall, from its middle line along the normal. */
  lo: number;
  hi: number;
  thickness: number;
}

/** Where an opening is, from its wall. */
export function openingFrame(wall: PlanItemFields, o: Pick<OpeningFields, 'kind' | 'along' | 'width' | 'swing'>): OpeningFrame {
  const [start] = wallEnds(wall);
  const { dir, normal } = wallAxes(wall);
  const t = wall.height;
  const centre = { x: start.x + dir.x * o.along, y: start.y + dir.y * o.along };
  const side = swingSign(o);
  const lo = side < 0 ? -t / 2 - o.width : -t / 2;
  const hi = side > 0 ? t / 2 + o.width : t / 2;
  const middle = (lo + hi) / 2;
  const cx = centre.x + normal.x * middle;
  const cy = centre.y + normal.y * middle;
  const height = hi - lo;
  return { centre, lo, hi, thickness: t, box: { x: cx - o.width / 2, y: cy - height / 2, width: o.width, height, rotation: normalDegrees(wall.rotation) } };
}

/** An opening's middle from where its box is now (a drag moved it), turned as the box is. */
export function centreOfBox(box: PlanGeometry, o: Pick<OpeningFields, 'kind' | 'width' | 'swing'>): Point {
  const { normal } = wallAxes(box);
  // The box's middle sits half the swing off the wall's middle line, on the side the door opens to.
  const middle = (swingSign(o) * o.width) / 2;
  return { x: box.x + box.width / 2 - normal.x * middle, y: box.y + box.height / 2 - normal.y * middle };
}

/** Where a point falls along a wall (metres from its start, unclamped) and how far it is from the middle line. */
export function projectOnWall(wall: PlanItemFields, point: Point): { along: number; distance: number } {
  const [start] = wallEnds(wall);
  const { dir, normal } = wallAxes(wall);
  const dx = point.x - start.x;
  const dy = point.y - start.y;
  return { along: dx * dir.x + dy * dir.y, distance: Math.abs(dx * normal.x + dy * normal.y) };
}

/** The wall a point is over (within its half thickness and `reach` beyond, and along its length), nearest first. */
export function wallUnder<T extends { id: string; fields: PlanItemFields }>(walls: readonly T[], point: Point, reach: number): (T & { along: number }) | null {
  let best: (T & { along: number }) | null = null;
  let bestDistance = Infinity;
  for (const wall of walls) {
    const { along, distance } = projectOnWall(wall.fields, point);
    if (along < -reach || along > wall.fields.width + reach || distance > wall.fields.height / 2 + reach) continue;
    if (distance < bestDistance) {
      best = { ...wall, along };
      bestDistance = distance;
    }
  }
  return best;
}

interface Span {
  along: number;
  width: number;
}

const overlaps = (a: Span, b: Span): boolean => Math.abs(a.along - b.along) < (a.width + b.width) / 2 - EPS;

/** Where an opening's middle may be in a wall: half its width in from each end; null when the wall is too short. */
export function alongRange(wallLength: number, width: number): [number, number] | null {
  const min = width / 2;
  const max = wallLength - width / 2;
  return max < min - EPS ? null : [min, Math.max(min, max)];
}

/** Whether an opening fits at `along`: inside the wall and clear of the others (touching is allowed). */
export function fitsAt(wallLength: number, span: Span, others: readonly Span[]): boolean {
  const range = alongRange(wallLength, span.width);
  return range !== null && span.along >= range[0] - EPS && span.along <= range[1] + EPS && !others.some((o) => overlaps(span, o));
}

/**
 * The nearest place to `wanted` an opening fits in a wall: never off its ends, never over another opening (it stops
 * against one, or the nearest gap that takes it); null when nowhere does.
 */
export function fitAlong(wallLength: number, width: number, wanted: number, others: readonly Span[]): number | null {
  const range = alongRange(wallLength, width);
  if (!range) return null;
  const clamp = (v: number) => Math.min(range[1], Math.max(range[0], v));
  const candidates = [clamp(wanted), range[0], range[1], ...others.flatMap((o) => [o.along - (o.width + width) / 2, o.along + (o.width + width) / 2])];
  let best: number | null = null;
  for (const along of candidates) {
    if (!fitsAt(wallLength, { along, width }, others)) continue;
    if (best === null || Math.abs(along - wanted) < Math.abs(best - wanted)) best = along;
  }
  return best === null ? null : tidy(best);
}

/** The least length a wall can have and keep its openings where they are (6.2b): a resize stops there. */
export function wallNeeds(openings: readonly Span[]): number {
  return openings.reduce((most, o) => Math.max(most, o.along + o.width / 2), 0);
}

/** A value onto the nearest multiple of `step`; a step of 0 leaves it. */
export const onStep = (value: number, step: number): number => (step > 0 ? Math.round(value / step) * step : value);
