import { centreOfBox, wallUnder } from '../../../core/model/openings';
import { isCamera, isLight, isMark, isOpening, isWallFields, stopsAtWalls, type OpeningFields, type PlanItemFields, type ShownItem } from '../../../core/model/plan';
import { boxesMeet, sightline, wallBlocker, wedgeBox, type Blocker, type Box, type Sight, type Wedge } from '../../../core/model/planSightlines';
import type { CanvasItem, Geometry } from '../../../ui/canvas/types';
import type { CameraLook } from './cameraDraw';
import type { LightLook } from './lightDraw';
import type { BlockingLooks } from './markLooks';
import { cameraBeyondOf, lightBeyondOf, markBeyondOf, metresOf } from './planItems';
import { toMetres } from './planScale';
import { beamWedge, coneWedge, localSight, sightSummary } from './planSights';

// Walls stop cones and beams at once (6.18, decision 5; review item 3): while a camera, a light or a camera's later
// position is dragged or turned, its cone or beam is cut where it is now; while a wall, a door or a window is dragged
// (or a wall resized), every cone and beam whose wedge's box meets the wall, where it was or where it is now, is cut by
// it where it is now. The canvas asks on every step of the gesture (its `liveItems`), with the live boxes; this gives back
// those items with what they draw past their boxes made again, and nothing else, so the canvas keeps every other item as
// it was. Nothing is written: the gesture's one edit comes at the drop, and Escape puts every shape back. One sightline
// is well under a frame; only the items a gesture touches get one.

/** What the plan drew last from the records, for the live remake to start from. */
export interface LiveSightsFrom {
  /** What blocks: the room's walls and openings, every layer (planSights.ts's `blocking`). */
  blocking: readonly ShownItem[];
  /** What is drawn (the layers' visible items): the cameras, lights and camera positions among them may be cut. */
  items: readonly ShownItem[];
  /** The canvas items as built from the records, by which the remade ones are made. */
  built: readonly CanvasItem[];
  looks: ReadonlyMap<string, CameraLook>;
  lights: ReadonlyMap<string, LightLook>;
  marks: BlockingLooks;
}

const NONE: ReadonlyMap<string, CanvasItem> = new Map();

/** How near a wall's middle line, past its half thickness, an opening's middle is taken to be on it (metres). */
const ON_WALL_M = 0.05;

/**
 * The canvas's `liveItems` for a plan: `publish` is given the remade shapes' summaries (sightSummary, by id) as JSON for
 * the end-to-end tests, and null whenever it remade none (no gesture under way, or none that touches a cone or beam).
 */
export function liveSights(from: LiveSightsFrom, publish: (summaries: string | null) => void): (live: ReadonlyMap<string, Geometry> | null) => ReadonlyMap<string, CanvasItem> {
  const shownById = new Map<string, ShownItem>();
  for (const item of from.blocking) shownById.set(item.record.id, item);
  for (const item of from.items) shownById.set(item.record.id, item);
  const walls = from.blocking.flatMap((item) => (isWallFields(item.fields) ? [{ id: item.record.id, fields: item.fields }] : []));
  const openings = from.blocking.flatMap((item) => (isOpening(item.fields) ? [{ id: item.record.id, fields: item.fields }] : []));
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
  // Told null every time, not only after this one published: the plan makes this again when the selection changes, and
  // a drag picks what it presses and Escape lets it go, so the shapes last published may be another one's.
  const quiet = (): ReadonlyMap<string, CanvasItem> => {
    publish(null);
    return NONE;
  };
  return (live) => {
    if (!live) return quiet();
    const moving = [...live.keys()].filter((id) => {
      const item = shownById.get(id);
      return item !== undefined && (isWallFields(item.fields) || isOpening(item.fields) || coneIds.has(id));
    });
    if (moving.length === 0) return quiet();
    // The walls as they are now: a dragged or resized one where the gesture has it.
    const wallNow = new Map<string, PlanItemFields>(walls.map((wall) => {
      const g = live.get(wall.id);
      return [wall.id, g ? { ...wall.fields, ...metresOf(g) } : wall.fields];
    }));
    // Each opening on the wall it is on now: one on a moving wall moves with it (its distance along kept); one dragged
    // by itself lands on the wall its middle is over, at that distance along it.
    const changed = new Set<string>(walls.filter((wall) => live.has(wall.id)).map((wall) => wall.id));
    const openingNow = openings.map((o) => {
      const g = live.get(o.id);
      if (!g || live.has(o.fields.wallId)) return o.fields;
      const centre = centreOfBox({ x: toMetres(g.x), y: toMetres(g.y), width: toMetres(g.width), height: toMetres(g.height), rotation: g.rotation }, { ...o.fields, width: toMetres(g.width) });
      const own = walls.filter((wall) => wall.id === o.fields.wallId).map((wall) => ({ id: wall.id, fields: wallNow.get(wall.id) ?? wall.fields }));
      const all = walls.map((wall) => ({ id: wall.id, fields: wallNow.get(wall.id) ?? wall.fields }));
      const on = wallUnder(own, centre, ON_WALL_M) ?? wallUnder(all, centre, ON_WALL_M);
      changed.add(o.fields.wallId);
      if (!on) return o.fields;
      changed.add(on.id);
      return { ...o.fields, wallId: on.id, along: on.along };
    });
    const before = storedBlockers();
    const blockers: Blocker[] = [];
    const reached: Box[] = [];
    for (const wall of walls) {
      const was = before.get(wall.id);
      if (!changed.has(wall.id) && was) {
        blockers.push(was);
        continue;
      }
      const now = wallBlocker(wall.id, wallNow.get(wall.id) ?? wall.fields, openingNow.filter((o: OpeningFields) => o.wallId === wall.id));
      blockers.push(now);
      if (was) reached.push(was.box);
      reached.push(now.box);
    }
    const out = new Map<string, CanvasItem>();
    const summaries: Record<string, ReturnType<typeof sightSummary>> = {};
    for (const item of cones) {
      const id = item.record.id;
      const base = builtById.get(id);
      if (!base) continue;
      const g = live.get(id);
      const fields = g ? { ...item.fields, ...metresOf(g) } : item.fields;
      const made = wedgeOf(item, fields);
      if (!made) continue;
      // A still item is cut again only when a wall that changed meets its wedge, where the wall was or where it is now.
      if (!g && !reached.some((box) => boxesMeet(box, wedgeBox(made.wedge)))) continue;
      const sight: Sight = sightline(made.wedge, blockers, made.stop);
      const box: Geometry = g ?? { x: base.x, y: base.y, width: base.width, height: base.height, rotation: base.rotation };
      // In the item's own box as the canvas draws it now: its size as built (the handles scale the node, never the
      // drawing past it), turned as it is now.
      const turned = { width: base.width, height: base.height, rotation: box.rotation };
      const stood = { x: base.x, y: base.y, width: base.width, height: base.height, rotation: base.rotation };
      const f = item.fields;
      const beyond = isCamera(f)
        ? cameraBeyondOf(box, from.looks.get(id) ?? { degrees: null, lines: [], selected: false }, from.marks.paths.get(id) ?? null, localSight(sight, turned, 'cone'), stood)
        : isLight(f)
          ? from.lights.has(id)
            ? lightBeyondOf(box, f.icon, from.lights.get(id) as LightLook, localSight(sight, turned, 'beam'))
            : undefined
          : isMark(f)
            ? markBeyondOf(box, f, from.marks.marks.get(id) ?? null, from.marks.paths.get(id) ?? null, localSight(sight, turned, 'cone'), stood)
            : undefined;
      if (!beyond) continue;
      out.set(id, { ...base, beyond });
      summaries[id] = sightSummary(sight);
    }
    if (out.size === 0) return quiet();
    publish(JSON.stringify(summaries));
    return out;
  };
}
