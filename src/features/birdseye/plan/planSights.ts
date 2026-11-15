import { isOpening, isWallFields, stopsAtWalls, type ShownItem } from '../../../core/model/plan';
import { CONE_LENGTH_M } from '../../../core/model/planCamera';
import { BEAM_LENGTH_M, beamDirection } from '../../../core/model/planLight';
import { ARC_STEP_DEG, blockersKeeper, sightlineKeeper, type Sight, type SightEdge, type Wedge } from '../../../core/model/planSightlines';
import type { CameraLook } from './cameraDraw';
import type { LightLook } from './lightDraw';
import type { MarkLook } from './markLooks';
import { UNITS_PER_METRE } from './planScale';

// Walls stop cones and beams (6.18): each camera's, light's and camera position's cut shape, from the one geometry
// (src/core/model/planSightlines.ts), for the canvas and the print alike. The room's walls and their openings block,
// whatever the layers show: layers are a focus view (decision 10), never what the plan says. Kept between calls, so an
// item's shape is worked out again only when its own wedge or switch, or a wall that meets it, changed (decision 7).

/** Each cone-or-beam item's shape, by id; an item with no cone (no lens, no body) has none. */
export type Sights = ReadonlyMap<string, Sight>;

/** A cut shape as an item's beyond drawing takes it: in its own box, canvas units. */
export interface LocalSight {
  /** The shape's corners, flat, closed; empty when the apex is in a wall. */
  fill: number[];
  /** The edges drawn as lines, each a run of corners (along the walls none is drawn). */
  strokes: number[][];
  /**
   * For an all-round light's glow on paper: the shape cut at each band's radius, outermost first, worked out when first
   * asked for. The screen fills the shape once with the uncut glow's radial gradient (6.18 review); a PDF path can't hold
   * a canvas gradient (deckDisplay.ts prints a circle's as rings), so a print lays these bands over one another instead.
   */
  bands: () => number[][];
}

/** How many bands an all-round light's glow is printed in when walls cut it (as many as a print's rings, deckDisplay.ts). */
export const GLOW_BANDS = 8;

const middleOf = (f: { x: number; y: number; width: number; height: number }) => ({ x: f.x + f.width / 2, y: f.y + f.height / 2 });

/** A camera's (or a camera position's) cone and a light's beam as wedges, metres. */
export const coneWedge = (f: { x: number; y: number; width: number; height: number; rotation: number }, degrees: number): Wedge => ({
  apex: middleOf(f),
  facing: f.rotation,
  degrees,
  length: CONE_LENGTH_M,
  far: 'chord',
});

export const beamWedge = (f: { x: number; y: number; width: number; height: number; rotation: number; icon: string }, degrees: number): Wedge => ({
  apex: middleOf(f),
  facing: beamDirection(f),
  degrees: Math.min(360, degrees),
  length: BEAM_LENGTH_M,
  far: 'arc',
});

/**
 * The view's shapes, kept between calls. `blocking` is what blocks (the room's walls and openings, every layer);
 * `items` the cameras, lights and camera positions to cut, with their looks.
 */
export function sightsKeeper(): (
  blocking: readonly ShownItem[],
  items: readonly ShownItem[],
  looks: ReadonlyMap<string, CameraLook>,
  lights: ReadonlyMap<string, LightLook>,
  marks: ReadonlyMap<string, MarkLook>,
) => Sights {
  const keepBlockers = blockersKeeper();
  const keepSight = sightlineKeeper();
  return (blocking, items, looks, lights, marks) => {
    const openings = new Map<string, ShownItem[]>();
    for (const item of blocking) if (isOpening(item.fields)) openings.set(item.fields.wallId, [...(openings.get(item.fields.wallId) ?? []), item]);
    const blockers = keepBlockers(
      blocking.flatMap((item) =>
        isWallFields(item.fields)
          ? [
              {
                id: item.record.id,
                fields: item.fields,
                key: item.record,
                openings: (openings.get(item.record.id) ?? []).flatMap((o) => (isOpening(o.fields) ? [{ fields: o.fields, key: o.record }] : [])),
              },
            ]
          : [],
      ),
    );
    const sights = new Map<string, Sight>();
    for (const item of items) {
      const f = item.fields;
      const id = item.record.id;
      if (f.kind === 'camera') {
        const degrees = looks.get(id)?.degrees ?? null;
        if (degrees !== null) sights.set(id, keepSight(id, coneWedge(f, degrees), blockers, stopsAtWalls(f)));
      } else if (f.kind === 'light') {
        const look = lights.get(id);
        if (look) sights.set(id, keepSight(id, beamWedge(f, look.degrees), blockers, stopsAtWalls(f)));
      } else if (f.kind === 'mark') {
        const look = marks.get(id);
        if (look?.ghost && look.cone !== null) sights.set(id, keepSight(id, coneWedge(f, look.cone), blockers, look.stopAtWalls !== false));
      }
    }
    return sights;
  };
}

/** What the end-to-end tests read of a shape (metres): whether walls cut it, whether it's empty, its corner count and box. */
export interface SightSummary {
  cut: boolean;
  empty: boolean;
  /** Where it is seen from (6.18 second review): the camera's or light's middle. */
  apex: { x: number; y: number };
  corners: number;
  box: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

/**
 * A cone's or a beam's shape as the tests read it from the page: whether walls cut it, whether it is empty (its apex in a
 * wall), where it is seen from, how many corners it has and the box round them, to 0.1 mm. Never the corners themselves (6.18 review): this is
 * written into the page on every edit, and a cut all-round light has dozens. Null for an item with no cone.
 */
export function sightSummary(sight: Sight | undefined): SightSummary | null {
  if (!sight) return null;
  const round = (n: number) => Math.round(n * 10000) / 10000;
  const xs = sight.points.map((p) => p.x);
  const ys = sight.points.map((p) => p.y);
  const box = sight.points.length === 0 ? null : { minX: round(Math.min(...xs)), minY: round(Math.min(...ys)), maxX: round(Math.max(...xs)), maxY: round(Math.max(...ys)) };
  return { cut: sight.cut, empty: sight.empty, apex: { x: round(sight.apex.x), y: round(sight.apex.y) }, corners: sight.points.length, box };
}

/** Runs of consecutive edges of the kinds drawn, each as the corners it joins. */
function runs(sight: Sight, drawn: ReadonlySet<SightEdge>): number[][][] {
  const n = sight.points.length;
  if (n < 2) return [];
  const out: number[][][] = [];
  // A ring starts after an edge that isn't drawn, so a run across its first corner is one run.
  const first = sight.ring ? Math.max(0, sight.edges.findIndex((e) => !drawn.has(e))) : 0;
  if (sight.ring && sight.edges.every((e) => drawn.has(e))) {
    return [[...sight.points, sight.points[0]].flatMap((p) => (p ? [[p.x, p.y]] : []))];
  }
  let run: number[][] = [];
  for (let k = 0; k < n; k += 1) {
    const i = (first + k) % n;
    const from = sight.points[i];
    const to = sight.points[(i + 1) % n];
    if (!from || !to) continue;
    if (drawn.has(sight.edges[i] ?? 'wall')) {
      if (run.length === 0) run.push([from.x, from.y]);
      run.push([to.x, to.y]);
    } else if (run.length > 0) {
      out.push(run);
      run = [];
    }
  }
  if (run.length > 0) out.push(run);
  return out;
}

/**
 * A cut shape in an item's own box (canvas units: 1 cm), as its beyond drawing is turned with it: from the box's middle,
 * turned back by its rotation. Null for an uncut one: the item draws its wedge as it always has. A camera strokes its
 * shape's sides (its far edge stays open, as its cone's is); a light its sides and its arc.
 */
export function localSight(sight: Sight | undefined, box: { width: number; height: number; rotation: number }, kind: 'cone' | 'beam'): LocalSight | null {
  if (!sight?.cut) return null;
  const turn = (-box.rotation * Math.PI) / 180;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const centre = sight.apex;
  const local = (x: number, y: number): [number, number] => {
    const dx = (x - centre.x) * UNITS_PER_METRE;
    const dy = (y - centre.y) * UNITS_PER_METRE;
    return [box.width / 2 + dx * cos - dy * sin, box.height / 2 + dx * sin + dy * cos];
  };
  const flat = (points: readonly { x: number; y: number }[]) => points.flatMap((p) => local(p.x, p.y));
  const drawn = new Set<SightEdge>(kind === 'cone' ? ['side'] : ['side', 'far']);
  const strokes = runs(sight, drawn).map((run) => run.flatMap(([x, y]) => local(x ?? 0, y ?? 0)));
  // The glow's bands, for an all-round light on paper: each the circle of its radius clipped by the shape (glowBand).
  let bands: number[][] | null = null;
  const bandsOf = (): number[][] => {
    if (bands) return bands;
    bands = [];
    if (kind === 'beam' && sight.ring && !sight.empty) {
      const outer = Math.max(...sight.reach);
      for (let k = GLOW_BANDS; k >= 1; k -= 1) bands.push(flat(glowBand(sight, (outer * k) / GLOW_BANDS)));
    }
    return bands;
  };
  return { fill: flat(sight.points), strokes, bands: bandsOf };
}

/** How far a ray from a ring's apex along `angle` (radians clockwise from up) goes before it leaves the shape. */
function rayOut(sight: Sight, angle: number): number {
  const d = { x: Math.sin(angle), y: -Math.cos(angle) };
  const n = sight.points.length;
  let best = Infinity;
  let touches = false;
  for (let i = 0; i < n; i += 1) {
    const p = sight.points[i] as { x: number; y: number };
    const q = sight.points[(i + 1) % n] as { x: number; y: number };
    const ex = q.x - p.x;
    const ey = q.y - p.y;
    const den = d.x * ey - d.y * ex;
    if (Math.abs(den) < 1e-15) continue;
    const ax = p.x - sight.apex.x;
    const ay = p.y - sight.apex.y;
    const t = (ax * ey - ay * ex) / den;
    const s = (ax * d.y - ay * d.x) / den;
    if (s < -1e-12 || s > 1 + 1e-12) continue;
    if (t > 1e-12) best = Math.min(best, t);
    else if (t > -1e-9) touches = true;
  }
  // The apex on the shape's own edge (a light standing on a wall's or a jamb's end, 6.18 last review): a ray that leaves
  // it into the blocked side meets nothing further, so whether it runs inside the shape at all is read just past the apex.
  if (touches && !insideShape(sight.points, { x: sight.apex.x + d.x * 1e-6, y: sight.apex.y + d.y * 1e-6 })) return 0;
  return best;
}

/** Whether a point is inside a ring of corners (even-odd). */
function insideShape(points: readonly { x: number; y: number }[], at: { x: number; y: number }): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i] as { x: number; y: number };
    const b = points[j] as { x: number; y: number };
    if (a.y > at.y !== b.y > at.y && at.x < ((b.x - a.x) * (at.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * An all-round light's cut glow as a print band (6.18 second review): the circle of radius `r` round its apex, clipped by
 * the cut shape (metres), the shape seen from the apex being star-shaped: along every ray it ends at the nearer of the
 * circle and the shape's edge. Followed every ARC_STEP_DEG round the circle, at every corner of the shape and wherever
 * an edge crosses the circle, so a wall's face is a straight chord where it cuts the band and the band is a whole circle
 * where nothing does. For paper only, where a PDF can't hold the screen's gradient: worked out when asked, never per frame.
 */
export function glowBand(sight: Sight, r: number): { x: number; y: number }[] {
  const { apex, points } = sight;
  const angleOf = (p: { x: number; y: number }) => Math.atan2(p.x - apex.x, -(p.y - apex.y));
  const steps = Math.ceil(360 / ARC_STEP_DEG);
  const angles: number[] = Array.from({ length: steps }, (_, k) => (2 * Math.PI * k) / steps);
  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    const p = points[i] as { x: number; y: number };
    const q = points[(i + 1) % n] as { x: number; y: number };
    angles.push(angleOf(p));
    // Where the edge from p to q crosses the circle.
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const fx = p.x - apex.x;
    const fy = p.y - apex.y;
    const a = dx * dx + dy * dy;
    const b = 2 * (fx * dx + fy * dy);
    const disc = b * b - 4 * a * (fx * fx + fy * fy - r * r);
    if (a === 0 || disc < 0) continue;
    for (const s of [(-b - Math.sqrt(disc)) / (2 * a), (-b + Math.sqrt(disc)) / (2 * a)]) if (s >= 0 && s <= 1) angles.push(angleOf({ x: p.x + dx * s, y: p.y + dy * s }));
  }
  const tau = 2 * Math.PI;
  const sorted = angles.map((a) => ((a % tau) + tau) % tau).sort((a, b) => a - b);
  const out: { x: number; y: number }[] = [];
  let last = -Infinity;
  for (const angle of sorted) {
    if (angle - last < 1e-9) continue;
    last = angle;
    const reach = Math.min(r, rayOut(sight, angle));
    out.push({ x: apex.x + Math.sin(angle) * reach, y: apex.y - Math.cos(angle) * reach });
  }
  return out;
}
