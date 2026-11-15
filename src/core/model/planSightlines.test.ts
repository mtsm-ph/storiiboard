import { describe, expect, it } from 'vitest';
import type { PlanItemFields, Point } from './plan';
import { blockersKeeper, END_REACH_M, sightline, sightlineKeeper, SIGHT_TOLERANCE_M, wallBlocker, wallSolids, type Blocker, type Sight, type Solid, type Wedge } from './planSightlines';

// Walls stop cones and beams (6.18). Every case is in metres with its numbers worked by hand in its comment. The plan's
// y grows down, so "up" is -y; a wedge's facing is degrees clockwise from up. Walls are 0.1 m thick unless said, so a
// wall whose middle line is at y = -3 has its near face (towards the apex at the origin) at y = -2.95. Blocking takes a
// face a millimetre in (SIGHT_TOLERANCE_M), so a shape ends within 1 mm of the drawn face: compared to 2 mm.

const MM2 = 0.002;

/** A wall's fields from its middle line's ends. */
function wall(x1: number, y1: number, x2: number, y2: number, thick = 0.1): PlanItemFields {
  const length = Math.hypot(x2 - x1, y2 - y1);
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  return { kind: 'wall', x: cx - length / 2, y: cy - thick / 2, width: length, height: thick, rotation: (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI, heightM: null, name: '' };
}

const blocker = (fields: PlanItemFields, openings: { along: number; width: number }[] = [], id = String(Math.random())): Blocker => wallBlocker(id, fields, openings);

/** A camera's cone at the origin facing up: 60° wide, 6 m long, its far edge a chord at y = -6 cos 30° = -5.196. */
const camera = (over: Partial<Wedge> = {}): Wedge => ({ apex: { x: 0, y: 0 }, facing: 0, degrees: 60, length: 6, far: 'chord', ...over });
const CHORD_Y = -6 * Math.cos(Math.PI / 6);

/** The shoelace area of a shape's corners. */
function area(points: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i] as Point;
    const q = points[(i + 1) % points.length] as Point;
    sum += p.x * q.y - q.x * p.y;
  }
  return Math.abs(sum) / 2;
}

/** The corners on the cone's far chord. */
const onChord = (s: Sight) => s.points.filter((p) => Math.abs(p.y - CHORD_Y) < 1e-6);
const xs = (points: readonly Point[]) => points.map((p) => p.x);

describe('a cone in an open room', () => {
  it('is the wedge unchanged, the same three corners the canvas has always drawn', () => {
    // conePoints: the middle, then the far ends at ±30°: (∓6 sin 30°, -6 cos 30°) = (∓3, -5.196).
    const s = sightline(camera(), []);
    expect(s.cut).toBe(false);
    const half = Math.PI / 6;
    expect(s.points).toEqual([
      { x: 0, y: 0 },
      { x: -Math.sin(half) * 6, y: -Math.cos(half) * 6 },
      { x: Math.sin(half) * 6, y: -Math.cos(half) * 6 },
    ]);
    expect(s.points[1]?.x).toBeCloseTo(-3, 9);
    expect(s.points[2]?.y).toBeCloseTo(-5.196, 3);
    expect(s.edges).toEqual(['side', 'far', 'side']);
    expect(sightline(camera(), []).points).toEqual(sightline(camera(), [blocker(wall(-5, 4, 5, 4))]).points);
  });
});

describe('a cone against walls', () => {
  it('ends at the near face of a wall straight across', () => {
    // The wall's middle line at y = -3, x from -5 to 5: its near face at y = -2.95. The cone's edges at ±30° meet it at
    // x = ±2.95 tan 30° = ±1.7032. Area: 2.95 × 1.7032 = 5.0244.
    const s = sightline(camera(), [blocker(wall(-5, -3, 5, -3))]);
    expect(s.cut).toBe(true);
    for (const p of s.points.slice(1)) expect(Math.abs(p.y + 2.95)).toBeLessThan(MM2);
    expect(Math.min(...xs(s.points))).toBeCloseTo(-1.7032, 2);
    expect(Math.max(...xs(s.points))).toBeCloseTo(1.7032, 2);
    expect(area(s.points)).toBeCloseTo(5.0244, 1);
    // Along the wall no line is drawn; the cone's own two edges are.
    expect(s.edges[0]).toBe('side');
    expect(s.edges[s.edges.length - 1]).toBe('side');
    expect(s.edges.slice(1, -1).every((e) => e === 'wall')).toBe(true);
  });

  it('a wall across half the wedge cuts that half and leaves the other to its far edge', () => {
    // The wall from x = 0 to 5 at y = -3: its corner on the cone's axis. The left half runs to the chord: a triangle
    // 3 × 5.196 / 2 = 7.794; the right half ends at the face: 1.7032 × 2.95 / 2 = 2.512. Together 10.306. The shadow's
    // edge runs up the axis from the wall's corner (0, -2.95) to the chord (0, -5.196).
    const s = sightline(camera(), [blocker(wall(0, -3, 5, -3))]);
    expect(area(s.points)).toBeCloseTo(10.306, 1);
    expect(s.points.some((p) => Math.abs(p.x) < MM2 && Math.abs(p.y - CHORD_Y) < MM2)).toBe(true);
    expect(s.points.some((p) => Math.abs(p.x) < MM2 && Math.abs(p.y + 2.95) < MM2)).toBe(true);
    // That edge is drawn: it is the light's, not the wall's.
    const i = s.points.findLastIndex((p) => Math.abs(p.x) < MM2 && Math.abs(p.y - CHORD_Y) < MM2);
    expect(s.edges[i]).toBe('side');
  });

  it('passes a door in that wall as a strip that widens by similar triangles', () => {
    // A 0.9 m door in the middle of the 10 m wall: a gap from x = -0.45 to 0.45. The strip's edges are the rays through
    // the gap's far corners (±0.45, -3.05) (the near corners' rays meet the jambs), so at the chord, 5.196 from the
    // apex, the strip is 2 × 0.45 × 5.196 / 3.05 = 1.5333 wide.
    const s = sightline(camera(), [blocker(wall(-5, -3, 5, -3), [{ along: 5, width: 0.9 }])]);
    const far = onChord(s);
    expect(far.length).toBeGreaterThan(1);
    expect(Math.min(...xs(far))).toBeCloseTo(-0.7666, 2);
    expect(Math.max(...xs(far))).toBeCloseTo(0.7666, 2);
    // At 4 m from the apex the strip is 2 × 0.45 × 4 / 3.05 = 1.180 wide: what a ray at its edge reaches.
    const edge = Math.atan2(0.45, 3.05);
    const at4 = 4 * Math.tan(edge) * 2;
    expect(at4).toBeCloseTo(1.18, 2);
  });

  it('passes a window likewise, the cone’s own edge where the window is wider than it', () => {
    // A 1.2 m window centred 3 m along (x = -2): a gap from x = -2.6 to -1.4. The cone's left edge (-30°) crosses the
    // wall at x = -1.703 to -1.761, inside the gap, so it carries on to the chord at x = -3. The strip's other edge is
    // the ray through the jamb's near corner (-1.4, -2.95), which is still in the gap at the far face (x = -1.448 there):
    // at the chord x = -1.4 × 5.196 / 2.95 = -2.466.
    const s = sightline(camera(), [blocker(wall(-5, -3, 5, -3), [{ along: 3, width: 1.2 }])]);
    const far = onChord(s);
    expect(Math.min(...xs(far))).toBeCloseTo(-3, 2);
    expect(Math.max(...xs(far))).toBeCloseTo(-2.466, 2);
  });

  it('two walls at a corner let nothing through between their solids', () => {
    // Walls along y = -3 (x -5 to 2) and x = 2 (y -3 to 3), meeting at (2, -3); the camera faces the corner (45°). Inside
    // the room the faces are at y = -2.95 and x = 1.95: nothing it sees is past them.
    const s = sightline(camera({ facing: 45 }), [blocker(wall(-5, -3, 2, -3)), blocker(wall(2, -3, 2, 3))]);
    expect(s.cut).toBe(true);
    for (const p of s.points) {
      expect(p.x).toBeLessThan(1.95 + MM2);
      expect(p.y).toBeGreaterThan(-2.95 - MM2);
    }
    // The ray through the inner corner (1.95, -2.95), at atan(1.95 / 2.95) = 33.47°, stops there: a corner of the shape.
    expect(s.points.some((p) => Math.hypot(p.x - 1.95, p.y + 2.95) < MM2)).toBe(true);
  });

  it('two walls meeting end to end are one barrier', () => {
    // The wall straight across in two pieces, -5 to 0 and 0 to 5: the same shape as one wall, no ray up the seam.
    const one = sightline(camera(), [blocker(wall(-5, -3, 5, -3))]);
    const two = sightline(camera(), [blocker(wall(-5, -3, 0, -3)), blocker(wall(0, -3, 5, -3))]);
    for (const p of two.points.slice(1)) expect(Math.abs(p.y + 2.95)).toBeLessThan(MM2);
    expect(area(two.points)).toBeCloseTo(area(one.points), 3);
  });

  it('an apex inside a wall sees nothing', () => {
    // The camera stands on the wall's middle line, 5 cm from either face: every ray is stopped where it starts.
    const s = sightline(camera({ apex: { x: 0, y: -3 } }), [blocker(wall(-5, -3, 5, -3))]);
    expect(s.empty).toBe(true);
    expect(s.points).toEqual([]);
  });

  it('an apex outside the room looking in through a window: only the part through it carries on', () => {
    // The camera at (0, -6) faces down (180°) at the wall along y = -3 from outside; a 1.2 m window in the middle, x from
    // -0.6 to 0.6. Its chord is at y = -6 + 5.196 = -0.804; the strip's edges are the rays through the far corners
    // (±0.6, -2.95), 3.05 below the apex, so at the chord they are ±0.6 × 5.196 / 3.05 = ±1.022.
    const s = sightline(camera({ apex: { x: 0, y: -6 }, facing: 180 }), [blocker(wall(-5, -3, 5, -3), [{ along: 5, width: 1.2 }])]);
    const far = s.points.filter((p) => Math.abs(p.y - (-6 - CHORD_Y)) < 1e-6);
    expect(Math.min(...xs(far))).toBeCloseTo(-1.022, 2);
    expect(Math.max(...xs(far))).toBeCloseTo(1.022, 2);
    // The rest ends at the wall's outer face, y = -3.05.
    const rest = s.points.slice(1).filter((p) => !far.includes(p));
    expect(rest.every((p) => Math.abs(p.y + 3.05) < MM2 || Math.abs(p.y + 2.95) < MM2)).toBe(true);
  });

  it('a wall behind the apex changes nothing', () => {
    const open = sightline(camera(), []);
    const s = sightline(camera(), [blocker(wall(-5, 2, 5, 2))]);
    expect(s.cut).toBe(false);
    expect(s.points).toEqual(open.points);
  });

  it('a beam wider than 180° is cut where it meets the wall and follows its arc elsewhere', () => {
    // A 270° beam, 4 m, facing up, from -135° to 135°: the wall along y = -2 (face -1.95) cuts off the circle's segment
    // above y = -1.95, which lies within ±60.8° of up, inside the beam: r² acos(d/r) - d √(r² - d²) with d = 1.95, r = 4
    // = 16 × 1.0617 - 1.95 × 3.4925 = 10.177. The beam's 2° steps hold 135 × ½ × 16 × sin 2° = 37.69; less the segment,
    // 27.51.
    const s = sightline({ apex: { x: 0, y: 0 }, facing: 0, degrees: 270, length: 4, far: 'arc' }, [blocker(wall(-5, -2, 5, -2))]);
    for (const p of s.points) expect(p.y).toBeGreaterThan(-1.95 - MM2);
    expect(area(s.points)).toBeCloseTo(27.51, 0);
    // Straight right, about 90°, is untouched: the arc's own points, 4 m out, either side of (4, 0).
    expect(s.points.some((p) => p.x > 3.99 && Math.abs(p.y) < 0.1 && Math.abs(Math.hypot(p.x, p.y) - 4) < 1e-9)).toBe(true);
  });

  it('an all-round light is a ring cut by the wall', () => {
    // 16π = 50.27 less the segment, 10.177: about 40.09 (the arc in 2° chords: 180 × ½ × 16 × sin 2° = 50.25, so 40.07).
    const s = sightline({ apex: { x: 0, y: 0 }, facing: 0, degrees: 360, length: 4, far: 'arc' }, [blocker(wall(-5, -2, 5, -2))]);
    expect(s.ring).toBe(true);
    expect(area(s.points)).toBeCloseTo(40.07, 0);
    for (const p of s.points) expect(p.y).toBeGreaterThan(-1.95 - MM2);
  });
});

describe('the tolerance (decision 8)', () => {
  it('a cone edge running along a wall’s face is not cut, nor flickers as the camera moves by a hair', () => {
    // The wedge from 0° to 60° (facing 30°): its first edge is the line x = 0 going up. A wall's middle line along
    // x = -0.05, y from -1 to -5, puts its face exactly on that line.
    const w = (x: number) => camera({ apex: { x, y: 0 }, facing: 30 });
    const along = [blocker(wall(-0.05, -1, -0.05, -5))];
    for (const x of [0, 1e-9, -1e-9, 1e-7, -1e-7, -0.0005]) {
      const s = sightline(w(x), along);
      expect(s.cut, String(x)).toBe(false);
    }
  });

  it('a camera exactly on a wall’s end looks out from it, the same a hair either way', () => {
    // The wall from (-3, 0) to (0, 0); the camera on its end, facing right (90°), away from it.
    const walls = [blocker(wall(-3, 0, 0, 0))];
    for (const x of [0, 1e-9, -1e-9]) expect(sightline(camera({ apex: { x, y: 0 }, facing: 90 }), walls).cut, String(x)).toBe(false);
    // Facing up from the end, the half of the cone over the wall's body looks through the wall: cut at its start.
    const up = sightline(camera({ apex: { x: 0, y: 0 } }), walls);
    expect(up.cut).toBe(true);
    expect(Math.max(...xs(up.points))).toBeCloseTo(3, 2);
  });

  it('a camera standing on a wall’s face, facing away, sees as in an open room', () => {
    // The wall's middle line at y = 0.05: its face at y = 0, where the camera stands.
    expect(sightline(camera(), [blocker(wall(-5, 0.05, 5, 0.05))]).cut).toBe(false);
  });

  it('a door at the very end of a wall leaves no sliver of wall there', () => {
    // A 10 m wall from x = 0 to 10, a 0.9 m door centred 9.55 m along: the gap runs from 9.1 to 10.0, so one solid is
    // left, 0 to 9.1. Centred 0.45 m along: the gap is 0 to 0.9 and the solid 0.9 to 10.
    const atEnd = wallSolids(wall(0, 0, 10, 0), [{ along: 9.55, width: 0.9 }]);
    expect(atEnd).toHaveLength(1);
    expect(atEnd[0]?.b.x).toBeCloseTo(9.1, 6);
    const atStart = wallSolids(wall(0, 0, 10, 0), [{ along: 0.45, width: 0.9 }]);
    expect(atStart).toHaveLength(1);
    expect(atStart[0]?.a.x).toBeCloseTo(0.9, 6);
    // A camera 3 m below the gap's middle, facing up through it: past the wall's end nothing stops it, so its right edge
    // reaches the chord (5.196 up, y = -2.196) at x = 9.55 + 3 = 12.55, and the jamb's shadow starts at the ray through
    // its far corner (9.1, -0.05), 3.05 up (the near corner's ray meets the jamb): at the chord x = 9.55 - 0.45 × 5.196 /
    // 3.05 = 8.783.
    const s = sightline(camera({ apex: { x: 9.55, y: 3 } }), [blocker(wall(0, 0, 10, 0), [{ along: 9.55, width: 0.9 }])]);
    const far = s.points.filter((p) => Math.abs(p.y - (3 + CHORD_Y)) < 1e-6);
    expect(Math.max(...xs(far))).toBeCloseTo(12.55, 2);
    expect(Math.min(...xs(far))).toBeCloseTo(8.783, 2);
    expect(SIGHT_TOLERANCE_M).toBe(0.001);
  });
});

describe('the switch', () => {
  it('stop_at_walls: false returns the uncut wedge', () => {
    const s = sightline(camera(), [blocker(wall(-5, -3, 5, -3))], false);
    expect(s.cut).toBe(false);
    expect(s.points).toEqual(sightline(camera(), []).points);
  });
});

describe('kept between calls (decision 7)', () => {
  it('works an item out again only when its wedge, its switch or the walls that meet it changed', () => {
    const sights = sightlineKeeper();
    const across = blocker(wall(-5, -3, 5, -3), [], 'w1');
    const far = blocker(wall(50, 50, 60, 50), [], 'w2');
    const first = sights('cam', camera(), [across, far], true);
    // The same wedge and walls: the same result.
    expect(sights('cam', camera(), [across, far], true)).toBe(first);
    // A wall far away made again: the cone never met it, so it is kept.
    const farMoved = blocker(wall(50, 51, 60, 51), [], 'w2');
    expect(sights('cam', camera(), [across, farMoved], true)).toBe(first);
    // The wall it meets made again (moved): worked out again.
    const moved = blocker(wall(-5, -4, 5, -4), [], 'w1');
    const again = sights('cam', camera(), [moved, farMoved], true);
    expect(again).not.toBe(first);
    expect(Math.max(...again.points.map((p) => -p.y))).toBeCloseTo(3.95, 2);
    // Turned, or switched off: worked out again.
    expect(sights('cam', camera({ facing: 10 }), [moved, farMoved], true)).not.toBe(again);
    expect(sights('cam', camera({ facing: 10 }), [moved, farMoved], false).cut).toBe(false);
  });

  it('keeps a wall’s blocker while the wall and its openings are the same records', () => {
    const keep = blockersKeeper();
    const record = {};
    const opening = {};
    const walls = [{ id: 'w', fields: wall(-5, -3, 5, -3), key: record, openings: [{ fields: { along: 5, width: 0.9 }, key: opening }] }];
    const first = keep(walls);
    expect(keep(walls)).toBe(first);
    const moved = keep([{ ...walls[0], key: record, openings: [{ fields: { along: 4, width: 0.9 }, key: {} }] } as (typeof walls)[number]]);
    expect(moved).not.toBe(first);
    expect(moved[0]?.solids).toHaveLength(2);
  });
});

// The shape as 6.18 first worked it out, kept here to measure the review's simplification against (6.18 review, item 1):
// a ray every 2° across a light's whole span, three at every corner in reach, hidden or not, nothing merged. It reads
// the solids as they are now (a wall's ends reach END_REACH_M), so the two differ only by the simplification.
const RAD = Math.PI / 180;
const TAU = 2 * Math.PI;
const dirOf = (angle: number): Point => ({ x: Math.sin(angle), y: -Math.cos(angle) });
const wrapped = (angle: number): number => ((angle % TAU) + TAU) % TAU;
interface RefFrame {
  a: Point;
  ux: number;
  uy: number;
  hv: number;
  lo: number;
  hi: number;
  corners: Point[];
}
function refFrame(s: Solid): RefFrame {
  const length = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
  const ux = (s.b.x - s.a.x) / length;
  const uy = (s.b.y - s.a.y) / length;
  const hv = s.half - Math.min(SIGHT_TOLERANCE_M, s.half / 4);
  const lo = -(s.reach?.[0] ?? 1e-7);
  const hi = length + (s.reach?.[1] ?? 1e-7);
  const at = (u: number, v: number): Point => ({ x: s.a.x + ux * u - uy * v, y: s.a.y + uy * u + ux * v });
  return { a: s.a, ux, uy, hv, lo, hi, corners: [at(lo, -hv), at(hi, -hv), at(hi, hv), at(lo, hv)] };
}
function refHit(frames: readonly RefFrame[], p: Point, d: Point): number {
  let best = Infinity;
  for (const f of frames) {
    const pu = (p.x - f.a.x) * f.ux + (p.y - f.a.y) * f.uy;
    const pv = -(p.x - f.a.x) * f.uy + (p.y - f.a.y) * f.ux;
    const du = d.x * f.ux + d.y * f.uy;
    const dv = -d.x * f.uy + d.y * f.ux;
    let lo = -Infinity;
    let hi = Infinity;
    const slab = (from: number, step: number, min: number, max: number): boolean => {
      if (Math.abs(step) < 1e-12) return from >= min && from <= max;
      lo = Math.max(lo, Math.min((min - from) / step, (max - from) / step));
      hi = Math.min(hi, Math.max((min - from) / step, (max - from) / step));
      return lo <= hi;
    };
    if (!slab(pu, du, f.lo, f.hi) || !slab(pv, dv, -f.hv, f.hv) || hi <= SIGHT_TOLERANCE_M) continue;
    best = Math.min(best, Math.max(0, lo));
  }
  return best;
}
function refCross(p1: Point, p2: Point, p3: Point, p4: Point): Point | null {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-15) return null;
  const s = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / den;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / den;
  return s < 0 || s > 1 || u < 0 || u > 1 ? null : { x: p1.x + d1x * s, y: p1.y + d1y * s };
}
function refCircle(p1: Point, p2: Point, c: Point, r: number): Point[] {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const a = dx * dx + dy * dy;
  const b = 2 * ((p1.x - c.x) * dx + (p1.y - c.y) * dy);
  const disc = b * b - 4 * a * ((p1.x - c.x) ** 2 + (p1.y - c.y) ** 2 - r * r);
  if (a === 0 || disc < 0) return [];
  return [(-b - Math.sqrt(disc)) / (2 * a), (-b + Math.sqrt(disc)) / (2 * a)].filter((s) => s >= 0 && s <= 1).map((s) => ({ x: p1.x + dx * s, y: p1.y + dy * s }));
}
/** The unsimplified shape's corners (the apex first unless all round). */
function unsimplified(w: Wedge, blockers: readonly Blocker[]): Point[] {
  const frames = blockers.flatMap((b) => b.solids.map(refFrame));
  const all = w.degrees >= 360;
  const span = all ? TAU : w.degrees * RAD;
  const start = all ? (w.facing - 180) * RAD : w.facing * RAD - span / 2;
  const farAt = (phi: number) => (w.far === 'arc' ? w.length : (w.length * Math.cos(span / 2)) / Math.cos(phi - span / 2));
  const angles = [0, span];
  const add = (p: Point, nudged: boolean) => {
    const phi = wrapped(Math.atan2(p.x - w.apex.x, -(p.y - w.apex.y)) - start);
    for (const a of nudged ? [phi - 1e-6, phi, phi + 1e-6] : [phi]) {
      if (a >= 0 && a <= span) angles.push(a);
      else if (all) angles.push(wrapped(a));
    }
  };
  const chord = w.far === 'chord' ? [dirOf(start), dirOf(start + span)].map((d) => ({ x: w.apex.x + d.x * w.length, y: w.apex.y + d.y * w.length })) : null;
  const sides = frames.flatMap((f) => f.corners.map((c, i): [Point, Point] => [c, f.corners[(i + 1) % 4] ?? c]));
  for (const f of frames) for (const c of f.corners) add(c, true);
  for (const [p, q] of sides) {
    if (chord) {
      const at = refCross(p, q, chord[0] as Point, chord[1] as Point);
      if (at) add(at, false);
    } else for (const at of refCircle(p, q, w.apex, w.length)) add(at, false);
  }
  for (let i = 0; i < sides.length; i += 1) {
    for (let j = i + 1; j < sides.length; j += 1) {
      const [p, q] = sides[i] as [Point, Point];
      const [r, s] = sides[j] as [Point, Point];
      const at = refCross(p, q, r, s);
      if (at) add(at, false);
    }
  }
  if (w.far === 'arc') {
    const steps = Math.max(1, Math.ceil(span / (2 * RAD)));
    for (let i = 1; i < steps; i += 1) angles.push((span * i) / steps);
  }
  angles.sort((a, b) => a - b);
  const phis: number[] = [];
  for (const a of angles) if (phis.length === 0 || a - (phis[phis.length - 1] ?? 0) > 1e-10) phis.push(a);
  if (all && phis.length > 1 && TAU - (phis[phis.length - 1] ?? 0) < 1e-10) phis.pop();
  const rays = phis.map((phi) => {
    const d = dirOf(start + phi);
    const far = farAt(phi);
    const hit = refHit(frames, w.apex, d);
    const r = Math.min(far, hit);
    return { phi, point: { x: w.apex.x + d.x * r, y: w.apex.y + d.y * r }, far: hit >= far - 1e-9 };
  });
  // A ray at a corner beyond a light's reach lands on its arc between two 2° steps, where the arc is all there is on both
  // sides: a finer chord than the beam is drawn with anywhere else (uncut, it has its 2° steps alone), not a cut. Those
  // are left out, so what is compared is what was cut.
  const step = span / Math.max(1, Math.ceil(span / (2 * RAD)));
  const onStep = (phi: number) => Math.abs(phi / step - Math.round(phi / step)) < 1e-6;
  const hits = rays
    .filter((h, i) => {
      if (w.far !== 'arc' || !h.far || onStep(h.phi)) return true;
      const before = rays[i - 1] ?? (all ? rays[rays.length - 1] : undefined);
      const after = rays[i + 1] ?? (all ? rays[0] : undefined);
      return !(before?.far === true && after?.far === true);
    })
    .map((h) => h.point);
  return all ? hits : [w.apex, ...hits];
}

/** A closed room of four 0.1 m walls round the middle lines' corners (x1, y1) and (x2, y2), drawn round in order. */
const room = (x1: number, y1: number, x2: number, y2: number, door: { along: number; width: number }[] = []) => [
  blocker(wall(x1, y1, x2, y1), door),
  blocker(wall(x2, y1, x2, y2)),
  blocker(wall(x2, y2, x1, y2)),
  blocker(wall(x1, y2, x1, y1)),
];

describe('corners kept few (6.18 review, item 1)', () => {
  const light = (over: Partial<Wedge> = {}): Wedge => ({ apex: { x: 0, y: 0 }, facing: 0, degrees: 360, length: 4, far: 'arc', ...over });

  it('a wedge against one long straight wall is its apex and two corners on the face', () => {
    // The wall straight across at y = -3 (face -2.95): every ray lands on the one face, so the shape is a triangle: the
    // apex and the two edges' hits at x = ±1.7032.
    const s = sightline(camera(), [blocker(wall(-50, -3, 50, -3))]);
    expect(s.points.length).toBeLessThanOrEqual(4);
    expect(s.points).toHaveLength(3);
    // A 90° beam, 4 m, on the same wall: its edges at ±45° meet the face at x = ±2.95, 4.17 out, past its 4 m, so it
    // follows its arc each side to where the circle crosses the face, x = ±√(16 - 2.95²) = ±2.701: arc steps at the
    // sides, one straight run along the face, never a corner on it in between.
    const beam = sightline(light({ degrees: 90 }), [blocker(wall(-50, -3, 50, -3))]);
    const onFace = beam.points.filter((p) => Math.abs(p.y + 2.95) < MM2);
    expect(onFace).toHaveLength(2);
    expect(Math.max(...xs(onFace))).toBeCloseTo(2.701, 2);
    expect(beam.points.length).toBeLessThanOrEqual(12);
  });

  it('an all-round light in a closed room is the room’s four inner corners', () => {
    // A 3 × 2 m room (middle lines), the light in its middle, its 4 m reaching every wall: the faces at x = ±1.45 and
    // y = ±0.95, a rectangle of four corners; blocking reads each face 1 mm in, so 2.902 × 1.902 = 5.5196 m².
    const s = sightline(light(), room(-1.5, -1, 1.5, 1));
    expect(s.points.length).toBeLessThanOrEqual(6);
    for (const p of s.points) expect(Math.abs(Math.abs(p.x) - 1.45) < MM2 || Math.abs(Math.abs(p.y) - 0.95) < MM2).toBe(true);
    expect(area(s.points)).toBeCloseTo(2.902 * 1.902, 4);
  });

  it('an all-round light with a door follows its arc only where it reaches it', () => {
    // The same room with a 0.9 m door in its top wall (gap x = -0.45 to 0.45, middle line at y = -1): the light reaches
    // its arc only through the gap, between the rays through the gap's far corners (±0.45, -1.05): ±23.2°, so about 23
    // arc steps of 2°, with the room's corners and the jambs; well under the 180 its arc alone came to.
    const s = sightline(light(), room(-1.5, -1, 1.5, 1, [{ along: 1.5, width: 0.9 }]));
    expect(s.points.length).toBeLessThanOrEqual(40);
    expect(s.points.filter((p) => Math.abs(Math.hypot(p.x, p.y) - 4) < 1e-9).length).toBeGreaterThan(10);
  });

  it('the simplification leaves every shape’s area as it was, within 1e-6 m²', () => {
    const cases: [string, Wedge, Blocker[]][] = [
      ['a wedge against a long wall', camera(), [blocker(wall(-50, -3, 50, -3))]],
      ['a wall across half the wedge', camera(), [blocker(wall(0, -3, 5, -3))]],
      ['a door in a wall', camera(), [blocker(wall(-5, -3, 5, -3), [{ along: 5, width: 0.9 }])]],
      ['two walls at a corner', camera({ facing: 45 }), [blocker(wall(-5, -3, 2, -3)), blocker(wall(2, -3, 2, 3))]],
      ['a 90° beam against a long wall', light({ degrees: 90 }), [blocker(wall(-50, -3, 50, -3))]],
      ['a 270° beam and a wall', light({ degrees: 270 }), [blocker(wall(-5, -2, 5, -2))]],
      ['an all-round light and a wall', light(), [blocker(wall(-5, -2, 5, -2))]],
      ['an all-round light in a closed room', light(), room(-1.5, -1, 1.5, 1)],
      ['an all-round light in a room with a door', light(), room(-1.5, -1, 1.5, 1, [{ along: 1.5, width: 0.9 }])],
      ['an all-round light off the middle of a bigger room', light({ apex: { x: 0.7, y: -0.4 } }), room(-3, -2, 3, 2, [{ along: 2, width: 0.9 }])],
    ];
    for (const [name, w, walls] of cases) {
      const now = sightline(w, walls);
      const before = unsimplified(w, walls);
      expect(now.cut, name).toBe(true);
      expect(now.points.length, name).toBeLessThanOrEqual(before.length);
      expect(Math.abs(area(now.points) - area(before)), name).toBeLessThan(1e-6);
    }
  });
});

describe('walls at any angle (6.18 review, item 6)', () => {
  /**
   * A 20 m wall whose middle line runs through (0, -3) at `degrees` from the plan's x axis (y down, so clockwise), the
   * camera at the origin facing up. The near face is the line n·p = -(3 cos θ - 0.05), n = (-sin θ, cos θ); a ray at φ
   * from up, d = (sin φ, -cos φ), has n·d = -cos(θ - φ), so it meets the face at t = (3 cos θ - 0.05) / cos(θ - φ).
   */
  const angled = (degrees: number) => {
    const th = degrees * RAD;
    return blocker(wall(-10 * Math.cos(th), -3 - 10 * Math.sin(th), 10 * Math.cos(th), -3 + 10 * Math.sin(th)));
  };
  const onFace = (degrees: number, p: Point) => {
    const th = degrees * RAD;
    return Math.abs(-Math.sin(th) * p.x + Math.cos(th) * p.y + (3 * Math.cos(th) - 0.05)) < MM2;
  };
  const near = (s: Sight, x: number, y: number) => s.points.some((p) => Math.hypot(p.x - x, p.y - y) < MM2);

  it('at 30°: both edges end on the face', () => {
    // 3 cos 30° - 0.05 = 2.5481. The right edge (φ = 30°): cos 0° = 1, t = 2.5481, at (1.2741, -2.2067). The left (φ =
    // -30°): cos 60° = 0.5, t = 5.0962 (inside the cone's 6 m), at (-2.5481, -4.4134).
    const s = sightline(camera(), [angled(30)]);
    expect(near(s, 1.2741, -2.2067)).toBe(true);
    expect(near(s, -2.5481, -4.4134)).toBe(true);
    for (const p of s.points.slice(1)) expect(onFace(30, p)).toBe(true);
    expect(s.points).toHaveLength(3);
  });

  it('at 45°: the right edge ends on the face, the left reaches the chord, which the face crosses', () => {
    // 3 cos 45° - 0.05 = 2.0713. The right edge: cos 15° = 0.96593, t = 2.1444, at (1.0722, -1.8571). The left: cos 75° =
    // 0.25882, t = 8.003, past 6 m: it ends at the chord's end (-3, -5.196). The face crosses the chord (y = -5.196) where
    // -0.70711 x + 0.70711 × -5.196 = -2.0713: x = -2.2668.
    const s = sightline(camera(), [angled(45)]);
    expect(near(s, 1.0722, -1.8571)).toBe(true);
    expect(near(s, -3, CHORD_Y)).toBe(true);
    expect(near(s, -2.2668, CHORD_Y)).toBe(true);
    for (const p of s.points.slice(1)) expect(onFace(45, p) || Math.abs(p.y - CHORD_Y) < 1e-6).toBe(true);
  });

  it('at 73°: the right edge ends on the face, the left runs clear', () => {
    // 3 cos 73° - 0.05 = 0.82711. The right edge: cos 43° = 0.73135, t = 1.1309, at (0.56547, -0.97940). The left: cos
    // 103° is negative, so it never meets the face: the chord's end (-3, -5.196). The face crosses the chord where
    // -0.95630 x + 0.29237 × -5.196 = -0.82711: x = -0.72366.
    const s = sightline(camera(), [angled(73)]);
    expect(near(s, 0.56547, -0.9794)).toBe(true);
    expect(near(s, -3, CHORD_Y)).toBe(true);
    expect(near(s, -0.72366, CHORD_Y)).toBe(true);
    for (const p of s.points.slice(1)) expect(onFace(73, p) || Math.abs(p.y - CHORD_Y) < 1e-6).toBe(true);
  });

  it('an apex 100 m from the origin cuts as one at the origin does', () => {
    // The wall-straight-across case moved by (100, 0): the face at y = -2.95, the edges' hits at x = 100 ± 1.7032, area
    // 5.0244 (as at the origin, to 1e-6).
    const here = sightline(camera(), [blocker(wall(-5, -3, 5, -3))]);
    const there = sightline(camera({ apex: { x: 100, y: 0 } }), [blocker(wall(95, -3, 105, -3))]);
    for (const p of there.points.slice(1)) expect(Math.abs(p.y + 2.95)).toBeLessThan(MM2);
    expect(Math.min(...xs(there.points))).toBeCloseTo(100 - 1.7032, 2);
    expect(Math.max(...xs(there.points))).toBeCloseTo(100 + 1.7032, 2);
    expect(Math.abs(area(there.points) - area(here.points))).toBeLessThan(1e-6);
  });
});

describe('openings that overlap or run past the wall (6.18 review, item 6)', () => {
  it('overlapping openings make one gap', () => {
    // A 0.9 m door centred 5 m along (4.55 to 5.45) and a 1.2 m window centred 5.3 m (4.7 to 5.9) on the 10 m wall from
    // x = -5: one gap, 4.55 to 5.9 along, x = -0.45 to 0.9. A window inside a wider door adds nothing.
    const both = [
      { along: 5, width: 0.9 },
      { along: 5.3, width: 1.2 },
    ];
    const solids = wallSolids(wall(-5, -3, 5, -3), both);
    expect(solids).toHaveLength(2);
    expect(solids[0]?.b.x).toBeCloseTo(-0.45, 9);
    expect(solids[1]?.a.x).toBeCloseTo(0.9, 9);
    const inside = wallSolids(wall(-5, -3, 5, -3), [
      { along: 5, width: 2 },
      { along: 5, width: 0.5 },
    ]);
    expect(inside.map((s) => [s.a.x, s.b.x])).toEqual([
      [-5, -1],
      [1, 5],
    ]);
    // The cone through it: the strip's edges through the gap's far corners (-0.45, -3.05) and (0.9, -3.05), at the chord
    // (5.196 up) x = -0.45 × 5.196 / 3.05 = -0.7666 and 0.9 × 5.196 / 3.05 = 1.5333.
    const far = onChord(sightline(camera(), [blocker(wall(-5, -3, 5, -3), both)]));
    expect(Math.min(...xs(far))).toBeCloseTo(-0.7666, 2);
    expect(Math.max(...xs(far))).toBeCloseTo(1.5333, 2);
  });

  it('wallSolids holds an opening to the wall itself', () => {
    // A 10 m wall from x = 0. A 0.9 m door centred 12 m along is wholly past its end: no gap, one solid 0 to 10. One centred
    // -1 m is wholly before its start: no gap. One centred 9.8 m runs past the end (9.35 to 10.25): open from 9.35 to the
    // end, the solid 0 to 9.35.
    for (const along of [12, -1]) {
      const solids = wallSolids(wall(0, 0, 10, 0), [{ along, width: 0.9 }]);
      expect(solids.map((s) => [s.a.x, s.b.x]), String(along)).toEqual([[0, 10]]);
    }
    const past = wallSolids(wall(0, 0, 10, 0), [{ along: 9.8, width: 0.9 }]);
    expect(past).toHaveLength(1);
    expect(past[0]?.a.x).toBeCloseTo(0, 9);
    expect(past[0]?.b.x).toBeCloseTo(9.35, 9);
  });
});

describe('seams the drawing joins (6.18 review, item 5)', () => {
  it('two walls in line whose stored ends are 0.1 mm apart leave no slit', () => {
    // The wall across at y = -3 in two pieces, -5 to 0 and 0.0001 to 5: the drawing joins ends within 1 mm, and so does
    // blocking (each end reaches END_REACH_M, 1 mm, past where it is stored): the shape is the one wall's.
    expect(END_REACH_M).toBe(0.001);
    const one = sightline(camera(), [blocker(wall(-5, -3, 5, -3))]);
    const two = sightline(camera(), [blocker(wall(-5, -3, 0, -3)), blocker(wall(0.0001, -3, 5, -3))]);
    for (const p of two.points.slice(1)) expect(Math.abs(p.y + 2.95)).toBeLessThan(MM2);
    expect(Math.abs(area(two.points) - area(one.points))).toBeLessThan(1e-4);
  });

  it('a T whose stem ends exactly on the other wall’s face leaves no band open under it', () => {
    // The wall across at y = -3 (face y = -2.95, blocking 1 mm in at -2.951); the stem along x = 2 from that face (2,
    // -2.95) down to (2, 2). A camera standing on the wall's face at (-1, -2.9505), facing right along it, 20° wide: its
    // middle ray runs in the millimetre between the face as blocking reads it and the stem's end. The stem's end reaches
    // 1 mm past where it is stored, to -2.951, so that ray stops at the stem's face (x = 1.951): nothing past x = 2.05.
    const s = sightline(camera({ apex: { x: -1, y: -2.9505 }, facing: 90, degrees: 20 }), [blocker(wall(-5, -3, 5, -3)), blocker(wall(2, -2.95, 2, 2))]);
    expect(s.cut).toBe(true);
    expect(Math.max(...xs(s.points))).toBeLessThan(2.05);
  });
});

describe('a light standing inside a wall (6.18 review, item 4)', () => {
  // The wall across at y = -3, x from -5 to 5, 0.1 m thick; the light on its middle line at (0, -3).
  const across = () => [blocker(wall(-5, -3, 5, -3))];

  it('a beam shines out from the face it points to', () => {
    // A 90° beam facing down (180°), 4 m: out of the wall's lower face into the room, never behind the wall; it reaches
    // 4 m out, (0, 1) on its arc.
    const s = sightline({ apex: { x: 0, y: -3 }, facing: 180, degrees: 90, length: 4, far: 'arc' }, across());
    expect(s.empty).toBe(false);
    expect(s.points.length).toBeGreaterThan(3);
    for (const p of s.points) expect(p.y).toBeGreaterThan(-3 - MM2);
    expect(s.points.some((p) => Math.abs(p.y - 1) < 0.01 && Math.abs(p.x) < 0.2)).toBe(true);
    // Facing up (0°), out of the other face: everything is on that side of y = -3, reaching (0, -7).
    const up = sightline({ apex: { x: 0, y: -3 }, facing: 0, degrees: 90, length: 4, far: 'arc' }, across());
    for (const p of up.points) expect(p.y).toBeLessThan(-3 + MM2);
    expect(up.points.some((p) => Math.abs(p.y + 7) < 0.01)).toBe(true);
  });

  it('an all-round light shines out from both faces', () => {
    // With its own wall not cutting it, the 4 m circle round (0, -3) reaches y = 1 and y = -7: both sides lit.
    const s = sightline({ apex: { x: 0, y: -3 }, facing: 0, degrees: 360, length: 4, far: 'arc' }, across());
    expect(s.empty).toBe(false);
    expect(s.points.some((p) => p.y > 0.9)).toBe(true);
    expect(s.points.some((p) => p.y < -6.9)).toBe(true);
  });

  it('a camera inside a wall still sees nothing', () => {
    expect(sightline(camera({ apex: { x: 0, y: -3 }, facing: 180 }), across()).empty).toBe(true);
  });
});
