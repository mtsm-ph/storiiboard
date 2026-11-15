import { isCamera, isLight, isMark, isOpening, isWallFields, openingFields, planItemFields, stopsAtWalls, type OpeningFields, type PlanItemFields, type PlanViewOf, type ShownItem } from '../../../core/model/plan';
import { boxesMeet, sightline, wallBlocker, wedgeBox, type Blocker, type Box, type Sight, type Wedge } from '../../../core/model/planSightlines';
import type { Props, SbdRecord } from '../../../core/model/record';
import type { CanvasItem, Geometry, LiveBy, Rect } from '../../../ui/canvas/types';
import { rectsMeet } from '../../../ui/canvas/viewport';
import type { CameraLook } from './cameraDraw';
import type { LightLook } from './lightDraw';
import type { BlockingLooks } from './markLooks';
import { cameraBeyondOf, lightBeyondOf, markBeyondOf, metresOf, planGeometryUpdates, shownWalls } from './planItems';
import { beamWedge, coneWedge, localSight, sightSummary, type SightSummary } from './planSights';

// Walls stop cones and beams at once (6.18, decision 5; review items 3 and, second round, 1): while a camera, a light or
// a camera's later position is dragged or turned, its cone or beam is cut where it is now; while a wall, a door or a
// window is dragged, or a wall resized or turned by its handles, every cone and beam whose wedge's box meets the wall,
// where it was or where it is now, is cut by it where it is now. The canvas asks on every step of the gesture (its
// `liveItems`), with the live boxes; this gives back those items with what they draw past their boxes made again, and
// nothing else, so the canvas keeps every other item as it was. Nothing is written: the gesture's one edit comes at the
// drop, and Escape puts every shape back. One sightline is well under a frame; only the items a gesture touches get one.
//
// Where the walls and their doors and windows are mid-gesture is what the drop will write, by construction: the live
// boxes go through the drop's own geometry (planGeometryUpdates: planGeometryChanges less the moves into another plan,
// so no sort key is read mid-drawing) (a wall resized from its start keeps its openings where they are
// in the room and is held at the length they need; an opening lands on the wall it is over), and the shapes are cut by
// the walls and openings those changes make. So the cone never jumps at the drop.

/** What the plan drew last from the records, for the live remake to start from. */
export interface LiveSightsFrom {
  records: Readonly<Record<string, SbdRecord>>;
  view: PlanViewOf;
  /** What blocks: the room's walls and openings, every layer (planSights.ts's `blocking`, the view's shown items). */
  blocking: readonly ShownItem[];
  /** What is drawn (the layers' visible items): the cameras, lights and camera positions among them may be cut. */
  items: readonly ShownItem[];
  /** The canvas items as built from the records, by which the remade ones are made. */
  built: readonly CanvasItem[];
  looks: ReadonlyMap<string, CameraLook>;
  lights: ReadonlyMap<string, LightLook>;
  marks: BlockingLooks;
}

/** The canvas's `liveItems` for a plan, and what the end-to-end tests read of a remake (its shapes' summaries, by id). */
export interface LiveSights {
  /** `seen`: the part of the world in view (canvas units); a still item whose drawing lies wholly out of it is left as it is. */
  items: (live: ReadonlyMap<string, Geometry> | null, by: LiveBy, seen?: Rect | null) => ReadonlyMap<string, CanvasItem>;
  summaries: (made: ReadonlyMap<string, CanvasItem> | null) => Record<string, SightSummary | null> | null;
}

const NONE: ReadonlyMap<string, CanvasItem> = new Map();

/** Props as an update leaves them. */
const updated = (props: Props, set: Props | undefined, unset: readonly string[] | undefined): Props => {
  const gone = new Set(unset ?? []);
  return Object.fromEntries(Object.entries({ ...props, ...(set ?? {}) }).filter(([name]) => !gone.has(name)));
};

export function liveSights(from: LiveSightsFrom): LiveSights {
  const shownById = new Map<string, ShownItem>();
  for (const item of from.blocking) shownById.set(item.record.id, item);
  for (const item of from.items) shownById.set(item.record.id, item);
  const walls = from.blocking.flatMap((item) => (isWallFields(item.fields) ? [{ id: item.record.id, fields: item.fields }] : []));
  const openings = from.blocking.flatMap((item) => (isOpening(item.fields) ? [{ id: item.record.id, fields: item.fields }] : []));
  const wallChoices = shownWalls(from.blocking);
  const builtById = new Map(from.built.map((item) => [item.id, item]));
  /** The wedge an item's cone or beam is drawn as from these fields (metres), and its switch; null for one with none. */
  const wedgeOf = (item: ShownItem, f: ShownItem['fields']): { wedge: Wedge; stop: boolean } | null => {
    const id = item.record.id;
    if (isCamera(f)) {
      const degrees = from.looks.get(id)?.degrees ?? null;
      return degrees === null ? null : { wedge: coneWedge(f, degrees), stop: stopsAtWalls(f) };
    }
    if (isLight(f)) {
      const look = from.lights.get(id);
      return look ? { wedge: beamWedge(f, look.degrees), stop: stopsAtWalls(f) } : null;
    }
    if (isMark(f)) {
      const look = from.marks.marks.get(id);
      return look?.ghost && look.cone !== null ? { wedge: coneWedge(f, look.cone), stop: look.stopAtWalls !== false } : null;
    }
    return null;
  };
  const cones = from.items.filter((item) => builtById.has(item.record.id) && wedgeOf(item, item.fields) !== null);
  const coneIds = new Set(cones.map((item) => item.record.id));
  // The walls' blockers as the records have them, made when a gesture first needs them, then kept for this drawing.
  let stored: Map<string, Blocker> | null = null;
  const storedBlockers = (): Map<string, Blocker> => {
    stored ??= new Map(walls.map((wall) => [wall.id, wallBlocker(wall.id, wall.fields, openings.filter((o) => o.fields.wallId === wall.id).map((o) => o.fields))]));
    return stored;
  };
  // Each remake's shapes, summarised for the tests only when asked (a release build never asks).
  const told = new WeakMap<ReadonlyMap<string, CanvasItem>, ReadonlyMap<string, Sight>>();

  const items = (live: ReadonlyMap<string, Geometry> | null, by: LiveBy, seen: Rect | null = null): ReadonlyMap<string, CanvasItem> => {
    if (!live) return NONE;
    const blocks = [...live.keys()].filter((id) => {
      const item = shownById.get(id);
      return item !== undefined && (isWallFields(item.fields) || isOpening(item.fields));
    });
    if (blocks.length === 0 && ![...live.keys()].some((id) => coneIds.has(id))) return NONE;
    // The walls and openings as the drop would write them (the drop's own changes), and which walls that changes.
    const wallNow = new Map<string, PlanItemFields>(walls.map((wall) => [wall.id, wall.fields]));
    const openingNow = new Map<string, OpeningFields>(openings.map((o) => [o.id, o.fields]));
    const changed = new Set<string>();
    if (blocks.length > 0) {
      const changes = planGeometryUpdates(
        from.records,
        blocks.map((id) => ({ id, ...(live.get(id) as Geometry) })),
        wallChoices,
        from.view,
      );
      for (const change of changes) {
        if (change.kind !== 'update') continue;
        const record = from.records[change.id];
        if (!record) continue;
        const props = updated(record.props, change.set, change.unset);
        const wall = wallNow.has(change.id) ? planItemFields(props) : null;
        if (wall) {
          wallNow.set(change.id, wall);
          changed.add(change.id);
        }
        const was = openingNow.get(change.id);
        const opening = was ? openingFields(props) : null;
        if (was && opening) {
          openingNow.set(change.id, opening);
          changed.add(was.wallId);
          changed.add(opening.wallId);
        }
      }
      // A wall moved or turned with its openings writes only the wall: they go with it, as stored.
      for (const id of blocks) if (wallNow.has(id)) changed.add(id);
    }
    const before = storedBlockers();
    const blockers: Blocker[] = [];
    const reached: Box[] = [];
    for (const wall of walls) {
      const was = before.get(wall.id);
      if (!changed.has(wall.id) && was) {
        blockers.push(was);
        continue;
      }
      const inWall = [...openingNow.values()].filter((o) => o.wallId === wall.id);
      const now = wallBlocker(wall.id, wallNow.get(wall.id) ?? wall.fields, inWall);
      blockers.push(now);
      if (was) reached.push(was.box);
      reached.push(now.box);
    }
    const out = new Map<string, CanvasItem>();
    const sights = new Map<string, Sight>();
    for (const item of cones) {
      const id = item.record.id;
      const base = builtById.get(id);
      if (!base) continue;
      const g = live.get(id);
      // Out of view, a still item is drawn anew at the drop, never in between: every cone and beam a 40-wall drag meets
      // made again each move cost a dev build 70 ms a move (6.18 last review), most of it for items no one could see.
      if (!g && seen && base.beyond && !rectsMeet(base.beyond.bounds, seen)) continue;
      const fields = g ? { ...item.fields, ...metresOf(g) } : item.fields;
      const made = wedgeOf(item, fields);
      if (!made) continue;
      // A still item is cut again only when a wall that changed meets its wedge, where the wall was or where it is now.
      if (!g && !reached.some((box) => boxesMeet(box, wedgeBox(made.wedge)))) continue;
      const sight: Sight = sightline(made.wedge, blockers, made.stop);
      const box: Geometry = g ?? { x: base.x, y: base.y, width: base.width, height: base.height, rotation: base.rotation };
      // In the item's own box as the canvas draws it now, turned as it is now. Under the handles the drawing past it keeps
      // its size as built (they scale the node, never that drawing); a drag's draft, the one a resize leaves until its
      // edit is written included, sizes the item as the draft does (6.18 second review, item 4).
      const sized = by === 'handles' || !g ? base : g;
      const turned = { width: sized.width, height: sized.height, rotation: box.rotation };
      const stood = { x: base.x, y: base.y, width: base.width, height: base.height, rotation: base.rotation };
      const f = item.fields;
      const look = isLight(f) ? from.lights.get(id) : undefined;
      const beyond = isCamera(f)
        ? cameraBeyondOf(box, from.looks.get(id) ?? { degrees: null, lines: [], selected: false }, from.marks.paths.get(id) ?? null, localSight(sight, turned, 'cone'), stood)
        : isLight(f)
          ? look
            ? lightBeyondOf(box, f.icon, look, localSight(sight, turned, 'beam'))
            : undefined
          : isMark(f)
            ? markBeyondOf(box, f, from.marks.marks.get(id) ?? null, from.marks.paths.get(id) ?? null, localSight(sight, turned, 'cone'), stood)
            : undefined;
      if (!beyond) continue;
      out.set(id, { ...base, beyond });
      sights.set(id, sight);
    }
    if (out.size === 0) return NONE;
    told.set(out, sights);
    return out;
  };
  const summaries = (made: ReadonlyMap<string, CanvasItem> | null): Record<string, SightSummary | null> | null => {
    const sights = made ? told.get(made) : undefined;
    return sights ? Object.fromEntries([...sights].map(([id, sight]) => [id, sightSummary(sight)])) : null;
  };
  return { items, summaries };
}
