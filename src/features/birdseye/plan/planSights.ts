import { isOpening, isWallFields, stopsAtWalls, type ShownItem } from '../../../core/model/plan';
import { CONE_LENGTH_M } from '../../../core/model/planCamera';
import { BEAM_LENGTH_M, beamDirection } from '../../../core/model/planLight';
import { blockersKeeper, sightlineKeeper, type Sight, type SightEdge, type Wedge } from '../../../core/model/planSightlines';
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
  /** For an all-round light's glow: the shape cut at each band's radius, outermost first. */
  bands: number[][];
}

/** How many bands an all-round light's glow is drawn in when walls cut it (as many as a print's rings, deckDisplay.ts). */
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
  // The glow's bands, for an all-round light: the shape with every corner brought in to the band's radius.
  const bands: number[][] = [];
  if (kind === 'beam' && sight.ring && !sight.empty) {
    const outer = Math.max(...sight.reach);
    for (let k = GLOW_BANDS; k >= 1; k -= 1) {
      const r = (outer * k) / GLOW_BANDS;
      bands.push(
        flat(
          sight.points.map((p, i) => {
            const d = sight.reach[i] ?? 0;
            const f = d > r && d > 0 ? r / d : 1;
            return { x: centre.x + (p.x - centre.x) * f, y: centre.y + (p.y - centre.y) * f };
          }),
        ),
      );
    }
  }
  return { fill: flat(sight.points), strokes, bands };
}
