import { describe, expect, it } from 'vitest';
import type { PlanItemFields, Point } from './plan';
import { blockersKeeper, sightline, sightlineKeeper, SIGHT_TOLERANCE_M, wallBlocker, wallSolids, type Blocker, type Sight, type Wedge } from './planSightlines';

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
