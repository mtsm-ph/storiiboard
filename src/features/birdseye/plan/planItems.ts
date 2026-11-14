import { createElement } from 'react';
import { Line } from 'react-konva';
import { t } from '../../../core/i18n';
import { formatLength, type PlanUnit } from '../../../core/model/length';
import {
  MIN_PLAN_SIZE,
  normalDegrees,
  planItemFields,
  sceneRoomId,
  shownItems,
  wallBetween,
  wallEnds,
  wallProps,
  wallsAlong,
  type PlanGeometry,
  type PlanItemFields,
  type ShownItem,
} from '../../../core/model/plan';
import type { SbdRecord } from '../../../core/model/record';
import type { Change } from '../../../core/ops/ops';
import { keyBetween } from '../../../core/ops/order';
import { pasted } from '../../../ui/canvas/placement';
import type { CanvasItem, Geometry, GeometryChange, Point, ReorderMode } from '../../../ui/canvas/types';
import { reordered, sortKeysFor } from '../../../ui/canvas/zOrder';
import { toCanvas, toMetres } from './planScale';
import { wallOutline, type WallLine } from './wallShape';

// A plan's items for the canvas core and back (6.2a): records in metres become CanvasItems in canvas units (1 cm), and
// what a gesture or a field changed becomes updates in metres again. Pure, so each edit is tested without a browser.
// The items of every level a view shows are drawn together (the room's first); an edit reaches each item in its own plan.

type Records = Readonly<Record<string, SbdRecord>>;

/** A plan view's key: the setup it shows, or the scene with no setup picked. */
export const viewKey = (sceneId: string, setupId: string | null): string => (setupId ? `setup:${setupId}` : `scene:${sceneId}`);

/** A live plan item this version shows, with its fields. */
function liveItem(records: Records, id: string): { record: SbdRecord; fields: PlanItemFields } | null {
  const record = records[id];
  if (record?.type !== 'plan_item' || record.trashedAt !== null) return null;
  const fields = planItemFields(record.props);
  return fields ? { record, fields } : null;
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

/** What a built item depended on: the same record, unit and ink, and the same walls at its ends, give the same item. */
interface Built {
  record: SbdRecord;
  unit: PlanUnit;
  ink: string;
  neighbours: readonly SbdRecord[];
  item: CanvasItem;
}

/**
 * A view's items for the canvas, kept between calls (6.2a): a wall's item is made again only when its record, the unit,
 * the ink or the walls joined at its ends changed (their mitres shape its corners), so an edit elsewhere in the project
 * rebuilds nothing and the canvas keeps what it drew; when nothing changed, the same list comes back.
 */
export function planItemsBuilder(): (shown: readonly ShownItem[], unit: PlanUnit, ink: string) => readonly CanvasItem[] {
  let built = new Map<string, Built>();
  let last: readonly CanvasItem[] = [];
  return (shown, unit, ink) => {
    const lines = shown.map((item) => lineOf(item.record.id, item.fields));
    const records = new Map(shown.map((item) => [item.record.id, item.record]));
    const joined = joinedTo(lines);
    const next = new Map<string, Built>();
    const items = shown.map((item, i): CanvasItem => {
      const line = lines[i] as WallLine;
      const near = joined.get(line.id) ?? [];
      const neighbours = near.flatMap((other) => records.get(other.id) ?? []);
      const was = built.get(item.record.id);
      if (was && was.record === item.record && was.unit === unit && was.ink === ink && was.neighbours.length === neighbours.length && was.neighbours.every((r, k) => r === neighbours[k])) {
        next.set(item.record.id, was);
        return was.item;
      }
      const outline = wallOutline(line, [line, ...near]).flatMap((p) => [p.x, p.y]);
      const made: CanvasItem = {
        id: item.record.id,
        ...toCanvasGeometry(item.fields),
        label: wallLabel(item.fields, unit),
        // A wall snaps by its middle line's ends, never by its box (a move keeps it on the grid line it was on).
        snapPoints: [line.start, line.end],
        draw: () => createElement(Line, { points: outline, closed: true, fill: ink, listening: false }),
      };
      next.set(item.record.id, { record: item.record, unit, ink, neighbours, item: made });
      return made;
    });
    built = next;
    if (items.length === last.length && items.every((item, i) => item === last[i])) return last;
    last = items;
    return items;
  };
}

/** What the canvas draws for a view, back to front: walls as ink bars, mitred where two meet. */
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

/** A run of walls drawn in a view (canvas units): one wall a segment, into that view's scene's room, never another's. */
export function drawWallsChanges(records: Records, sceneId: string, points: readonly Point[]): { ids: string[]; changes: Change[] } {
  const roomId = sceneRoomId(records, records[sceneId]);
  if (roomId === null) return { ids: [], changes: [] };
  return wallsAlong(records, roomId, points.map((p) => ({ x: toMetres(p.x), y: toMetres(p.y) })));
}

const sameGeometry = (a: PlanItemFields, b: PlanGeometry): boolean => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height && a.rotation === b.rotation;

/** A box in metres, its length and thickness never under a centimetre. */
const metresOf = (g: Geometry): PlanGeometry => ({
  x: toMetres(g.x),
  y: toMetres(g.y),
  width: Math.max(MIN_PLAN_SIZE, toMetres(g.width)),
  height: Math.max(MIN_PLAN_SIZE, toMetres(g.height)),
  rotation: normalDegrees(g.rotation),
});

/** A finished move, resize or turn (canvas units): one update per item that changed, all one op group. */
export function planGeometryChanges(records: Records, changes: readonly GeometryChange[]): Change[] {
  return changes.flatMap((c): Change[] => {
    const live = liveItem(records, c.id);
    if (!live) return [];
    const next = metresOf(c);
    if (sameGeometry(live.fields, next)) return [];
    return [{ kind: 'update', id: c.id, set: { x: next.x, y: next.y, width: next.width, height: next.height, rotation: next.rotation } }];
  });
}

/** An arrow key's nudge (canvas units), added to each item as it is when the edit is written. */
export function planNudgeChanges(records: Records, ids: readonly string[], dx: number, dy: number): Change[] {
  return ids.flatMap((id): Change[] => {
    const live = liveItem(records, id);
    if (!live) return [];
    const g = toCanvasGeometry(live.fields);
    return planGeometryChanges(records, [{ id, ...g, x: g.x + dx, y: g.y + dy }]);
  });
}

/** The items to the Trash, in one group. */
export function trashPlanItemsChanges(records: Records, ids: readonly string[]): Change[] {
  return [...new Set(ids)].filter((id) => liveItem(records, id)).map((id): Change => ({ kind: 'trash', id }));
}

const bySortKey = (a: SbdRecord, b: SbdRecord) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0);

/** Forward, back, to the front or the back: each plan's items reordered among their own plan's (a level is a plan). */
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

/** What Copy keeps: the items' props as they are (metres), back to front. */
export interface PlanClip {
  props: SbdRecord['props'];
  fields: PlanItemFields;
}

export function planClipOf(records: Records, ids: readonly string[]): PlanClip[] {
  return ids
    .flatMap((id) => {
      const live = liveItem(records, id);
      return live ? [live] : [];
    })
    .sort((a, b) => bySortKey(a.record, b.record))
    .map(({ record, fields }) => ({ props: record.props, fields }));
}

/**
 * Pasted into a plan at the front: at the pointer (canvas units) when there is one, else 16 cm from the originals, as
 * the core places a board's paste. Each keeps every prop it was copied with.
 */
export function planPasteChanges(records: Records, planId: string, clip: readonly PlanClip[], at: Point | null): { ids: string[]; changes: Change[] } {
  const placed = pasted(clip.map((item) => toCanvasGeometry(item.fields)), at);
  let previous = Object.values(records)
    .filter((r) => r.type === 'plan_item' && r.parentId === planId)
    .reduce<string | null>((key, r) => (key === null || r.sortKey > key ? r.sortKey : key), null);
  const ids: string[] = [];
  const changes: Change[] = [];
  clip.forEach((item, i) => {
    const g = placed[i];
    if (!g) return;
    const m = metresOf(g);
    const id = crypto.randomUUID();
    const sortKey = keyBetween(previous, null);
    previous = sortKey;
    ids.push(id);
    changes.push({ kind: 'create', record: { id, type: 'plan_item', parentId: planId, sortKey, props: { ...item.props, x: m.x, y: m.y } } });
  });
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

/** A field changed on the selected walls (6.2a Selection tile): one update per wall that changes, one op group. */
export function wallPatchChanges(records: Records, ids: readonly string[], patch: WallPatch): Change[] {
  return ids.flatMap((id): Change[] => {
    const live = liveItem(records, id);
    if (!live) return [];
    const now = live.fields;
    const [start, end] = wallEnds(now);
    const length = patch.length ?? now.width;
    const thickness = patch.thickness ?? now.height;
    const turn = ((patch.rotation ?? now.rotation) * Math.PI) / 180;
    const from = { x: patch.startX ?? start.x, y: patch.startY ?? start.y };
    const changedShape = patch.length !== undefined || patch.thickness !== undefined || patch.rotation !== undefined || patch.startX !== undefined || patch.startY !== undefined;
    const to = changedShape ? { x: from.x + Math.cos(turn) * length, y: from.y + Math.sin(turn) * length } : end;
    const g = changedShape ? wallBetween(from, to, thickness) : now;
    // A length typed as it was keeps the rotation it was typed with (atan2 of a rounded end may differ by a hundredth).
    const geometry = changedShape ? { ...g, rotation: normalDegrees(patch.rotation ?? now.rotation), width: Math.max(MIN_PLAN_SIZE, Math.round(length * 10000) / 10000) } : g;
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
