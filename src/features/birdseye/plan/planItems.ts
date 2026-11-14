import { createElement, Fragment, type ReactNode } from 'react';
import { Line, Rect } from 'react-konva';
import { getLocale, t } from '../../../core/i18n';
import { formatLength, type PlanUnit } from '../../../core/model/length';
import { centreOfBox, fitAlong, fitsAt, onStep, openingFrame, projectOnWall, swingSign, wallAxes, wallNeeds, wallUnder, type OpeningFrame } from '../../../core/model/openings';
import {
  isOpening,
  lastKeyUnder,
  MIN_PLAN_SIZE,
  normalDegrees,
  OPENING_WIDTH,
  openingFields,
  openingsOf,
  planItemFields,
  sceneRoomId,
  shownFields,
  shownItems,
  wallBetween,
  wallEnds,
  wallProps,
  wallsAlong,
  type Hinge,
  type OpeningFields,
  type OpeningKind,
  type PlanGeometry,
  type PlanItemFields,
  type ShownFields,
  type ShownItem,
  type Swing,
} from '../../../core/model/plan';
import type { Props, SbdRecord } from '../../../core/model/record';
import type { Change } from '../../../core/ops/ops';
import { keyBetween } from '../../../core/ops/order';
import { pasted } from '../../../ui/canvas/placement';
import type { GridSnap } from '../../../ui/canvas/scale';
import type { CanvasColours, CanvasItem, Geometry, GeometryChange, Point, ReorderMode } from '../../../ui/canvas/types';
import { reordered, sortKeysFor } from '../../../ui/canvas/zOrder';
import { planScale, toCanvas, toMetres } from './planScale';
import { wallOutline, type WallLine } from './wallShape';

// A plan's items for the canvas core and back (6.2a, 6.2b): records in metres become CanvasItems in canvas units
// (1 cm), and what a gesture or a field changed becomes updates in metres again. Pure, so each edit is tested without a
// browser. The items of every level a view shows are drawn together (the room's first); an edit reaches each item in
// its own plan. A door or window has no place of its own: it is drawn from its wall, and a drag slides it along a wall.

type Records = Readonly<Record<string, SbdRecord>>;

/** A plan view's key: the setup it shows, or the scene with no setup picked. */
export const viewKey = (sceneId: string, setupId: string | null): string => (setupId ? `setup:${setupId}` : `scene:${sceneId}`);

/** A live wall, with its fields. */
function liveItem(records: Records, id: string): { record: SbdRecord; fields: PlanItemFields } | null {
  const record = records[id];
  if (record?.type !== 'plan_item' || record.trashedAt !== null) return null;
  const fields = planItemFields(record.props);
  return fields ? { record, fields } : null;
}

/** A live door or window, with its fields and its live wall's. */
function liveOpening(records: Records, id: string): { record: SbdRecord; fields: OpeningFields; wall: { record: SbdRecord; fields: PlanItemFields } } | null {
  const record = records[id];
  if (record?.type !== 'plan_item' || record.trashedAt !== null) return null;
  const fields = openingFields(record.props);
  const wall = fields ? liveItem(records, fields.wallId) : null;
  return fields && wall ? { record, fields, wall } : null;
}

const toCanvasGeometry = (g: PlanGeometry): Geometry => ({ x: toCanvas(g.x), y: toCanvas(g.y), width: toCanvas(g.width), height: toCanvas(g.height), rotation: g.rotation });

/** A wall as a line with ends, canvas units. */
const lineOf = (id: string, fields: PlanItemFields): WallLine => {
  const [start, end] = wallEnds(fields);
  return { id, start: { x: toCanvas(start.x), y: toCanvas(start.y) }, end: { x: toCanvas(end.x), y: toCanvas(end.y) }, thickness: toCanvas(fields.height) };
};

/** What a wall is called aloud: "Wall, 3.50 m". */
export const wallLabel = (fields: PlanItemFields, unit: PlanUnit): string =>
  fields.name === '' ? t('plan.announce.wall', { length: formatLength(fields.width, unit) }) : t('plan.announce.wallNamed', { name: fields.name, length: formatLength(fields.width, unit) });

/** What a door or window is called aloud: "Door, 0.90 m". */
export const openingLabel = (fields: OpeningFields, unit: PlanUnit): string => {
  const width = formatLength(fields.width, unit);
  if (fields.name !== '') return t(fields.kind === 'door' ? 'plan.announce.doorNamed' : 'plan.announce.windowNamed', { name: fields.name, width });
  return t(fields.kind === 'door' ? 'plan.announce.door' : 'plan.announce.window', { width });
};

/** The walls whose ends meet each wall's (within a cell of a millimetre's join), found through a grid of their ends, not pair by pair. */
function joinedTo(lines: readonly WallLine[]): Map<string, WallLine[]> {
  // Cells of 1 canvas unit (1 cm), far wider than the 1 mm join: two ends that join are in the same or a neighbouring cell.
  const cell = (p: Point) => [Math.floor(p.x), Math.floor(p.y)] as const;
  const ends = new Map<string, WallLine[]>();
  for (const line of lines) {
    for (const p of [line.start, line.end]) {
      const [cx, cy] = cell(p);
      const key = `${String(cx)},${String(cy)}`;
      const here = ends.get(key);
      if (here) here.push(line);
      else ends.set(key, [line]);
    }
  }
  const joined = new Map<string, WallLine[]>();
  for (const line of lines) {
    const near = new Set<WallLine>();
    for (const p of [line.start, line.end]) {
      const [cx, cy] = cell(p);
      for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) for (const other of ends.get(`${String(cx + dx)},${String(cy + dy)}`) ?? []) if (other !== line) near.add(other);
    }
    joined.set(line.id, [...near]);
  }
  return joined;
}

const ARC_STEPS = 24;

/**
 * A door or window as a plan draws it, in its own box (canvas units): a gap in the wall (paper over the wall's ink,
 * since a board's content is never themed) with its jambs; a door's leaf standing open and the quarter circle it
 * swings through; a window's thin double line.
 */
function drawOpening(o: OpeningFields, frame: OpeningFrame, colours: CanvasColours): ReactNode {
  const w = toCanvas(o.width);
  const t = toCanvas(frame.thickness);
  const lo = toCanvas(frame.lo);
  const X = (a: number) => a + w / 2;
  const Y = (b: number) => b - lo;
  const ink = { stroke: colours.ink, strokeScaleEnabled: false, listening: false } as const;
  const parts: ReactNode[] = [
    createElement(Rect, { key: 'gap', x: 0, y: Y(-t / 2) - 0.5, width: w, height: t + 1, fill: colours.paper, listening: false }),
    createElement(Line, { key: 'jamb-a', points: [X(-w / 2), Y(-t / 2), X(-w / 2), Y(t / 2)], strokeWidth: 1.5, ...ink }),
    createElement(Line, { key: 'jamb-b', points: [X(w / 2), Y(-t / 2), X(w / 2), Y(t / 2)], strokeWidth: 1.5, ...ink }),
  ];
  const side = swingSign(o);
  if (side !== 0) {
    const hinge = o.hinge === 'start' ? -w / 2 : w / 2;
    const toLatch = hinge < 0 ? 1 : -1;
    const face = (side * t) / 2;
    const arc: number[] = [];
    for (let i = 0; i <= ARC_STEPS; i += 1) {
      const turn = (i / ARC_STEPS) * (Math.PI / 2);
      arc.push(X(hinge + toLatch * w * Math.cos(turn)), Y(face + side * w * Math.sin(turn)));
    }
    parts.push(
      createElement(Line, { key: 'leaf', points: [X(hinge), Y(face), X(hinge), Y(face + side * w)], strokeWidth: 1.5, ...ink }),
      createElement(Line, { key: 'arc', points: arc, strokeWidth: 1, ...ink }),
    );
  } else {
    for (const b of [-t / 6, t / 6]) parts.push(createElement(Line, { key: `pane${String(b)}`, points: [X(-w / 2), Y(b), X(w / 2), Y(b)], strokeWidth: 1, ...ink }));
  }
  return createElement(Fragment, null, ...parts);
}

/** A door or window for the canvas, from its wall: moved only, never resized or turned by the handles. */
export function openingItem(id: string, fields: OpeningFields, wall: PlanItemFields, unit: PlanUnit, preview = false): CanvasItem {
  const frame = openingFrame(wall, fields);
  return {
    id,
    ...toCanvasGeometry(frame.box),
    label: openingLabel(fields, unit),
    // It snaps along its wall (planConstrain), never by its box.
    snapPoints: [],
    moveOnly: true,
    ...(preview ? { locked: true, dim: true } : {}),
    draw: (context) => drawOpening(fields, frame, context.colours),
  };
}

/**
 * What a built item depended on: the same record, unit, ink and language (its label is in words), and the same walls at
 * its ends (or its wall), give the same item.
 */
interface Built {
  record: SbdRecord;
  unit: PlanUnit;
  ink: string;
  locale: string;
  neighbours: readonly SbdRecord[];
  item: CanvasItem;
}

const isWall = (item: ShownItem): item is ShownItem & { fields: PlanItemFields } => item.fields.kind === 'wall';
const isOpeningItem = (item: ShownItem): item is ShownItem & { fields: OpeningFields } => isOpening(item.fields);

/**
 * A view's items for the canvas, kept between calls (6.2a): a wall's item is made again only when its record, the unit,
 * the ink or the walls joined at its ends changed (their mitres shape its corners), a door's or window's only when it
 * or its wall changed, so an edit elsewhere in the project rebuilds nothing and the canvas keeps what it drew; when
 * nothing changed, the same list comes back. Doors and windows come after the walls, so they are drawn over them.
 */
export function planItemsBuilder(): (shown: readonly ShownItem[], unit: PlanUnit, ink: string, locale?: string) => readonly CanvasItem[] {
  let built = new Map<string, Built>();
  let last: readonly CanvasItem[] = [];
  return (shown, unit, ink, locale = getLocale()) => {
    const walls = shown.filter(isWall);
    const lines = walls.map((item) => lineOf(item.record.id, item.fields));
    const records = new Map(walls.map((item) => [item.record.id, item.record]));
    const joined = joinedTo(lines);
    const next = new Map<string, Built>();
    const kept = (item: ShownItem, neighbours: readonly SbdRecord[]): CanvasItem | null => {
      const was = built.get(item.record.id);
      if (was && was.record === item.record && was.unit === unit && was.ink === ink && was.locale === locale && was.neighbours.length === neighbours.length && was.neighbours.every((r, k) => r === neighbours[k])) {
        next.set(item.record.id, was);
        return was.item;
      }
      return null;
    };
    const wallItems = walls.map((item, i): CanvasItem => {
      const line = lines[i] as WallLine;
      const near = joined.get(line.id) ?? [];
      const neighbours = near.flatMap((other) => records.get(other.id) ?? []);
      const same = kept(item, neighbours);
      if (same) return same;
      const outline = wallOutline(line, [line, ...near]).flatMap((p) => [p.x, p.y]);
      const made: CanvasItem = {
        id: item.record.id,
        ...toCanvasGeometry(item.fields),
        label: wallLabel(item.fields, unit),
        // A wall snaps by its middle line's ends, never by its box (a move keeps it on the grid line it was on).
        snapPoints: [line.start, line.end],
        draw: () => createElement(Line, { points: outline, closed: true, fill: ink, listening: false }),
      };
      next.set(item.record.id, { record: item.record, unit, ink, locale, neighbours, item: made });
      return made;
    });
    const wallById = new Map(walls.map((item) => [item.record.id, item]));
    const openingItems = shown.filter(isOpeningItem).flatMap((item): CanvasItem[] => {
      const wall = wallById.get(item.fields.wallId);
      if (!wall) return [];
      const same = kept(item, [wall.record]);
      if (same) return [same];
      const made = openingItem(item.record.id, item.fields, wall.fields, unit);
      next.set(item.record.id, { record: item.record, unit, ink, locale, neighbours: [wall.record], item: made });
      return [made];
    });
    const items = [...wallItems, ...openingItems];
    built = next;
    if (items.length === last.length && items.every((item, i) => item === last[i])) return last;
    last = items;
    return items;
  };
}

/** What the canvas draws for a view, back to front: walls as ink bars, mitred where two meet, then doors and windows. */
export function planCanvasItems(records: Records, sceneId: string, setupId: string | null, unit: PlanUnit, ink: string): readonly CanvasItem[] {
  return planItemsBuilder()(shownItems(records, sceneId, setupId), unit, ink);
}

/**
 * A view's shown items, kept between calls: the same list back while every item record is the one it was, so an edit
 * to anything else in the project (a frame, a scene) leaves the plan's items as they are.
 */
export function shownItemsKeeper(): (records: Records, sceneId: string, setupId: string | null) => readonly ShownItem[] {
  let last: readonly ShownItem[] = [];
  let lastKey = '';
  return (records, sceneId, setupId) => {
    const now = shownItems(records, sceneId, setupId);
    const key = viewKey(sceneId, setupId);
    const same = (item: ShownItem, i: number) => {
      const was = last[i];
      return was !== undefined && item.record === was.record && item.level === was.level;
    };
    if (key === lastKey && now.length === last.length && now.every(same)) return last;
    last = now;
    lastKey = key;
    return now;
  };
}

/** The room a run drawn in a scene's view goes into: the live scene's live room, or null (a scene in the Trash takes none). */
export function runRoomId(records: Records, sceneId: string): string | null {
  const scene = records[sceneId];
  if (scene?.type !== 'scene' || scene.trashedAt !== null) return null;
  return sceneRoomId(records, scene);
}

/** A run of walls drawn in a view (canvas units): one wall a segment, into that view's scene's room, never another's. */
export function drawWallsChanges(records: Records, sceneId: string, points: readonly Point[]): { ids: string[]; changes: Change[] } {
  const roomId = runRoomId(records, sceneId);
  if (roomId === null) return { ids: [], changes: [] };
  return wallsAlong(records, roomId, points.map((p) => ({ x: toMetres(p.x), y: toMetres(p.y) })));
}

const sameGeometry = (a: PlanItemFields, b: PlanGeometry): boolean => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height && a.rotation === b.rotation;

/** Closer than this to what's stored is what's stored: the canvas's own rounding (0.1 mm, hundredths of a degree). */
const SAME_METRES = 0.00005;
const SAME_DEGREES = 0.005;

/**
 * A gesture's box with the stored values kept wherever it differs from them by no more than the canvas's rounding, so a
 * handle pressed without a drag writes nothing, and a resize keeps a wall's rotation to the millionth of a degree.
 */
function keptWhereSame(was: PlanItemFields, next: PlanGeometry): PlanGeometry {
  const near = (a: number, b: number) => (Math.abs(a - b) <= SAME_METRES + 1e-12 ? a : b);
  const turn = Math.abs(((((next.rotation - was.rotation) % 360) + 540) % 360) - 180);
  return {
    x: near(was.x, next.x),
    y: near(was.y, next.y),
    width: near(was.width, next.width),
    height: near(was.height, next.height),
    rotation: turn < SAME_DEGREES ? was.rotation : next.rotation,
  };
}

/** A box in metres, its length and thickness never under a centimetre. */
const metresOf = (g: Geometry): PlanGeometry => ({
  x: toMetres(g.x),
  y: toMetres(g.y),
  width: Math.max(MIN_PLAN_SIZE, toMetres(g.width)),
  height: Math.max(MIN_PLAN_SIZE, toMetres(g.height)),
  rotation: normalDegrees(g.rotation),
});

/** The wall from its start, turned and as long as given, keeping the rotation exactly (atan2 of a rounded end may differ). */
function wallFrom(start: Point, rotation: number, length: number, thickness: number): PlanGeometry {
  const turn = (rotation * Math.PI) / 180;
  const g = wallBetween(start, { x: start.x + Math.cos(turn) * length, y: start.y + Math.sin(turn) * length }, thickness);
  return { ...g, rotation: normalDegrees(rotation), width: Math.max(MIN_PLAN_SIZE, Math.round(length * 10000) / 10000) };
}

/** The least length a wall can have and keep its doors and windows where they are. */
export const wallNeedOf = (records: Records, wallId: string): number => wallNeeds(openingsOf(records, wallId).map((o) => o.fields));

/** A wall's new box held at the length its openings need (6.2b): the end that moved least stays where it is. */
function heldAtNeed(was: PlanItemFields, next: PlanGeometry, need: number): PlanGeometry {
  if (next.width >= need - 1e-4) return next;
  const [s0, e0] = wallEnds(was);
  const [s1, e1] = wallEnds(next);
  const startStays = Math.hypot(s1.x - s0.x, s1.y - s0.y) <= Math.hypot(e1.x - e0.x, e1.y - e0.y);
  const { dir } = wallAxes(next);
  const start = startStays ? s1 : { x: e1.x - dir.x * need, y: e1.y - dir.y * need };
  return wallFrom(start, next.rotation, need, next.height);
}

interface WallChoice {
  id: string;
  fields: PlanItemFields;
}

/** The walls a door or window may go into: those the view shows, else those in the plan of its own wall. */
function candidateWalls(records: Records, opening: { wall: { record: SbdRecord } }, walls?: readonly WallChoice[]): readonly WallChoice[] {
  if (walls) return walls;
  return Object.values(records).flatMap((r) => {
    const fields = r.parentId === opening.wall.record.parentId && r.trashedAt === null && r.type === 'plan_item' ? planItemFields(r.props) : null;
    return fields ? [{ id: r.id, fields }] : [];
  });
}

/** How far beyond its face a wall takes a door or window dragged over it (metres). */
const OVER_WALL = 0.3;

/** The walls a view shows, for a door or window to go into. */
export const shownWalls = (shown: readonly ShownItem[]): WallChoice[] => shown.filter(isWall).map((item) => ({ id: item.record.id, fields: item.fields }));

/**
 * Where a door or window dragged to `centre` (metres) lands: on the wall it is over, else along its own, snapped to
 * `step` along the wall, never off its ends or over another opening (`others` gives each wall's, itself left out). On
 * another wall with no room for it, it stays on its own; null when nowhere takes it.
 */
function landing(
  opening: { id: string; fields: OpeningFields; wallId: string },
  centre: Point,
  walls: readonly WallChoice[],
  others: (wallId: string) => readonly { along: number; width: number }[],
  step: number,
): { wallId: string; wall: PlanItemFields; along: number } | null {
  const own = walls.find((w) => w.id === opening.wallId);
  const over = wallUnder(walls, centre, OVER_WALL);
  const tries = [...(over ? [{ wall: over, along: over.along }] : []), ...(own && over?.id !== own.id ? [{ wall: own, along: projectOnWall(own.fields, centre).along }] : [])];
  for (const { wall, along } of tries) {
    const fit = fitAlong(wall.fields.width, opening.fields.width, onStep(along, step), others(wall.id));
    if (fit !== null) return { wallId: wall.id, wall: wall.fields, along: fit };
  }
  return null;
}

/** The openings in a wall as the view shows them, but for the ones left out. */
const spansIn = (shown: readonly ShownItem[], wallId: string, leaveOut: ReadonlySet<string>) =>
  shown.filter(isOpeningItem).filter((item) => item.fields.wallId === wallId && !leaveOut.has(item.record.id)).map((item) => item.fields);

/** The grid's step along a wall for a snap (metres): the grid's, its fine step with Alt, none with ⌘ or Ctrl. */
const stepFor = (unit: PlanUnit, snap: GridSnap): number => {
  const { grid } = planScale(unit);
  return snap === 'off' ? 0 : toMetres(snap === 'fine' ? grid.fine : grid.step);
};

/**
 * Where a move puts a view's items (6.2b; the canvas's `constrainMove`): a door or window slides along its wall, or
 * onto the wall it is dragged over, snapped along it to the grid's step; one on a moving wall moves with it.
 */
export function planConstrain(shown: readonly ShownItem[], unit: PlanUnit): (moving: ReadonlyMap<string, Geometry>, snap: GridSnap) => ReadonlyMap<string, Geometry> {
  const walls = shownWalls(shown);
  const openings = shown.filter(isOpeningItem);
  return (moving, snap) => {
    if (!openings.some((o) => moving.has(o.record.id) || moving.has(o.fields.wallId))) return moving;
    const out = new Map(moving);
    const step = stepFor(unit, snap);
    const movingIds = new Set(moving.keys());
    const still = walls.filter((w) => !movingIds.has(w.id));
    for (const o of openings) {
      const wallMove = moving.get(o.fields.wallId);
      const wall = walls.find((w) => w.id === o.fields.wallId);
      if (!wall) continue;
      if (wallMove) {
        out.set(o.record.id, toCanvasGeometry(openingFrame({ ...wall.fields, ...metresOf(wallMove) }, o.fields).box));
        continue;
      }
      const g = moving.get(o.record.id);
      if (!g) continue;
      const centre = centreOfBox({ x: toMetres(g.x), y: toMetres(g.y), width: toMetres(g.width), height: toMetres(g.height), rotation: g.rotation }, o.fields);
      const pool = still.some((w) => w.id === wall.id) ? still : [...still, wall];
      const landed = landing({ id: o.record.id, fields: o.fields, wallId: wall.id }, centre, pool, (wallId) => spansIn(shown, wallId, movingIds), step);
      const placed = landed ? { wall: landed.wall, along: landed.along } : { wall: wall.fields, along: o.fields.along };
      out.set(o.record.id, toCanvasGeometry(openingFrame(placed.wall, { ...o.fields, along: placed.along }).box));
    }
    return out;
  };
}

/**
 * A finished move, resize or turn (canvas units): one update per item that changed, all one op group. A wall is held at
 * the length its doors and windows need; a door or window lands where its box was put, along a wall (onto another wall
 * it moves to that wall, `wall_id` and all), and one whose wall moved with it is left to follow it.
 */
export function planGeometryChanges(records: Records, changes: readonly GeometryChange[], walls?: readonly WallChoice[]): Change[] {
  const changed = new Set(changes.map((c) => c.id));
  return changes.flatMap((c): Change[] => {
    const opening = liveOpening(records, c.id);
    if (opening) {
      if (changed.has(opening.fields.wallId)) return [];
      const centre = centreOfBox({ x: toMetres(c.x), y: toMetres(c.y), width: toMetres(c.width), height: toMetres(c.height), rotation: c.rotation }, opening.fields);
      const pool = candidateWalls(records, opening, walls);
      const others = (wallId: string) => openingsOf(records, wallId).filter((o) => o.record.id !== c.id && !changed.has(o.record.id)).map((o) => o.fields);
      const landed = landing({ id: c.id, fields: opening.fields, wallId: opening.fields.wallId }, centre, pool.some((w) => w.id === opening.fields.wallId) ? pool : [...pool, { id: opening.wall.record.id, fields: opening.wall.fields }], others, 0);
      if (!landed || (landed.wallId === opening.fields.wallId && Math.abs(landed.along - opening.fields.along) < 1e-4)) return [];
      const set: Props = { along_m: landed.along };
      if (landed.wallId !== opening.fields.wallId) set.wall_id = landed.wallId;
      const move: Change[] = [];
      // Into a wall that sits in another plan (one setup's own), the opening goes with it there.
      const wallPlan = records[landed.wallId]?.parentId ?? null;
      if (wallPlan !== null && wallPlan !== opening.record.parentId) move.push({ kind: 'move', id: c.id, parentId: wallPlan, sortKey: keyBetween(lastKeyUnder(records, wallPlan, 'plan_item'), null) });
      return [{ kind: 'update', id: c.id, set }, ...move];
    }
    const live = liveItem(records, c.id);
    if (!live) return [];
    const next = keptWhereSame(live.fields, heldAtNeed(live.fields, keptWhereSame(live.fields, metresOf(c)), wallNeedOf(records, c.id)));
    if (sameGeometry(live.fields, next)) return [];
    return [{ kind: 'update', id: c.id, set: { x: next.x, y: next.y, width: next.width, height: next.height, rotation: next.rotation } }];
  });
}

/**
 * An arrow key's nudge (canvas units), added to each item as it is when the edit is written. A door or window moves
 * along its wall by the nudge's length, towards the wall's end when the arrow points that way (Right and Down when it
 * points across); one whose wall is nudged too moves with it.
 */
export function planNudgeChanges(records: Records, ids: readonly string[], dx: number, dy: number): Change[] {
  const picked = new Set(ids);
  return ids.flatMap((id): Change[] => {
    const opening = liveOpening(records, id);
    if (opening) {
      if (picked.has(opening.fields.wallId)) return [];
      const { dir } = wallAxes(opening.wall.fields);
      const towards = dx * dir.x + dy * dir.y;
      const sign = Math.abs(towards) > 1e-9 ? Math.sign(towards) : Math.sign(dx + dy);
      const wanted = opening.fields.along + sign * toMetres(Math.hypot(dx, dy));
      const others = openingsOf(records, opening.fields.wallId).filter((o) => o.record.id !== id).map((o) => o.fields);
      const fit = fitAlong(opening.wall.fields.width, opening.fields.width, wanted, others);
      if (fit === null || Math.abs(fit - opening.fields.along) < 1e-4) return [];
      return [{ kind: 'update', id, set: { along_m: fit } }];
    }
    const live = liveItem(records, id);
    if (!live) return [];
    const g = toCanvasGeometry(live.fields);
    return planGeometryChanges(records, [{ id, ...g, x: g.x + dx, y: g.y + dy }]);
  });
}

/** The items to the Trash, in one group: a wall with the doors and windows in it, so a restore brings them back. */
export function trashPlanItemsChanges(records: Records, ids: readonly string[]): Change[] {
  const going = new Set<string>();
  for (const id of ids) {
    if (!liveItem(records, id) && !liveOpening(records, id)) continue;
    going.add(id);
    if (liveItem(records, id)) for (const o of openingsOf(records, id)) going.add(o.record.id);
  }
  return [...going].map((id): Change => ({ kind: 'trash', id }));
}

const bySortKey = (a: SbdRecord, b: SbdRecord) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0);

/** Forward, back, to the front or the back: each plan's walls reordered among their own plan's (a level is a plan). */
export function reorderPlanChanges(records: Records, ids: readonly string[], mode: ReorderMode): Change[] {
  const byPlan = new Map<string, string[]>();
  for (const id of ids) {
    const live = liveItem(records, id);
    const planId = live?.record.parentId;
    if (planId) byPlan.set(planId, [...(byPlan.get(planId) ?? []), id]);
  }
  return [...byPlan].flatMap(([planId, chosenIds]) => {
    // Every sibling holds a key, the Trash's too, so a new key never ties with one coming back.
    const all = Object.values(records).filter((r) => r.type === 'plan_item' && r.parentId === planId).sort(bySortKey);
    const live = all.filter((r) => r.trashedAt === null && planItemFields(r.props) !== null).map((r) => r.id);
    const chosen = new Set(chosenIds);
    const nextLive = reordered(live, chosen, mode);
    if (nextLive.every((id, i) => id === live[i])) return [];
    const fixed = all.map((r) => r.id).filter((id) => !chosen.has(id));
    let after: string[];
    if (mode === 'front') after = [...fixed, ...nextLive.filter((id) => chosen.has(id))];
    else if (mode === 'back') after = [...nextLive.filter((id) => chosen.has(id)), ...fixed];
    else {
      after = [...fixed];
      nextLive.forEach((id, i) => {
        if (!chosen.has(id)) return;
        const before = nextLive[i - 1];
        after.splice(before === undefined ? 0 : after.indexOf(before) + 1, 0, id);
      });
    }
    const keys = sortKeysFor(all.map((r) => r.id), after, new Map(all.map((r) => [r.id, r.sortKey])), chosen);
    return [...keys].map(([id, sortKey]): Change => ({ kind: 'move', id, parentId: planId, sortKey }));
  });
}

/** What Copy keeps: the items' props as they are (metres), back to front, with the id each was copied from. */
export interface PlanClip {
  id: string;
  props: SbdRecord['props'];
  fields: ShownFields;
}

/** Copied walls, with the doors and windows in them; a door or window copied without its wall isn't (it has nowhere to go). */
export function planClipOf(records: Records, ids: readonly string[]): PlanClip[] {
  const walls = ids.flatMap((id) => {
    const live = liveItem(records, id);
    return live ? [live] : [];
  });
  const wallIds = new Set(walls.map((w) => w.record.id));
  const openings = Object.values(records).filter((r) => r.type === 'plan_item' && r.trashedAt === null && wallIds.has(openingFields(r.props)?.wallId ?? ''));
  return [...walls.map((w) => w.record).sort(bySortKey), ...openings.sort(bySortKey)].flatMap((record) => {
    const fields = shownFields(record.props);
    return fields ? [{ id: record.id, props: record.props, fields }] : [];
  });
}

/**
 * Pasted into a plan at the front: at the pointer (canvas units) when there is one, else 16 cm from the originals, as
 * the core places a board's paste. Each keeps every prop it was copied with; a door or window goes into its wall's copy.
 */
export function planPasteChanges(records: Records, planId: string, clip: readonly PlanClip[], at: Point | null): { ids: string[]; changes: Change[] } {
  const walls = clip.filter((item): item is PlanClip & { fields: PlanItemFields } => item.fields.kind === 'wall');
  const placed = pasted(walls.map((item) => toCanvasGeometry(item.fields)), at);
  let previous = lastKeyUnder(records, planId, 'plan_item');
  const ids: string[] = [];
  const changes: Change[] = [];
  const copies = new Map<string, string>();
  const make = (props: Props) => {
    const id = crypto.randomUUID();
    const sortKey = keyBetween(previous, null);
    previous = sortKey;
    ids.push(id);
    changes.push({ kind: 'create', record: { id, type: 'plan_item', parentId: planId, sortKey, props } });
    return id;
  };
  walls.forEach((item, i) => {
    const g = placed[i];
    if (!g) return;
    const m = metresOf(g);
    copies.set(item.id, make({ ...item.props, x: m.x, y: m.y }));
  });
  for (const item of clip) {
    if (!isOpening(item.fields)) continue;
    const wall = copies.get(item.fields.wallId);
    if (wall) make({ ...item.props, wall_id: wall });
  }
  return { ids, changes };
}

/** What the Selection tile changes on walls; each field it leaves out stays as it is. */
export interface WallPatch {
  /** Metres: its start stays, its end follows. */
  length?: number;
  /** Metres, about its middle line. */
  thickness?: number;
  /** Metres; null takes it off. */
  heightM?: number | null;
  /** Degrees, turned about its start. */
  rotation?: number;
  /** Its start, metres. */
  startX?: number;
  startY?: number;
  name?: string;
}

/** Whether walls can be this long and keep their doors and windows (6.2b): a shorter length is refused. */
export const wallsTakeLength = (records: Records, ids: readonly string[], length: number): boolean => ids.every((id) => !liveItem(records, id) || length >= wallNeedOf(records, id) - 1e-4);

/** A field changed on the selected walls (6.2a Selection tile): one update per wall that changes, one op group. */
export function wallPatchChanges(records: Records, ids: readonly string[], patch: WallPatch): Change[] {
  if (patch.length !== undefined && !wallsTakeLength(records, ids, patch.length)) return [];
  return ids.flatMap((id): Change[] => {
    const live = liveItem(records, id);
    if (!live) return [];
    const now = live.fields;
    const [start] = wallEnds(now);
    const length = patch.length ?? now.width;
    const thickness = patch.thickness ?? now.height;
    const from = { x: patch.startX ?? start.x, y: patch.startY ?? start.y };
    const changedShape = patch.length !== undefined || patch.thickness !== undefined || patch.rotation !== undefined || patch.startX !== undefined || patch.startY !== undefined;
    // A length typed as it was keeps the rotation it was typed with (atan2 of a rounded end may differ by a hundredth).
    const geometry = changedShape ? wallFrom(from, patch.rotation ?? now.rotation, length, thickness) : now;
    const set: SbdRecord['props'] = {};
    const unset: string[] = [];
    if (changedShape && !sameGeometry(now, geometry)) Object.assign(set, wallProps(geometry));
    if (patch.heightM !== undefined && patch.heightM !== now.heightM) {
      if (patch.heightM === null) unset.push('height_m');
      else set.height_m = patch.heightM;
    }
    if (patch.name !== undefined && patch.name.trim() !== now.name) {
      if (patch.name.trim() === '') unset.push('name');
      else set.name = patch.name.trim();
    }
    delete set.kind;
    if (Object.keys(set).length === 0 && unset.length === 0) return [];
    return [{ kind: 'update', id, ...(Object.keys(set).length > 0 ? { set } : {}), ...(unset.length > 0 ? { unset } : {}) }];
  });
}

/** What the Selection tile changes on doors and windows (6.2b); each field it leaves out stays as it is. */
export interface OpeningPatch {
  /** Metres, about its middle. */
  width?: number;
  /** Metres from the wall's start to the opening's near edge, or from the wall's end to its far edge. */
  fromStart?: number;
  fromEnd?: number;
  hinge?: Hinge;
  swing?: Swing;
  /** Metres; null takes it off. */
  heightM?: number | null;
  name?: string;
}

/** An opening's distances from its wall's two ends to its edges, metres. */
export const openingDistances = (wall: PlanItemFields, o: OpeningFields): { fromStart: number; fromEnd: number } => ({
  fromStart: Math.round((o.along - o.width / 2) * 10000) / 10000,
  fromEnd: Math.round((wall.width - o.along - o.width / 2) * 10000) / 10000,
});

/**
 * A field changed on the selected doors and windows: one update each, one op group; null when a new width or place
 * doesn't fit one of them in its wall (off its end, or over another opening), and nothing is written.
 */
export function openingPatchChanges(records: Records, ids: readonly string[], patch: OpeningPatch): Change[] | null {
  const changes: Change[] = [];
  for (const id of ids) {
    const live = liveOpening(records, id);
    if (!live) continue;
    const now = live.fields;
    const width = patch.width ?? now.width;
    const along = patch.fromStart !== undefined ? patch.fromStart + width / 2 : patch.fromEnd !== undefined ? live.wall.fields.width - patch.fromEnd - width / 2 : now.along;
    const tidyAlong = Math.round(along * 10000) / 10000;
    const others = openingsOf(records, now.wallId).filter((o) => o.record.id !== id).map((o) => o.fields);
    if ((patch.width !== undefined || patch.fromStart !== undefined || patch.fromEnd !== undefined) && !fitsAt(live.wall.fields.width, { along: tidyAlong, width }, others)) return null;
    const set: Props = {};
    const unset: string[] = [];
    if (Math.abs(width - now.width) > 1e-6) set.width_m = Math.round(width * 10000) / 10000;
    if (Math.abs(tidyAlong - now.along) > 1e-6) set.along_m = tidyAlong;
    if (now.kind === 'door' && patch.hinge !== undefined && patch.hinge !== now.hinge) set.hinge = patch.hinge;
    if (now.kind === 'door' && patch.swing !== undefined && patch.swing !== now.swing) set.swing = patch.swing;
    if (patch.heightM !== undefined && patch.heightM !== now.heightM) {
      if (patch.heightM === null) unset.push('height_m');
      else set.height_m = patch.heightM;
    }
    if (patch.name !== undefined && patch.name.trim() !== now.name) {
      if (patch.name.trim() === '') unset.push('name');
      else set.name = patch.name.trim();
    }
    if (Object.keys(set).length === 0 && unset.length === 0) continue;
    changes.push({ kind: 'update', id, ...(Object.keys(set).length > 0 ? { set } : {}), ...(unset.length > 0 ? { unset } : {}) });
  }
  return changes;
}

/** F flips the selected doors' swing to the wall's other side; Shift+F moves their hinge to the opening's other end. */
export function flipDoorsChanges(records: Records, ids: readonly string[], what: 'swing' | 'hinge'): Change[] {
  return ids.flatMap((id): Change[] => {
    const live = liveOpening(records, id);
    if (live?.fields.kind !== 'door') return [];
    const set: Props = what === 'swing' ? { swing: live.fields.swing === 'left' ? 'right' : 'left' } : { hinge: live.fields.hinge === 'start' ? 'end' : 'start' };
    return [{ kind: 'update', id, set }];
  });
}

/** Where a new door or window would sit (6.2b): in the wall under the point (canvas units), snapped along it to `step` metres. */
export interface OpeningSpot {
  wallId: string;
  wall: PlanItemFields;
  along: number;
}

/** The spot a door or window takes when put at a point: on the wall it is over, at a free place along it; null over no wall. */
export function openingSpot(shown: readonly ShownItem[], at: Point, kind: OpeningKind, step: number): OpeningSpot | null {
  const walls = shownWalls(shown);
  const point = { x: toMetres(at.x), y: toMetres(at.y) };
  // Over the wall itself, or a little off its face: a 10 cm wall is hard to hit at a distance.
  const over = wallUnder(walls, point, 0.15);
  if (!over) return null;
  const along = fitAlong(over.fields.width, OPENING_WIDTH[kind], onStep(over.along, step), spansIn(shown, over.id, new Set()));
  return along === null ? null : { wallId: over.id, wall: over.fields, along };
}

/** The spot a door or window takes from the keyboard: the middle of the one selected wall, or the nearest free place to it. */
export function openingSpotInWall(shown: readonly ShownItem[], wallId: string, kind: OpeningKind): OpeningSpot | null {
  const wall = shownWalls(shown).find((w) => w.id === wallId);
  if (!wall) return null;
  const along = fitAlong(wall.fields.width, OPENING_WIDTH[kind], wall.fields.width / 2, spansIn(shown, wallId, new Set()));
  return along === null ? null : { wallId, wall: wall.fields, along };
}

/** The props a new door or window is written with: a door hinged at its start, opening to the left. */
export const openingProps = (kind: OpeningKind, wallId: string, along: number): Props =>
  kind === 'door' ? { kind, wall_id: wallId, along_m: along, width_m: OPENING_WIDTH.door, hinge: 'start', swing: 'left' } : { kind, wall_id: wallId, along_m: along, width_m: OPENING_WIDTH.window };

/** A door or window put in a wall, at the front of the wall's plan (so it is at the wall's level), one op. */
export function placeOpeningChanges(records: Records, spot: OpeningSpot, kind: OpeningKind, id: string = crypto.randomUUID()): Change[] {
  const wall = liveItem(records, spot.wallId);
  if (!wall?.record.parentId) return [];
  const others = openingsOf(records, spot.wallId).map((o) => o.fields);
  if (!fitsAt(wall.fields.width, { along: spot.along, width: OPENING_WIDTH[kind] }, others)) return [];
  const planId = wall.record.parentId;
  return [{ kind: 'create', record: { id, type: 'plan_item', parentId: planId, sortKey: keyBetween(lastKeyUnder(records, planId, 'plan_item'), null), props: openingProps(kind, spot.wallId, spot.along) } }];
}
