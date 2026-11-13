import type { SbdRecord } from '../../core/model/record';
import type { Change } from '../../core/ops/ops';
import { keyBetween } from '../../core/ops/order';
import { alignItems, distributeItems, tidyItems } from '../../ui/canvas/arrange';
import { boundsOf, marqueeHolds } from '../../ui/canvas/hitTest';
import { tidy } from '../../ui/canvas/placement';
import { sectionContents } from '../../ui/canvas/sections';
import type { AlignMode, Axis, Geometry, GeometryChange, TidyMode } from '../../ui/canvas/types';
import { unionBounds } from '../../ui/canvas/viewport';
import { connectorFields, endProps } from './connectorFields';
import { connectorsOf } from './connectors';
import { estimateTextHeight, geometryChanges, isFrameKind, itemFields, itemsOf, propsFor, SECTION_TAB_HEIGHT, type ItemFields, type MeasureText } from './items';
import { isAttached } from '../../ui/canvas/types';

// Sections on a board (5.3, docs/SBD_FORMAT.md, Boards). What a section holds is worked out each time from where things are,
// never stored: the items and sections whose upright rectangle lies wholly inside its box. Nothing about a section's
// contents is a record, so putting an item in or taking it out of one writes nothing.

type Records = Readonly<Record<string, SbdRecord>>;

/** Room left round what a section is drawn around, in world units. */
export const SECTION_PADDING = 40;

type Boxed = ItemFields & { id: string };

/** The board's live items as boxes with their fields, back to front. */
function boxesOf(records: Records, boardId: string): Boxed[] {
  return itemsOf(records, boardId).flatMap((record) => {
    const fields = itemFields(record.props);
    return fields ? [{ id: record.id, ...fields }] : [];
  });
}

/** The ids a section holds right now: the live items and sections wholly inside it, itself left out. */
export function contentsOf(records: Records, boardId: string, sectionId: string): string[] {
  const all = boxesOf(records, boardId);
  const section = all.find((item) => item.id === sectionId && isFrameKind(item.kind));
  return section ? sectionContents(section, all) : [];
}

/**
 * A new section at a place, one op. It joins the sections' order just before the first section it holds, so a section drawn
 * round others is under them (a section is drawn above the ones before it, and its fill would cover them), else it is the
 * last, the topmost.
 */
export function createSectionChanges(records: Records, boardId: string, geometry: Geometry, seed: { name?: string } = {}): { id: string; changes: Change[] } {
  const id = crypto.randomUUID();
  const box = { ...geometry, rotation: 0 };
  // Every sibling holds a key (the Trash's too), so a new one is made between them.
  const siblings = Object.values(records)
    .filter((r) => r.type === 'board_item' && r.parentId === boardId)
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
  const held = siblings.find((r) => itemFields(r.props)?.kind === 'section' && r.trashedAt === null && marqueeHolds(itemFields(r.props) as Geometry, box));
  const at = held ? siblings.indexOf(held) : siblings.length;
  const sortKey = keyBetween(siblings[at - 1]?.sortKey ?? null, held?.sortKey ?? null);
  return { id, changes: [{ kind: 'create', record: { id, type: 'board_item', parentId: boardId, sortKey, props: propsFor({ ...box, kind: 'section', name: seed.name ?? '' }) } }] };
}

/**
 * ⌘⌥G: a section round the selected items (sections count), the bounds plus 40 units of padding all round and the height of
 * the name tab more above. Null when no live item is selected.
 */
export function sectionAroundChanges(records: Records, boardId: string, selected: readonly string[]): { id: string; changes: Change[] } | null {
  const chosen = boxesOf(records, boardId).filter((item) => selected.includes(item.id));
  const bounds = unionBounds(chosen.map(boundsOf));
  if (!bounds) return null;
  const x = tidy(bounds.x - SECTION_PADDING);
  const y = tidy(bounds.y - SECTION_PADDING - SECTION_TAB_HEIGHT);
  return createSectionChanges(records, boardId, {
    x,
    y,
    width: tidy(bounds.x + bounds.width + SECTION_PADDING - x),
    height: tidy(bounds.y + bounds.height + SECTION_PADDING - y),
    rotation: 0,
  });
}

/**
 * Finished moves written: the items' own, and what a moved section holds (everything wholly inside its old box, unless it is
 * in the moves already, or `placed`: a drag brings its contents itself, a nudge doesn't, and a layout command names every
 * item it covered, which stay where it put them), and the free ends of connectors that lie inside it. What several moved
 * sections hold moves with the innermost (smallest) of them. A section that was resized, not moved, takes nothing along.
 */
export function moveChanges(records: Records, changes: readonly GeometryChange[], measure: MeasureText = estimateTextHeight, placed: ReadonlySet<string> = new Set()): Change[] {
  const asked = new Set([...changes.map((c) => c.id), ...placed]);
  const along: GeometryChange[] = [];
  const shifts: { boardId: string; id: string; box: Geometry; dx: number; dy: number }[] = [];
  for (const c of changes) {
    const record = records[c.id];
    const now = record?.type === 'board_item' && record.trashedAt === null && record.parentId ? itemFields(record.props) : null;
    // A page (5.5) carries what it holds as a section does.
    if (!record?.parentId || !now || !isFrameKind(now.kind)) continue;
    if (c.width !== now.width || c.height !== now.height) continue;
    const dx = tidy(c.x - now.x);
    const dy = tidy(c.y - now.y);
    if (dx === 0 && dy === 0) continue;
    shifts.push({ boardId: record.parentId, id: c.id, box: now, dx, dy });
  }
  // Smallest first: an item claimed by an inner section keeps that section's distance.
  shifts.sort((p, q) => p.box.width * p.box.height - q.box.width * q.box.height);
  const cache = new Map<string, Boxed[]>();
  for (const shift of shifts) {
    let all = cache.get(shift.boardId);
    if (!all) {
      all = boxesOf(records, shift.boardId);
      cache.set(shift.boardId, all);
    }
    const inside = new Set(sectionContents({ id: shift.id, ...shift.box }, all));
    for (const item of all) {
      if (!inside.has(item.id) || asked.has(item.id) || along.some((a) => a.id === item.id)) continue;
      along.push({ id: item.id, x: tidy(item.x + shift.dx), y: tidy(item.y + shift.dy), width: item.width, height: item.height, rotation: item.rotation });
    }
  }
  return [...geometryChanges(records, [...changes, ...along], measure), ...freeEndChanges(records, shifts)];
}

/** The connectors' free ends that lie inside a moved section move with it, each once. */
function freeEndChanges(records: Records, shifts: readonly { boardId: string; box: Geometry; dx: number; dy: number }[]): Change[] {
  const out: Change[] = [];
  for (const boardId of new Set(shifts.map((s) => s.boardId))) {
    const mine = shifts.filter((s) => s.boardId === boardId);
    for (const connector of connectorsOf(records, boardId)) {
      const fields = connectorFields(connector.props);
      if (!fields) continue;
      const set: Record<string, ReturnType<typeof endProps>> = {};
      for (const which of ['from', 'to'] as const) {
        const end = fields[which];
        if (isAttached(end)) continue;
        const shift = mine.find((s) => end.x >= s.box.x && end.x <= s.box.x + s.box.width && end.y >= s.box.y && end.y <= s.box.y + s.box.height);
        if (shift) set[which] = endProps({ x: tidy(end.x + shift.dx), y: tidy(end.y + shift.dy) });
      }
      if (Object.keys(set).length > 0) out.push({ kind: 'update', id: connector.id, set });
    }
  }
  return out;
}

/** What a layout command asks for. */
export type Arrange = { kind: 'align'; mode: AlignMode } | { kind: 'distribute'; axis: Axis } | { kind: 'tidy'; mode: TidyMode };

/**
 * Align, distribute or tidy the selected items (sections count; connectors follow their items). One op group, with a row
 * for every item the command covered, moved or not, so that History can say what was done and to how many ("Aligned 3
 * items"). Nothing at all when no item would move.
 */
export function arrangeChanges(records: Records, boardId: string, selected: readonly string[], command: Arrange, measure: MeasureText = estimateTextHeight): Change[] {
  const chosen = boxesOf(records, boardId).filter((item) => selected.includes(item.id));
  const moved =
    command.kind === 'align' ? alignItems(chosen, command.mode) : command.kind === 'distribute' ? distributeItems(chosen, command.axis) : tidyItems(chosen, command.mode);
  if (moved.length === 0) return [];
  const written = moveChanges(records, moved, measure, new Set(chosen.map((item) => item.id)));
  // An item a moved section carried is written already.
  const rest = chosen.filter((item) => !written.some((c) => c.kind === 'update' && c.id === item.id));
  return [...written, ...rest.map((item): Change => ({ kind: 'update', id: item.id, set: { x: item.x, y: item.y } }))];
}

/** An arrow key's nudge of the selected items, a section's contents with it: a distance added to each as it is now. */
export function nudgeMoveChanges(records: Records, ids: readonly string[], dx: number, dy: number, measure: MeasureText = estimateTextHeight): Change[] {
  const moves = ids.flatMap((id): GeometryChange[] => {
    const record = records[id];
    const fields = record?.type === 'board_item' && record.trashedAt === null ? itemFields(record.props) : null;
    return fields ? [{ id, ...fields, x: tidy(fields.x + dx), y: tidy(fields.y + dy) }] : [];
  });
  return moveChanges(records, moves, measure);
}
