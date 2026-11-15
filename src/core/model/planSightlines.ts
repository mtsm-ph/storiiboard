import { wallEnds, type OpeningFields, type PlanItemFields, type Point } from './plan';

// Walls stop cones and beams (6.18, Kevin, Nov 14): a camera's field of view and a light's beam end at the room's walls
// and pass through door and window openings, on the plan and on paper. Pure geometry, in metres, no Konva and no DOM:
// the canvas and the print draw the same shape from here.
//
// What blocks is each wall as the solid it is drawn as, its length by its thickness, split where a door or a window
// makes a gap for its whole width (decisions 1 and 2): nothing else. The cut shape is what a point at the wedge's apex
// sees within the wedge's angle and length, its visibility polygon against those solids (decision 3), found by casting
// a ray at every angle where what it meets can change: the wedge's two edges, every corner of a solid the apex can see
// (just before, on and just after it, so a shadow's edge is sharp), and where a solid's edge crosses the wedge's far
// boundary or another solid's edge, where the apex can see that. Between two of those angles a ray meets one straight
// edge (or the far boundary), so joining the hits in angle order is the shape. A light's arc is followed every
// ARC_STEP_DEG only where the rays reach it, never along a wall; and corners on one straight line with their neighbours
// (the rays that landed on one wall's face) are dropped (6.18 review: Konva fills and strokes every corner on every
// redraw, and a cut all-round light came to several hundred).
//
// Tolerance (decision 8), SIGHT_TOLERANCE_M: a solid's long faces are taken a millimetre in, so a cone edge running along
// a wall's face, or a camera standing on it, is not cut by it; a wall's own two ends reach a little past where they are
// stored (END_REACH_M, the drawing's 1 mm join, wallShape.ts), so two walls meeting end to end, at a corner or in a
// T whose stem ends on the other's face leave no crack between their solids; a hit closer than the tolerance doesn't
// count, so a camera standing on a wall's end or face sees out from it (one standing within that reach of an end sees
// from the end as stored). A camera deep inside a solid sees nothing: the wall stops every ray where it starts. A light
// there (a practical or a sconce on the wall's line) shines out from the face its beam points to, or from both faces
// when it shines all round.

export const SIGHT_TOLERANCE_M = 0.001;
/**
 * How far a wall's own ends reach past where they are stored, metres (6.18 review): the 1 mm within which the drawing
 * joins two walls' ends (wallShape.ts), and the millimetre a face is taken in, so neither seam lets a ray through.
 */
export const END_REACH_M = 0.001;
/** How far a solid's ends reach past its own where it ends at an opening, or for an apex standing on its end: a hair. */
const END_HAIR_M = 1e-7;
/** How far out of a solid a ray that starts in it may still be and look out from it: past END_REACH_M. */
const LEAVE_M = 2 * SIGHT_TOLERANCE_M;
/**
 * How far off a straight line a corner may be and still be dropped from it, metres (6.18 review): the rays that land on
 * one wall's face are on its line to rounding, a millionth of this. Not the millimetre of SIGHT_TOLERANCE_M: at a jamb a
 * corner 0.02 mm off the face's line is the shadow's real corner, and dropping it took 1e-5 m² off the shape.
 */
const MERGE_M = 1e-6;
/** Just before and just after a corner's angle, radians: 6 µm at 6 m. */
const NUDGE = 1e-6;
/** A light's arc is followed at least this often, degrees. */
export const ARC_STEP_DEG = 2;

/**
 * One solid that blocks: a wall's piece between openings, from `a` to `b` along its middle line, `half` its half
 * thickness; `reach`, how far its ends block past `a` and `b` (a wall's own end END_REACH_M, an opening's jamb a hair).
 */
export interface Solid {
  a: Point;
  b: Point;
  half: number;
  reach?: readonly [number, number];
}

/** A wall's solids, with the box round them (metres) and an identity that holds while its wall and openings are the same. */
export interface Blocker {
  id: string;
  solids: readonly Solid[];
  box: Box;
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * A cone or a beam, uncut (metres; degrees clockwise from up the plan, as a camera's rotation is). A camera's far edge
 * is a straight `chord` between its two far ends (cameraDraw.tsx, conePoints); a light's an `arc` (lightDraw.tsx).
 */
export interface Wedge {
  apex: Point;
  /** Where its middle points. */
  facing: number;
  /** Its whole angle, above 0 up to 360 (all round). */
  degrees: number;
  length: number;
  far: 'chord' | 'arc';
}

/** What each side of the cut shape lies along: a wall (no line drawn), the wedge's far boundary, or an edge of light. */
export type SightEdge = 'wall' | 'far' | 'side';

/**
 * The cut shape (metres): its corners in order and, for each, the kind of the side from it to the next (the last back to
 * the first). For a wedge narrower than all round the first corner is the apex; all round it is a ring round the apex.
 * `cut` is false when nothing blocks it, and the shape is the wedge's own: a camera's three corners exactly as it has
 * always been drawn, a light's apex and its arc. `empty` when the apex is inside a wall.
 */
export interface Sight {
  /** Where it is seen from: the wedge's apex. */
  apex: Point;
  points: readonly Point[];
  edges: readonly SightEdge[];
  cut: boolean;
  ring: boolean;
  empty: boolean;
  /** Each corner's distance from the apex (the apex's own 0), for a glow drawn in bands. */
  reach: readonly number[];
}

const RAD = Math.PI / 180;

/** The direction `angle` radians clockwise from up the plan (y grows down). */
const along = (angle: number): Point => ({ x: Math.sin(angle), y: -Math.cos(angle) });

/** A point's angle from the apex, radians clockwise from up. */
const angleOf = (apex: Point, p: Point): number => Math.atan2(p.x - apex.x, -(p.y - apex.y));

const TAU = 2 * Math.PI;
const wrap = (angle: number): number => ((angle % TAU) + TAU) % TAU;

/** A solid's frame: its unit direction and normal, its length, and how far its faces and ends block. */
interface Frame {
  solid: Solid;
  ux: number;
  uy: number;
  length: number;
  /** Its faces' half thickness as blocking reads it: a tolerance in from the drawn face. */
  hv: number;
  /** Where it blocks along its middle line, from `a`: its ends' reach past `a` (negative) and past `b`. */
  lo: number;
  hi: number;
  corners: readonly Point[];
  box: Box;
}

/** A solid's frame; `hair` takes its ends a hair past `a` and `b` whatever its reach (an apex standing on its end). */
function frameOf(solid: Solid, hair = false): Frame {
  const dx = solid.b.x - solid.a.x;
  const dy = solid.b.y - solid.a.y;
  const length = Math.hypot(dx, dy);
  const ux = length > 0 ? dx / length : 1;
  const uy = length > 0 ? dy / length : 0;
  const hv = solid.half - Math.min(SIGHT_TOLERANCE_M, solid.half / 4);
  const lo = hair ? -END_HAIR_M : -(solid.reach?.[0] ?? END_HAIR_M);
  const hi = length + (hair ? END_HAIR_M : (solid.reach?.[1] ?? END_HAIR_M));
  const at = (u: number, v: number): Point => ({ x: solid.a.x + ux * u - uy * v, y: solid.a.y + uy * u + ux * v });
  const corners = [at(lo, -hv), at(hi, -hv), at(hi, hv), at(lo, hv)];
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  return { solid, ux, uy, length, hv, lo, hi, corners, box: { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) } };
}

/** A point in a solid's own frame: u along its middle line from `a`, v across it (its normal: a quarter turn clockwise). */
function local(f: Frame, p: Point): { u: number; v: number } {
  const rx = p.x - f.solid.a.x;
  const ry = p.y - f.solid.a.y;
  return { u: rx * f.ux + ry * f.uy, v: -rx * f.uy + ry * f.ux };
}

/** Where a ray from `p` along `d` is inside a solid as blocking reads it, [enter, leave] in metres along it; null for nowhere. */
function inside(f: Frame, p: Point, d: Point): [number, number] | null {
  const { u: pu, v: pv } = local(f, p);
  const du = d.x * f.ux + d.y * f.uy;
  const dv = -d.x * f.uy + d.y * f.ux;
  let lo = -Infinity;
  let hi = Infinity;
  const slab = (from: number, step: number, min: number, max: number): boolean => {
    if (Math.abs(step) < 1e-12) return from >= min && from <= max;
    const t1 = (min - from) / step;
    const t2 = (max - from) / step;
    lo = Math.max(lo, Math.min(t1, t2));
    hi = Math.min(hi, Math.max(t1, t2));
    return lo <= hi;
  };
  if (!slab(pu, du, f.lo, f.hi)) return null;
  if (!slab(pv, dv, -f.hv, f.hv)) return null;
  return [lo, hi];
}

/** How far a ray goes before a solid stops it: Infinity when none does. */
function hitOf(frames: readonly Frame[], p: Point, d: Point): number {
  let best = Infinity;
  for (const f of frames) {
    const span = inside(f, p, d);
    // Behind the apex, or left within the tolerance (an apex on a face or an end, looking out): no stop.
    if (!span || span[1] <= SIGHT_TOLERANCE_M) continue;
    best = Math.min(best, Math.max(0, span[0]));
  }
  return best;
}

/**
 * The frames as seen from `apex` (6.18 review): a solid whose end the apex stands on (within its reach) blocks from its
 * stored end, so a camera on a wall's end looks out from it as it always has. A light (`light`) inside a solid shines out
 * of it instead of drawing nothing (a practical or a sconce on a wall's line): within LEAVE_M of a face or of an end, it
 * stands on that face or end, and the solid blocks only behind it; deeper in, the solid blocks only behind the face its
 * beam points to, or not at all when it shines all round (`all`) or points exactly along the wall (a tie: neither face
 * is behind it, whichever way the wall was drawn).
 */
function seenFrom(frames: readonly Frame[], apex: Point, facing: Point, light: boolean, all: boolean): Frame[] {
  return frames.flatMap((f): Frame[] => {
    const { u, v } = local(f, apex);
    const across = Math.abs(v) <= f.hv + SIGHT_TOLERANCE_M;
    if (across && ((u >= f.lo && u <= SIGHT_TOLERANCE_M) || (u >= f.length - SIGHT_TOLERANCE_M && u <= f.hi))) return [frameOf(f.solid, true)];
    if (!light || Math.abs(v) > f.hv || u < f.lo || u > f.hi) return [f];
    const toFace = f.hv - Math.abs(v);
    const toEnd = Math.min(u - f.lo, f.hi - u);
    if (toEnd < LEAVE_M && toEnd <= toFace) {
      // On an end (a jamb's, a millimetre or two in): the solid stops a little short of the light, on its far side.
      return u - f.lo < f.hi - u ? piece(f, u + LEAVE_M, f.hi, false) : piece(f, f.lo, u - LEAVE_M, true);
    }
    let side: number;
    if (toFace < LEAVE_M) side = v >= 0 ? 1 : -1;
    else {
      const along = -facing.x * f.uy + facing.y * f.ux;
      if (all || Math.abs(along) < 1e-9) return [];
      side = along > 0 ? 1 : -1;
    }
    // The part of the wall behind the light: from the face it turns away from, to a little behind the light.
    const from = -side * f.solid.half;
    const to = v - side * LEAVE_M;
    if (side * (to - from) <= 0) return [];
    const half = Math.abs(to - from) / 2;
    const middle = (from + to) / 2;
    const shift = { x: -f.uy * middle, y: f.ux * middle };
    return [frameOf({ a: { x: f.solid.a.x + shift.x, y: f.solid.a.y + shift.y }, b: { x: f.solid.b.x + shift.x, y: f.solid.b.y + shift.y }, half, reach: [-f.lo, f.hi - f.length] })];
  });
}

/** A solid's frame cut to run from `from` to `to` along its middle line (from `a`); the cut end (`cutAtEnd`: the far one) blocks to a hair. */
function piece(f: Frame, from: number, to: number, cutAtEnd: boolean): Frame[] {
  if (to - from <= SIGHT_TOLERANCE_M) return [];
  const at = (w: number): Point => ({ x: f.solid.a.x + f.ux * w, y: f.solid.a.y + f.uy * w });
  // Its ends exactly where the frame blocked, so its reach past them is a hair at the cut and nothing more at the other.
  return [frameOf({ a: at(from), b: at(to), half: f.solid.half, reach: cutAtEnd ? [0, END_HAIR_M] : [END_HAIR_M, 0] })];
}

/** Where two segments cross, or null. */
function crossing(p1: Point, p2: Point, p3: Point, p4: Point): Point | null {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-15) return null;
  const s = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / den;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / den;
  if (s < 0 || s > 1 || u < 0 || u > 1) return null;
  return { x: p1.x + d1x * s, y: p1.y + d1y * s };
}

/** Where a segment crosses the circle of `r` round `c`. */
function circleCrossings(p1: Point, p2: Point, c: Point, r: number): Point[] {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const fx = p1.x - c.x;
  const fy = p1.y - c.y;
  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const k = fx * fx + fy * fy - r * r;
  const disc = b * b - 4 * a * k;
  if (a === 0 || disc < 0) return [];
  const root = Math.sqrt(disc);
  return [(-b - root) / (2 * a), (-b + root) / (2 * a)].filter((s) => s >= 0 && s <= 1).map((s) => ({ x: p1.x + dx * s, y: p1.y + dy * s }));
}

/** The wedge's box (metres): a camera's triangle exactly, a light's whole circle (all it can reach). */
export function wedgeBox(w: Wedge): Box {
  if (w.far === 'arc') return { minX: w.apex.x - w.length, minY: w.apex.y - w.length, maxX: w.apex.x + w.length, maxY: w.apex.y + w.length };
  const half = (w.degrees / 2) * RAD;
  const start = w.facing * RAD - half;
  const ends = [along(start), along(start + 2 * half)].map((d) => ({ x: w.apex.x + d.x * w.length, y: w.apex.y + d.y * w.length }));
  const xs = [w.apex.x, ...ends.map((p) => p.x)];
  const ys = [w.apex.y, ...ends.map((p) => p.y)];
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

export const boxesMeet = (a: Box, b: Box): boolean => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;

/** The wedge as it is drawn uncut: a camera's three corners (conePoints' order), or a light's apex and arc. */
function uncut(w: Wedge): Sight {
  const half = (w.degrees / 2) * RAD;
  const start = w.facing * RAD - half;
  const at = (angle: number, r: number): Point => {
    const d = along(angle);
    return { x: w.apex.x + d.x * r, y: w.apex.y + d.y * r };
  };
  if (w.far === 'chord') {
    return { apex: w.apex, points: [w.apex, at(start, w.length), at(start + 2 * half, w.length)], edges: ['side', 'far', 'side'], cut: false, ring: false, empty: false, reach: [0, w.length, w.length] };
  }
  const steps = Math.max(1, Math.ceil(w.degrees / ARC_STEP_DEG));
  const arc = Array.from({ length: steps + 1 }, (_, i) => at(start + (2 * half * i) / steps, w.length));
  if (w.degrees >= 360) {
    const ring = arc.slice(0, -1);
    return { apex: w.apex, points: ring, edges: ring.map(() => 'far' as const), cut: false, ring: true, empty: false, reach: ring.map(() => w.length) };
  }
  return { apex: w.apex, points: [w.apex, ...arc], edges: ['side', ...arc.slice(1).map(() => 'far' as const), 'side'], cut: false, ring: false, empty: false, reach: [0, ...arc.map(() => w.length)] };
}

/** A point's distance from a solid's blocking box: 0 inside. */
function distanceTo(f: Frame, p: Point): number {
  const { u, v } = local(f, p);
  const du = Math.max(0, f.lo - u, u - f.hi);
  const dv = Math.max(0, Math.abs(v) - f.hv);
  return Math.hypot(du, dv);
}

/**
 * The part of a wedge its apex can see past the blockers (decision 3). `stop` false (a wild wall, `stop_at_walls:
 * false`) is the uncut wedge. Only blockers whose box meets the wedge's are looked at.
 */
export function sightline(w: Wedge, blockers: readonly Blocker[], stop = true): Sight {
  if (!stop || w.degrees <= 0 || w.length <= 0) return uncut(w);
  const reachBox = wedgeBox(w);
  const all = w.degrees >= 360;
  const met = blockers.filter((b) => boxesMeet(b.box, reachBox)).flatMap((b) => b.solids.map((s) => frameOf(s)).filter((f) => boxesMeet(f.box, reachBox)));
  const frames = seenFrom(met, w.apex, along(w.facing * RAD), w.far === 'arc', all);
  if (frames.length === 0) return uncut(w);
  const span = all ? TAU : w.degrees * RAD;
  const start = all ? (w.facing - 180) * RAD : w.facing * RAD - span / 2;
  const half = span / 2;
  /** How far the uncut wedge reaches at `phi` radians from its first edge. */
  const farAt = (phi: number): number => (w.far === 'arc' ? w.length : (w.length * Math.cos(half)) / Math.cos(phi - half));
  /** An angle from the first edge as the wedge takes it: all round, just under 0 is just under a whole turn; else null outside it. */
  const inSpan = (a: number): number | null => (a >= 0 && a <= span ? a : all ? wrap(a) : null);
  const angles: number[] = [0, span];
  // A corner or a crossing counts only where the apex sees it: a ray at it that a nearer solid stops first changes
  // nothing there (a solid's own far corners, a wall behind another), so it costs one ray, never three corners.
  const add = (p: Point, nudged: boolean) => {
    const phi = wrap(angleOf(w.apex, p) - start);
    const near = (nudged ? [phi - NUDGE, phi, phi + NUDGE] : [phi]).map(inSpan).filter((a): a is number => a !== null);
    if (near.length === 0) return;
    const dist = Math.hypot(p.x - w.apex.x, p.y - w.apex.y);
    if (dist > SIGHT_TOLERANCE_M) {
      if (dist > farAt(Math.min(span, Math.max(0, phi))) + SIGHT_TOLERANCE_M) return;
      const hit = hitOf(frames, w.apex, { x: (p.x - w.apex.x) / dist, y: (p.y - w.apex.y) / dist });
      if (hit < dist - SIGHT_TOLERANCE_M) return;
    }
    angles.push(...near);
  };
  // The far boundary as a list of segments to cross: a camera's chord, or (for a light) the circle itself.
  const chord = w.far === 'chord' ? [along(start), along(start + span)].map((d) => ({ x: w.apex.x + d.x * w.length, y: w.apex.y + d.y * w.length })) : null;
  const sides: [Point, Point][] = frames.flatMap((f) => f.corners.map((c, i): [Point, Point] => [c, f.corners[(i + 1) % 4] ?? c]));
  for (const f of frames) for (const c of f.corners) add(c, true);
  for (const [p, q] of sides) {
    if (chord) {
      const [c1, c2] = chord as [Point, Point];
      const at = crossing(p, q, c1, c2);
      if (at) add(at, false);
    } else {
      for (const at of circleCrossings(p, q, w.apex, w.length)) add(at, false);
    }
  }
  // Where two solids' edges cross (two walls meeting at a corner): what a ray meets first changes there. Only solids
  // whose boxes meet can cross, so the rest are never paired.
  for (let fi = 0; fi < frames.length; fi += 1) {
    for (let fj = fi + 1; fj < frames.length; fj += 1) {
      if (!boxesMeet((frames[fi] as Frame).box, (frames[fj] as Frame).box)) continue;
      for (let i = fi * 4; i < fi * 4 + 4; i += 1) {
        for (let j = fj * 4; j < fj * 4 + 4; j += 1) {
          const [p, q] = sides[i] as [Point, Point];
          const [r, s] = sides[j] as [Point, Point];
          const at = crossing(p, q, r, s);
          if (at) add(at, false);
        }
      }
    }
  }
  // An apex standing in a solid (on a wall's end, or within the tolerance of a face) sees out of it only where its rays
  // leave the solid soon enough, which turns at no corner: there the shape is followed every ARC_STEP_DEG all round, as
  // before the 6.18 review (6.18 last review: a light on a wall's end otherwise drew nothing).
  if (frames.some((f) => distanceTo(f, w.apex) === 0)) {
    const grid = Math.max(1, Math.ceil(span / (ARC_STEP_DEG * RAD)));
    for (let k = 1; k < grid; k += 1) angles.push((span * k) / grid);
  }
  angles.sort((a, b) => a - b);
  const phis: number[] = [];
  for (const a of angles) if (phis.length === 0 || a - (phis[phis.length - 1] ?? 0) > 1e-10) phis.push(a);
  // All round, the last angle is the first again.
  if (all && phis.length > 1 && TAU - (phis[phis.length - 1] ?? 0) < 1e-10) phis.pop();
  const cast = (phi: number): Hit => {
    const d = along(start + phi);
    const far = farAt(phi);
    const hit = hitOf(frames, w.apex, d);
    const r = Math.min(far, hit);
    return { phi, point: { x: w.apex.x + d.x * r, y: w.apex.y + d.y * r }, r, far: hit >= far - 1e-9 };
  };
  const hits = phis.map(cast);
  // Between two angles where the rays reach the far boundary, either it is the far boundary all the way (a light's arc,
  // followed every ARC_STEP_DEG on the same steps the uncut beam takes) or a wall's face cuts across the circle between
  // them, with no corner inside it: the ray halfway says which. A camera's chord is straight, so it needs neither.
  const steps = Math.max(1, Math.ceil(span / (ARC_STEP_DEG * RAD)));
  const step = span / steps;
  const out: Hit[] = [];
  const after: SightEdge[] = [];
  let cut = hits.some((h) => !h.far);
  const n = hits.length;
  for (let i = 0; i < n; i += 1) {
    const a = hits[i] as Hit;
    out.push(a);
    if (!all && i === n - 1) break;
    const b = hits[(i + 1) % n] as Hit;
    const to = all && i === n - 1 ? b.phi + TAU : b.phi;
    let kind: SightEdge;
    if (a.far && b.far && w.far === 'arc' && to - a.phi > 1e-9) {
      const middle = cast((a.phi + to) / 2);
      if (middle.far) {
        kind = 'far';
        for (let k = Math.floor(a.phi / step + 1e-9) + 1; k * step < to - 1e-10; k += 1) {
          const phi = wrap(k * step);
          const d = along(start + phi);
          after.push('far');
          out.push({ phi, point: { x: w.apex.x + d.x * w.length, y: w.apex.y + d.y * w.length }, r: w.length, far: true });
        }
      } else {
        cut = true;
        kind = wallOrSide(frames, a.point, b.point);
      }
    } else {
      kind = a.far && b.far ? 'far' : wallOrSide(frames, a.point, b.point);
    }
    after.push(kind);
  }
  if (!cut) return uncut(w);
  if (out.every((h) => h.r <= SIGHT_TOLERANCE_M)) return { apex: w.apex, points: [], edges: [], cut: true, ring: all, empty: true, reach: [] };
  const shape = all
    ? simplified(
        out.map((h) => h.point),
        after,
        out.map((h) => h.r),
        true,
      )
    : simplified([w.apex, ...out.map((h) => h.point)], ['side', ...after, 'side'], [0, ...out.map((h) => h.r)], false);
  return { apex: w.apex, ...shape, cut: true, ring: all, empty: false };
}

/** One ray's hit: its angle from the wedge's first edge, where it stops, how far, and whether that is the far boundary. */
interface Hit {
  phi: number;
  point: Point;
  r: number;
  far: boolean;
}

/** A side of the shape between two hits that aren't both on the far boundary: along a wall (no line drawn), or light's edge. */
function wallOrSide(frames: readonly Frame[], a: Point, b: Point): SightEdge {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return frames.some((f) => distanceTo(f, mid) <= 2 * SIGHT_TOLERANCE_M) ? 'wall' : 'side';
}

/** Whether every corner of `between` lies on the segment from `a` to `b`, within MERGE_M across it. */
function onSegment(a: Point, b: Point, between: readonly Point[]): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-12) return between.every((p) => Math.hypot(p.x - a.x, p.y - a.y) <= MERGE_M);
  return between.every((p) => {
    const across = Math.abs(dx * (p.y - a.y) - dy * (p.x - a.x)) / length;
    const t = (dx * (p.x - a.x) + dy * (p.y - a.y)) / (length * length);
    return across <= MERGE_M && t >= -1e-9 && t <= 1 + 1e-9;
  });
}

/**
 * The shape with every corner dropped that lies on one straight line with the corners kept either side of it (within
 * MERGE_M), between two sides of one kind (6.18 review): the rays that landed on one wall's face, a corner's nudged
 * rays. A dropped run is checked whole against the line that replaces it, so a gentle curve never creeps away from it
 * (a light's arc, 2.4 mm off each chord at its 2° steps, keeps its corners). The apex, or on a ring a corner where the
 * kind of side changes, is kept.
 */
function simplified(points: readonly Point[], edges: readonly SightEdge[], reach: readonly number[], ring: boolean): { points: Point[]; edges: SightEdge[]; reach: number[] } {
  const n = points.length;
  if (n < 4) return { points: [...points], edges: [...edges], reach: [...reach] };
  const changes = ring ? edges.findIndex((e, k) => e !== edges[(k - 1 + n) % n]) : 0;
  const first = Math.max(0, changes);
  const kept: number[] = [first];
  let dropped: Point[] = [];
  for (let k = 1; k < n; k += 1) {
    const i = (first + k) % n;
    const anchor = kept[kept.length - 1] ?? first;
    const at = points[i] as Point;
    if (edges[i] === edges[anchor] && onSegment(points[anchor] as Point, points[(i + 1) % n] as Point, [...dropped, at])) {
      dropped.push(at);
      continue;
    }
    kept.push(i);
    dropped = [];
  }
  return { points: kept.map((i) => points[i] as Point), edges: kept.map((i) => edges[i] as SightEdge), reach: kept.map((i) => reach[i] ?? 0) };
}

/**
 * A wall's solids (decision 2): its middle line from start to end, split where each door or window on it makes a gap
 * for its whole width (open or closed, whatever a window's height). A piece shorter than the tolerance is dropped (a door
 * at the very end of its wall leaves none there). Each gap is held to the wall itself, whatever its caller passed: one
 * running past an end opens only up to it, one wholly past it opens nothing (6.18 review). The wall's own two ends reach
 * END_REACH_M past where they are stored; a jamb's end a hair.
 */
export function wallSolids(wall: PlanItemFields, openings: readonly Pick<OpeningFields, 'along' | 'width'>[]): Solid[] {
  const [start, end] = wallEnds(wall);
  const length = wall.width;
  const half = wall.height / 2;
  const dir = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
  const held = (u: number) => Math.min(length, Math.max(0, u));
  const gaps = openings.map((o) => [held(o.along - o.width / 2), held(o.along + o.width / 2)] as const).sort((a, b) => a[0] - b[0]);
  const at = (u: number): Point => ({ x: start.x + dir.x * u, y: start.y + dir.y * u });
  const solids: Solid[] = [];
  const piece = (from: number, to: number): Solid => ({ a: at(from), b: at(to), half, reach: [from === 0 ? END_REACH_M : END_HAIR_M, to === length ? END_REACH_M : END_HAIR_M] });
  let from = 0;
  for (const [lo, hi] of gaps) {
    if (lo - from > SIGHT_TOLERANCE_M) solids.push(piece(from, lo));
    from = Math.max(from, hi);
  }
  if (length - from > SIGHT_TOLERANCE_M) solids.push(piece(from, length));
  return solids;
}

/** A wall's blocker, with its box. */
export function wallBlocker(id: string, wall: PlanItemFields, openings: readonly Pick<OpeningFields, 'along' | 'width'>[]): Blocker {
  const solids = wallSolids(wall, openings);
  const boxes = solids.map((s) => frameOf(s).box);
  const box =
    boxes.length === 0
      ? { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
      : { minX: Math.min(...boxes.map((b) => b.minX)), minY: Math.min(...boxes.map((b) => b.minY)), maxX: Math.max(...boxes.map((b) => b.maxX)), maxY: Math.max(...boxes.map((b) => b.maxY)) };
  return { id, solids, box };
}

/**
 * Sight lines kept between calls (decision 7): an item's cut is worked out again only when its wedge or its switch
 * changed, or the blockers whose box meets its wedge's are not the very ones its last cut met (a wall moved, resized,
 * or a door moved in it, and the wall's blocker was made again; or a wall moved into or out of its reach). Blockers are
 * compared by identity, so the caller keeps a wall's blocker while the wall and its openings are the same
 * (`blockersKeeper`). Never per frame.
 */
export function sightlineKeeper(): (id: string, w: Wedge, blockers: readonly Blocker[], stop: boolean) => Sight {
  let kept = new Map<string, { key: string; met: readonly Blocker[]; sight: Sight }>();
  let next = new Map<string, { key: string; met: readonly Blocker[]; sight: Sight }>();
  let round: readonly Blocker[] | null = null;
  return (id, w, blockers, stop) => {
    // A new list of blockers starts a new round: what was not asked for in the last one is let go.
    if (blockers !== round) {
      round = blockers;
      kept = next;
      next = new Map();
    }
    const key = `${String(w.apex.x)},${String(w.apex.y)},${String(w.facing)},${String(w.degrees)},${String(w.length)},${w.far},${String(stop)}`;
    const reachBox = wedgeBox(w);
    const met = stop ? blockers.filter((b) => boxesMeet(b.box, reachBox)) : [];
    const was = next.get(id) ?? kept.get(id);
    if (was && was.key === key && was.met.length === met.length && was.met.every((b, i) => b === met[i])) {
      next.set(id, was);
      return was.sight;
    }
    const sight = sightline(w, met, stop);
    next.set(id, { key, met, sight });
    return sight;
  };
}

/** Walls' blockers kept between calls: a wall's is made again only when it or an opening in it changed. */
export function blockersKeeper(): (walls: readonly { id: string; fields: PlanItemFields; key: unknown; openings: readonly { fields: Pick<OpeningFields, 'along' | 'width'>; key: unknown }[] }[]) => readonly Blocker[] {
  let kept = new Map<string, { keys: readonly unknown[]; blocker: Blocker }>();
  let last: readonly Blocker[] = [];
  return (walls) => {
    const next = new Map<string, { keys: readonly unknown[]; blocker: Blocker }>();
    const list = walls.map((wall) => {
      const keys = [wall.key, ...wall.openings.map((o) => o.key)];
      const was = kept.get(wall.id);
      if (was && was.keys.length === keys.length && was.keys.every((k, i) => k === keys[i])) {
        next.set(wall.id, was);
        return was.blocker;
      }
      const blocker = wallBlocker(
        wall.id,
        wall.fields,
        wall.openings.map((o) => o.fields),
      );
      next.set(wall.id, { keys, blocker });
      return blocker;
    });
    kept = next;
    if (list.length === last.length && list.every((b, i) => b === last[i])) return last;
    last = list;
    return list;
  };
}
