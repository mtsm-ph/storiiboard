import { wallEnds, type OpeningFields, type PlanItemFields, type Point } from './plan';

// Walls stop cones and beams (6.18, Kevin, Nov 14): a camera's field of view and a light's beam end at the room's walls
// and pass through door and window openings, on the plan and on paper. Pure geometry, in metres, no Konva and no DOM:
// the canvas and the print draw the same shape from here.
//
// What blocks is each wall as the solid it is drawn as, its length by its thickness, split where a door or a window
// makes a gap for its whole width (decisions 1 and 2): nothing else. The cut shape is what a point at the wedge's apex
// sees within the wedge's angle and length, its visibility polygon against those solids (decision 3), found by casting
// a ray at every angle where what it meets can change: the wedge's two edges, every corner of a solid (just before, on
// and just after it, so a shadow's edge is sharp), where a solid's edge crosses the wedge's far boundary or another
// solid's edge, and, for a light's arc, every ARC_STEP_DEG. Between two of those angles a ray meets one straight edge
// (or the far boundary), so joining the hits in angle order is the shape.
//
// Tolerance (decision 8), SIGHT_TOLERANCE_M: a solid's long faces are taken a millimetre in, so a cone edge running along
// a wall's face, or a camera standing on it, is not cut by it; a solid's ends are taken a hair out (END_HAIR_M), so two
// walls meeting end to end or at a corner leave no crack between their solids; a hit closer than the tolerance doesn't
// count, so a camera standing on a wall's end or face sees out from it. An apex deep inside a solid sees nothing: the
// wall stops every ray where it starts.

export const SIGHT_TOLERANCE_M = 0.001;
/** How far a solid's ends reach past its own, metres: closes the seam where two walls meet, far below anything drawn. */
const END_HAIR_M = 1e-7;
/** Just before and just after a corner's angle, radians: 6 µm at 6 m. */
const NUDGE = 1e-6;
/** A light's arc is followed at least this often, degrees. */
export const ARC_STEP_DEG = 2;

/** One solid that blocks: a wall's piece between openings, from `a` to `b` along its middle line, `half` its half thickness. */
export interface Solid {
  a: Point;
  b: Point;
  half: number;
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
  corners: readonly Point[];
  box: Box;
}

function frameOf(solid: Solid): Frame {
  const dx = solid.b.x - solid.a.x;
  const dy = solid.b.y - solid.a.y;
  const length = Math.hypot(dx, dy);
  const ux = length > 0 ? dx / length : 1;
  const uy = length > 0 ? dy / length : 0;
  const hv = solid.half - Math.min(SIGHT_TOLERANCE_M, solid.half / 4);
  const at = (u: number, v: number): Point => ({ x: solid.a.x + ux * u - uy * v, y: solid.a.y + uy * u + ux * v });
  const corners = [at(-END_HAIR_M, -hv), at(length + END_HAIR_M, -hv), at(length + END_HAIR_M, hv), at(-END_HAIR_M, hv)];
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  return { solid, ux, uy, length, hv, corners, box: { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) } };
}

/** Where a ray from `p` along `d` is inside a solid as blocking reads it, [enter, leave] in metres along it; null for nowhere. */
function inside(f: Frame, p: Point, d: Point): [number, number] | null {
  const rx = p.x - f.solid.a.x;
  const ry = p.y - f.solid.a.y;
  // In the solid's own frame: u along its middle line from `a`, v across it (its normal: a quarter turn clockwise).
  const pu = rx * f.ux + ry * f.uy;
  const pv = -rx * f.uy + ry * f.ux;
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
  if (!slab(pu, du, -END_HAIR_M, f.length + END_HAIR_M)) return null;
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
  const rx = p.x - f.solid.a.x;
  const ry = p.y - f.solid.a.y;
  const pu = rx * f.ux + ry * f.uy;
  const pv = -rx * f.uy + ry * f.ux;
  const du = Math.max(0, -END_HAIR_M - pu, pu - (f.length + END_HAIR_M));
  const dv = Math.max(0, Math.abs(pv) - f.hv);
  return Math.hypot(du, dv);
}

/**
 * The part of a wedge its apex can see past the blockers (decision 3). `stop` false (a wild wall, `stop_at_walls:
 * false`) is the uncut wedge. Only blockers whose box meets the wedge's are looked at.
 */
export function sightline(w: Wedge, blockers: readonly Blocker[], stop = true): Sight {
  if (!stop || w.degrees <= 0 || w.length <= 0) return uncut(w);
  const reachBox = wedgeBox(w);
  const frames = blockers.filter((b) => boxesMeet(b.box, reachBox)).flatMap((b) => b.solids.map(frameOf).filter((f) => boxesMeet(f.box, reachBox)));
  if (frames.length === 0) return uncut(w);
  const all = w.degrees >= 360;
  const span = all ? TAU : w.degrees * RAD;
  const start = all ? (w.facing - 180) * RAD : w.facing * RAD - span / 2;
  const half = span / 2;
  /** How far the uncut wedge reaches at `phi` radians from its first edge. */
  const farAt = (phi: number): number => (w.far === 'arc' ? w.length : (w.length * Math.cos(half)) / Math.cos(phi - half));
  const angles: number[] = [0, span];
  const add = (p: Point, nudged: boolean) => {
    const phi = wrap(angleOf(w.apex, p) - start);
    for (const a of nudged ? [phi - NUDGE, phi, phi + NUDGE] : [phi]) {
      if (a >= 0 && a <= span) angles.push(a);
      // All round, an angle just under 0 is just under a whole turn, and one just past a whole turn just past 0.
      else if (all && a < 0) angles.push(a + TAU);
      else if (all) angles.push(a - TAU);
    }
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
  if (w.far === 'arc') {
    const steps = Math.max(1, Math.ceil(span / (ARC_STEP_DEG * RAD)));
    for (let i = 1; i < steps; i += 1) angles.push((span * i) / steps);
  }
  angles.sort((a, b) => a - b);
  const phis: number[] = [];
  for (const a of angles) if (phis.length === 0 || a - (phis[phis.length - 1] ?? 0) > 1e-10) phis.push(a);
  // All round, the last angle is the first again.
  if (all && phis.length > 1 && TAU - (phis[phis.length - 1] ?? 0) < 1e-10) phis.pop();
  const hits = phis.map((phi) => {
    const d = along(start + phi);
    const far = farAt(phi);
    const hit = hitOf(frames, w.apex, d);
    const r = Math.min(far, hit);
    return { point: { x: w.apex.x + d.x * r, y: w.apex.y + d.y * r }, r, far: hit >= far - 1e-9 };
  });
  if (hits.every((h) => h.far)) return uncut(w);
  if (hits.every((h) => h.r <= SIGHT_TOLERANCE_M)) return { apex: w.apex, points: [], edges: [], cut: true, ring: all, empty: true, reach: [] };
  const kindOf = (a: (typeof hits)[number], b: (typeof hits)[number]): SightEdge => {
    if (a.far && b.far) return 'far';
    const mid = { x: (a.point.x + b.point.x) / 2, y: (a.point.y + b.point.y) / 2 };
    return frames.some((f) => distanceTo(f, mid) <= 2 * SIGHT_TOLERANCE_M) ? 'wall' : 'side';
  };
  if (all) {
    return {
      apex: w.apex,
      points: hits.map((h) => h.point),
      edges: hits.map((h, i) => kindOf(h, hits[(i + 1) % hits.length] ?? h)),
      cut: true,
      ring: true,
      empty: false,
      reach: hits.map((h) => h.r),
    };
  }
  const edges: SightEdge[] = ['side'];
  for (let i = 0; i + 1 < hits.length; i += 1) edges.push(kindOf(hits[i] as (typeof hits)[number], hits[i + 1] as (typeof hits)[number]));
  edges.push('side');
  return { apex: w.apex, points: [w.apex, ...hits.map((h) => h.point)], edges, cut: true, ring: false, empty: false, reach: [0, ...hits.map((h) => h.r)] };
}

/**
 * A wall's solids (decision 2): its middle line from start to end, split where each door or window on it makes a gap
 * for its whole width (open or closed, whatever a window's height). A piece shorter than the tolerance is dropped (a door
 * at the very end of its wall leaves none there).
 */
export function wallSolids(wall: PlanItemFields, openings: readonly Pick<OpeningFields, 'along' | 'width'>[]): Solid[] {
  const [start, end] = wallEnds(wall);
  const length = wall.width;
  const half = wall.height / 2;
  const dir = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
  const gaps = openings.map((o) => [Math.max(0, o.along - o.width / 2), Math.min(length, o.along + o.width / 2)] as const).sort((a, b) => a[0] - b[0]);
  const at = (u: number): Point => ({ x: start.x + dir.x * u, y: start.y + dir.y * u });
  const solids: Solid[] = [];
  let from = 0;
  for (const [lo, hi] of gaps) {
    if (lo - from > SIGHT_TOLERANCE_M) solids.push({ a: at(from), b: at(lo), half });
    from = Math.max(from, hi);
  }
  if (length - from > SIGHT_TOLERANCE_M) solids.push({ a: at(from), b: at(length), half });
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
