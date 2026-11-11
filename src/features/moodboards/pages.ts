import type { SbdRecord } from '../../core/model/record';
import type { Change } from '../../core/ops/ops';
import { keyBetween } from '../../core/ops/order';
import { boundsOf } from '../../ui/canvas/hitTest';
import { tidy } from '../../ui/canvas/placement';
import { sectionContents } from '../../ui/canvas/sections';
import type { Geometry, Rect } from '../../ui/canvas/types';
import { unionBounds } from '../../ui/canvas/viewport';
import { attachedItems, connectorFields } from './connectorFields';
import { clipConnectorsOf, connectorsOf, pasteConnectorChanges, pasteDelta } from './connectors';
import { clipOf, createItems, itemFields, itemsOf, pasteChanges, trashItemsChanges, type ItemFields, type ItemSeed } from './items';
import { isPageFormat, isPaper, PAGE_GAP, pageSize, type PageFormat, type PageOrientation } from './pageFormats';

// A deck's pages (5.5, docs/SBD_FORMAT.md, Boards). A page is a `board_item` of kind `page`; the pages' sibling order is the
// deck's page order. What a page holds is worked out each time, like a section's (5.3): the items wholly inside it. Nothing
// about it is stored, so moving a page carries its contents (sections.ts) and an item dragged out of it simply isn't on it
// any more. Every edit here is one op group.

type Records = Readonly<Record<string, SbdRecord>>;
type Boxed = ItemFields & { id: string };

/** The deck's own format, kept on the board record for "Add page": a page's format when the board has none (a deck from a template: its first page's). */
export function deckPageFormat(board: SbdRecord | undefined): { format: PageFormat; orientation: PageOrientation } {
  const format = isPageFormat(board?.props.page_format) ? board.props.page_format : '16:9';
  return { format, orientation: isPaper(format) && board?.props.page_orientation === 'landscape' ? 'landscape' : 'portrait' };
}

/** A board that is a deck (boards.ts: kind `deck`). */
export const isDeck = (board: SbdRecord | undefined): boolean => board?.type === 'board' && board.props.kind === 'deck';

export interface PageInfo {
  id: string;
  /** 1 for the first page in the deck's order. */
  number: number;
  fields: ItemFields;
}

/** The deck's live pages, in the deck's order. */
export function pagesOf(records: Records, boardId: string): PageInfo[] {
  return itemsOf(records, boardId).flatMap((record) => {
    const fields = itemFields(record.props);
    return fields?.kind === 'page' ? [{ id: record.id, fields, number: 0 }] : [];
  }).map((page, i) => ({ ...page, number: i + 1 }));
}

/** A page's number as the Trash and History say it: its place among the pages that are live, a trashed one where it would sit. */
export function pageNumberOf(records: Records, page: SbdRecord): number {
  if (!page.parentId) return 1;
  const before = itemsOf(records, page.parentId).filter((r) => r.id !== page.id && r.props.kind === 'page' && r.sortKey < page.sortKey);
  return before.length + 1;
}

function boxesOf(records: Records, boardId: string): Boxed[] {
  return itemsOf(records, boardId).flatMap((record) => {
    const fields = itemFields(record.props);
    return fields ? [{ id: record.id, ...fields }] : [];
  });
}

/** The ids a page holds right now: the live items wholly inside it, in the board's order. Other pages are no part of it. */
export function pageContents(records: Records, boardId: string, pageId: string): string[] {
  const all = boxesOf(records, boardId);
  const page = all.find((item) => item.id === pageId && item.kind === 'page');
  if (!page) return [];
  const kinds = new Map(all.map((item) => [item.id, item.kind]));
  return sectionContents(page, all).filter((id) => kinds.get(id) !== 'page');
}

/** The connectors on a page: those with every end on it (an attached end on an item the page holds, a free one inside its box). */
export function pageConnectors(records: Records, boardId: string, pageId: string, held: readonly string[] = pageContents(records, boardId, pageId)): SbdRecord[] {
  const page = itemFields(records[pageId]?.props ?? {});
  if (page?.kind !== 'page') return [];
  const inside = new Set(held);
  return connectorsOf(records, boardId).filter((record) => {
    const fields = connectorFields(record.props);
    if (!fields) return false;
    const attached = attachedItems(fields);
    const free = [fields.from, fields.to].filter((end): end is { x: number; y: number } => !('item' in end));
    return (
      attached.every((id) => inside.has(id)) &&
      free.every((end) => end.x >= page.x && end.x <= page.x + page.width && end.y >= page.y && end.y <= page.y + page.height) &&
      attached.length + free.length > 0 &&
      (attached.length > 0 || free.length === 2)
    );
  });
}

/**
 * Where a new page goes: 200 units right of the rightmost live page's right edge (whatever the order has become), level with
 * the last page in the order; the origin for the first. Past the rightmost edge nothing can be in the way.
 */
function nextPlace(records: Records, boardId: string): { x: number; y: number } {
  const pages = pagesOf(records, boardId);
  const last = pages.at(-1);
  if (!last) return { x: 0, y: 0 };
  return { x: tidy(Math.max(...pages.map((p) => p.fields.x + p.fields.width)) + PAGE_GAP), y: last.fields.y };
}

/** A new page of a format at a place (else after the last page), one op. */
export function addPageChanges(
  records: Records,
  boardId: string,
  seed: { format?: PageFormat; orientation?: PageOrientation; name?: string; at?: { x: number; y: number } } = {},
): { id: string; changes: Change[] } {
  const { format, orientation } = seed.format ? { format: seed.format, orientation: seed.orientation ?? 'portrait' } : deckPageFormat(records[boardId]);
  const place = seed.at ?? nextPlace(records, boardId);
  const made = createItems(records, boardId, [pageSeed(format, orientation, place, seed.name)]);
  return { id: made.ids[0] as string, changes: made.changes };
}

/** The seed of a page at a place: its format's size, upright, white. */
export function pageSeed(format: PageFormat, orientation: PageOrientation, at: { x: number; y: number }, name = ''): ItemSeed {
  return { kind: 'page', ...at, ...pageSize(format, orientation), rotation: 0, format, orientation: isPaper(format) ? orientation : 'portrait', name };
}

/**
 * Duplicate page: a copy of the page and everything wholly inside it (pictures and video cards included, as Duplicate does),
 * placed after the last page, as one group. Also the videos whose playback copies the caller must carry over.
 */
export function duplicatePageChanges(records: Records, boardId: string, pageId: string): { id: string; changes: Change[]; videos: { from: string; to: string }[] } | null {
  const page = records[pageId];
  const fields = page?.type === 'board_item' && page.parentId === boardId && page.trashedAt === null ? itemFields(page.props) : null;
  if (!fields || fields.kind !== 'page') return null;
  const held = pageContents(records, boardId, pageId);
  const wires = pageConnectors(records, boardId, pageId, held).map((r) => r.id);
  const place = nextPlace(records, boardId);
  const dx = tidy(place.x - fields.x);
  const dy = tidy(place.y - fields.y);
  // The page first, then its contents with the connectors among them; pasteChanges puts a copy of the clip's middle where it is told.
  const made0 = createItems(records, boardId, [{ ...fields, x: place.x, y: place.y }]);
  // The copy sits right after the original in the page order: its key is made between the original's and the next sibling's.
  const after = Object.values(records)
    .filter((r) => r.type === 'board_item' && r.parentId === boardId && r.sortKey > (page?.sortKey ?? ''))
    .sort((p, q) => (p.sortKey < q.sortKey ? -1 : p.sortKey > q.sortKey ? 1 : 0))[0];
  const copy = {
    ids: made0.ids,
    changes: made0.changes.map((c) => (c.kind === 'create' ? { ...c, record: { ...c.record, sortKey: keyBetween(page?.sortKey ?? null, after?.sortKey ?? null) } } : c)),
  };
  const clip = clipOf(records, boardId, held);
  const connectors = clipConnectorsOf(records, boardId, [...held, ...wires]);
  let changes = [...copy.changes];
  let videos: { from: string; to: string }[] = [];
  if (clip.length > 0 || connectors.length > 0) {
    const bounds = unionBounds(clip.map(boundsOf));
    const middle = bounds ? { x: bounds.x + bounds.width / 2 + dx, y: bounds.y + bounds.height / 2 + dy } : null;
    // The copies are made against the records plus the page just made, so their keys come after it.
    const withPage = { ...records, ...Object.fromEntries(copy.changes.flatMap((c): [string, SbdRecord][] => (c.kind === 'create' && c.record.id ? [[c.record.id, asRecord(c.record)]] : []))) };
    const made = pasteChanges(withPage, boardId, clip, middle);
    const joined = pasteConnectorChanges(withPage, boardId, connectors, made.ids, pasteDelta(clip, connectors, middle));
    changes = [...changes, ...made.changes, ...joined.changes];
    videos = made.videos;
  }
  return { id: copy.ids[0] as string, changes, videos };
}

/** A record about to be created, as the records hold it, for working out the keys of what follows it. */
function asRecord(record: Extract<Change, { kind: 'create' }>['record']): SbdRecord {
  return { id: record.id ?? '', type: record.type, parentId: record.parentId, sortKey: record.sortKey, props: record.props ?? {}, trashedAt: null, trashedBy: null, createdAt: '', updatedAt: '' };
}

/** Delete page: the page alone to the Trash; what it held stays on the board as working space. One group. */
export function deletePageChanges(records: Records, pageId: string): Change[] {
  const page = records[pageId];
  return page?.type === 'board_item' && page.props.kind === 'page' ? trashItemsChanges(records, [pageId]) : [];
}

/**
 * A page moved to another place in the deck's order (`to` is the 0-based place among the live pages after the move). Every
 * sibling holds a key, the Trash's and the other kinds too, so the page's new key is made beside the page it goes next to.
 */
export function movePageChanges(records: Records, boardId: string, pageId: string, to: number): Change[] {
  const pages = pagesOf(records, boardId);
  const from = pages.findIndex((page) => page.id === pageId);
  if (from < 0 || to < 0 || to >= pages.length || to === from) return [];
  const siblings = Object.values(records)
    .filter((r) => r.type === 'board_item' && r.parentId === boardId && r.id !== pageId)
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
  // The page it takes the place of: it goes before that page when moving up, after it when moving down.
  const target = pages[to];
  if (!target) return [];
  const at = siblings.findIndex((r) => r.id === target.id);
  const before = to < from ? (siblings[at - 1] ?? null) : (siblings[at] ?? null);
  const after = to < from ? (siblings[at] ?? null) : (siblings[at + 1] ?? null);
  return [{ kind: 'move', id: pageId, parentId: boardId, sortKey: keyBetween(before?.sortKey ?? null, after?.sortKey ?? null) }];
}

/** The world rectangle of a page, for centring the view on it. */
export const pageRect = (fields: Pick<ItemFields, 'x' | 'y' | 'width' | 'height'>): Rect => ({ x: fields.x, y: fields.y, width: fields.width, height: fields.height });

/** One page as the presentation shows it: its number and name, and the ids of what it holds. */
export interface PresentPage {
  id: string;
  number: number;
  name: string;
  box: Geometry;
  /** Back to front, as the board orders them; connectors follow in `connectors`. */
  items: string[];
  connectors: string[];
}

/**
 * The pages a presentation steps through, in the deck's order, each with what lies wholly inside it. Items outside every
 * page are working space and are in none of them (decision 3).
 */
export function presentPages(records: Records, boardId: string): PresentPage[] {
  return pagesOf(records, boardId).map((page) => {
    const items = pageContents(records, boardId, page.id);
    return {
      id: page.id,
      number: page.number,
      name: page.fields.name.trim(),
      box: { x: page.fields.x, y: page.fields.y, width: page.fields.width, height: page.fields.height, rotation: 0 },
      items,
      connectors: pageConnectors(records, boardId, page.id, items).map((r) => r.id),
    };
  });
}

/** The records as they will be once these changes are written (creations only), for working out what follows them in one group. */
export function withCreated(records: Records, changes: readonly Change[]): Records {
  return { ...records, ...Object.fromEntries(changes.flatMap((c): [string, SbdRecord][] => (c.kind === 'create' && c.record.id ? [[c.record.id, asRecord(c.record)]] : []))) };
}

/**
 * Several pages duplicated in one group: each copy is worked out against the records plus the copies before it, so they land in
 * their own places and take their own keys.
 */
export function duplicatePagesChanges(records: Records, boardId: string, pageIds: readonly string[]): { ids: string[]; changes: Change[]; videos: { from: string; to: string }[]; working: Records } {
  let working = records;
  const ids: string[] = [];
  const changes: Change[] = [];
  const videos: { from: string; to: string }[] = [];
  for (const pageId of pageIds) {
    const made = duplicatePageChanges(working, boardId, pageId);
    if (!made) continue;
    ids.push(made.id);
    changes.push(...made.changes);
    videos.push(...made.videos);
    working = withCreated(working, made.changes);
  }
  return { ids, changes, videos, working };
}
