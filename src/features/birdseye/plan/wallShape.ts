import type { Point } from '../../../ui/canvas/types';

// How a wall is drawn (6.2a): an ink bar along its middle line, as thick as the wall. Where its end meets one other
// wall's end, both are mitred, so a corner is clean whatever its angle; a straight joint, a T, or a very sharp angle
// keeps the plain square end. Pure geometry in canvas units, tested without a canvas.

export interface WallLine {
  id: string;
  start: Point;
  end: Point;
  thickness: number;
}

/** Ends this close (canvas units: 1 mm) are joined. */
const JOIN = 0.1;
/** A mitre reaching further than this many thicknesses from its joint is too sharp: the end stays square. */
const MITRE_LIMIT = 3;

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const times = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k });
const unit = (a: Point): Point => {
  const length = Math.hypot(a.x, a.y);
  return length === 0 ? { x: 1, y: 0 } : { x: a.x / length, y: a.y / length };
};
/** The side a wall's box grows to as its local y does: the direction turned a quarter clockwise on screen. */
const side = (d: Point): Point => ({ x: -d.y, y: d.x });
const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x;
const near = (a: Point, b: Point): boolean => Math.hypot(a.x - b.x, a.y - b.y) <= JOIN;

/** Where two lines meet (each a point and a direction), or null when they're parallel. */
function meet(p: Point, u: Point, q: Point, v: Point): Point | null {
  const d = cross(u, v);
  if (Math.abs(d) < 1e-6) return null;
  const s = cross(sub(q, p), v) / d;
  return add(p, times(u, s));
}

/**
 * The wall's outline in its own box (0 to its length along it, 0 to its thickness across), as points round it: its
 * start's two corners and its end's, each moved to the mitre where a single other wall meets that end.
 */
export function wallOutline(wall: WallLine, others: readonly WallLine[]): Point[] {
  const u = unit(sub(wall.end, wall.start));
  const n = side(u);
  const h = wall.thickness / 2;
  /** The two corners at one end: `here` is the end, `away` the direction the wall goes from it. */
  const corners = (here: Point, away: Point): [Point, Point] => {
    const plain: [Point, Point] = [add(here, times(side(away), h)), add(here, times(side(away), -h))];
    const joined = others.filter((o) => o.id !== wall.id && (near(o.start, here) || near(o.end, here)));
    const [other] = joined;
    if (!other || joined.length !== 1) return plain;
    // The other wall's direction away from the joint.
    const v = unit(near(other.start, here) ? sub(other.end, other.start) : sub(other.start, other.end));
    const k = other.thickness / 2;
    // A path's left side carries on as the next segment's right side, seen from the joint: one side of this wall meets
    // the other side of the other.
    const a = meet(plain[0], away, add(here, times(side(v), -k)), v);
    const b = meet(plain[1], away, add(here, times(side(v), k)), v);
    const reach = MITRE_LIMIT * Math.max(h, k);
    if (!a || !b || Math.hypot(a.x - here.x, a.y - here.y) > reach || Math.hypot(b.x - here.x, b.y - here.y) > reach) return plain;
    return [a, b];
  };
  // From the start the wall goes along u; from its end it goes back.
  const [startA, startB] = corners(wall.start, u);
  const [endA, endB] = corners(wall.end, times(u, -1));
  // startA is on side(u) of the start; endA on side(−u) of the end, which is the other side.
  const outline = [startA, endB, endA, startB];
  // Into the box: x along the wall from its start, y across from its −side edge.
  return outline.map((p) => {
    const d = sub(p, wall.start);
    return { x: d.x * u.x + d.y * u.y, y: d.x * n.x + d.y * n.y + h };
  });
}
