import { t } from '../../core/i18n';
import { DEPARTMENT_LABELS, DEPARTMENTS, isDepartment, type Department } from '../../core/model/department';
import type { SbdRecord } from '../../core/model/record';
import type { Change } from '../../core/ops/ops';
import { keyBetween } from '../../core/ops/order';
import { sceneFields, sceneLabel } from '../../core/model/storyboard';

// Boards (5.0, docs/SBD_FORMAT.md, Boards): a `board` record under the project. A department's board has
// `department` and no name, and reads as its department's label in the language in use; a free board has a name. At
// most one board per department isn't in the Trash, and one in the Trash is restored when its department's board is
// opened, never made twice.

type Records = Readonly<Record<string, SbdRecord>>;

export interface BoardFields {
  kind: 'moodboard';
  department: Department | null;
  name: string | null;
}

export function boardFields(props: SbdRecord['props']): BoardFields {
  return {
    kind: 'moodboard',
    department: isDepartment(props.department) ? props.department : null,
    name: typeof props.name === 'string' && props.name.trim() !== '' ? props.name : null,
  };
}

const byKey = (a: SbdRecord, b: SbdRecord) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0);

/** Every board of the project, in the order they were made; the Trash's included only when asked. */
export function boardsOf(records: Records, projectId: string, withTrashed = false): SbdRecord[] {
  return Object.values(records)
    .filter((r) => r.type === 'board' && r.parentId === projectId && (withTrashed || r.trashedAt === null))
    .sort(byKey);
}

/** What a board is called: its name, else its department's label. */
export function boardTitle(record: SbdRecord): string {
  const fields = boardFields(record.props);
  if (fields.name !== null) return fields.name;
  return fields.department !== null ? DEPARTMENT_LABELS[fields.department] : t('moodboard.untitled');
}

/** The department's board: the one that isn't in the Trash, else the one that is. */
export function departmentBoard(records: Records, projectId: string, department: Department): SbdRecord | undefined {
  const mine = boardsOf(records, projectId, true).filter((b) => boardFields(b.props).department === department);
  return mine.find((b) => b.trashedAt === null) ?? mine[0];
}

/** The departments with no live board yet, in the call sheet's order: what the picker offers to open. */
export function departmentsWithoutBoard(records: Records, projectId: string): Department[] {
  const have = new Set(boardsOf(records, projectId).map((b) => boardFields(b.props).department));
  return DEPARTMENTS.filter((d) => !have.has(d));
}

/** The items that went to the Trash with their board: the same op group, so the same time and person. */
export function trashedWithBoard(records: Records, board: SbdRecord): SbdRecord[] {
  return Object.values(records).filter(
    (r) => r.type === 'board_item' && r.parentId === board.id && board.trashedAt !== null && r.trashedAt === board.trashedAt && r.trashedBy === board.trashedBy,
  );
}

/** A trashed board and everything that went with it, brought back. */
export function restoreBoardChanges(records: Records, boardId: string): Change[] {
  const board = records[boardId];
  if (board?.type !== 'board' || board.trashedAt === null) return [];
  return [{ kind: 'restore', id: boardId }, ...trashedWithBoard(records, board).map((r): Change => ({ kind: 'restore', id: r.id }))];
}

/** A board and its live items, to the Trash in one group. */
export function trashBoardChanges(records: Records, boardId: string): Change[] {
  const board = records[boardId];
  if (board?.type !== 'board' || board.trashedAt !== null) return [];
  const items = Object.values(records).filter((r) => r.type === 'board_item' && r.parentId === boardId && r.trashedAt === null);
  return [{ kind: 'trash', id: boardId }, ...items.map((r): Change => ({ kind: 'trash', id: r.id }))];
}

function nextBoardKey(records: Records, projectId: string): string {
  // Trashed boards count, so one restored later never shares a place with one made since.
  return keyBetween(boardsOf(records, projectId, true).at(-1)?.sortKey ?? null, null);
}

export interface OpenBoard {
  id: string;
  /** Empty when the board is already there: opening it writes nothing. */
  changes: Change[];
}

/**
 * Opening a department's board: the live one as it is; one in the Trash restored with its items (never a second);
 * else a new one. Made the first time it's opened and never ahead, so a new project has none.
 */
export function openDepartmentBoard(records: Records, projectId: string, department: Department): OpenBoard {
  const found = departmentBoard(records, projectId, department);
  if (found) return { id: found.id, changes: found.trashedAt === null ? [] : restoreBoardChanges(records, found.id) };
  const id = crypto.randomUUID();
  return {
    id,
    changes: [
      {
        kind: 'create',
        record: { id, type: 'board', parentId: projectId, sortKey: nextBoardKey(records, projectId), props: { kind: 'moodboard', department, name: null } },
      },
    ],
  };
}

/** A free board with a name. */
export function newBoard(records: Records, projectId: string, name: string): OpenBoard {
  const id = crypto.randomUUID();
  return {
    id,
    changes: [
      {
        kind: 'create',
        record: { id, type: 'board', parentId: projectId, sortKey: nextBoardKey(records, projectId), props: { kind: 'moodboard', department: null, name: name.trim() } },
      },
    ],
  };
}

export const renameBoard = (boardId: string, name: string): Change => ({ kind: 'update', id: boardId, set: { name: name.trim() } });

// A board's links (5.4, docs/SBD_FORMAT.md, Boards): the scenes, characters and locations it is about, as `scene_ids`,
// `character_ids` and `location_ids` on the board record (lists of record ids). Shown as "Linked to: SC 04, MAYA, Rooftop"
// in the board's strip, and read the other way by the places that list the boards linked to a scene, character or location.
// A linked record in the Trash drops out of what is shown but stays in the list, so restoring it brings the link back.

export type LinkKind = 'scene' | 'character' | 'location';
const LINK_PROP: Readonly<Record<LinkKind, string>> = { scene: 'scene_ids', character: 'character_ids', location: 'location_ids' };
const LINK_TYPE: Readonly<Record<LinkKind, SbdRecord['type']>> = { scene: 'scene', character: 'character', location: 'location' };

export interface BoardLinks {
  sceneIds: string[];
  characterIds: string[];
  locationIds: string[];
}

const idList = (value: SbdRecord['props'][string] | undefined): string[] =>
  Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id !== ''))] : [];

/** The ids a board's record lists, live or not. */
export function boardLinks(props: SbdRecord['props']): BoardLinks {
  return { sceneIds: idList(props.scene_ids), characterIds: idList(props.character_ids), locationIds: idList(props.location_ids) };
}

const idsOfKind = (links: BoardLinks, kind: LinkKind): string[] => (kind === 'scene' ? links.sceneIds : kind === 'character' ? links.characterIds : links.locationIds);

/** The live records a board links to, scenes in board order, characters and locations in the order they were linked. */
export function linkedRecords(records: Records, board: SbdRecord): { scenes: SbdRecord[]; characters: SbdRecord[]; locations: SbdRecord[] } {
  const links = boardLinks(board.props);
  const live = (kind: LinkKind) =>
    idsOfKind(links, kind).flatMap((id) => {
      const record = records[id];
      return record?.type === LINK_TYPE[kind] && record.trashedAt === null ? [record] : [];
    });
  return { scenes: live('scene').sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0)), characters: live('character'), locations: live('location') };
}

/** One linked record as the line names it: "SC 04", "MAYA", "Rooftop". */
export function linkName(kind: LinkKind, record: SbdRecord): string {
  if (kind === 'scene') return sceneLabel(sceneFields(record.props).number);
  const name = typeof record.props.name === 'string' ? record.props.name.trim() : '';
  return name !== '' ? name : kind === 'location' ? t('locations.unnamed') : t('moodboard.links.character');
}

/** "SC 04, MAYA, Rooftop": the live links in that order, '' when there are none. */
export function linkedLine(records: Records, board: SbdRecord): string {
  const linked = linkedRecords(records, board);
  return [...linked.scenes.map((r) => linkName('scene', r)), ...linked.characters.map((r) => linkName('character', r)), ...linked.locations.map((r) => linkName('location', r))].join(', ');
}

/**
 * The edit that sets a board's links to these: only the lists that changed, an emptied one taken off. Ids of linked records
 * that are in the Trash are kept in their list (they aren't shown, and come back with a restore).
 */
export function setLinksChange(records: Records, boardId: string, chosen: BoardLinks): Change[] {
  const board = records[boardId];
  if (board?.type !== 'board' || board.trashedAt !== null) return [];
  const now = boardLinks(board.props);
  const set: Record<string, string[]> = {};
  const unset: string[] = [];
  for (const kind of ['scene', 'character', 'location'] as const) {
    const stored = idsOfKind(now, kind);
    const exists = (id: string) => records[id]?.type === LINK_TYPE[kind];
    const live = (id: string) => exists(id) && records[id]?.trashedAt === null;
    const wanted = new Set(idsOfKind(chosen, kind).filter(live));
    // Kept in the order stored: a linked record in the Trash stays (it comes back with a restore), one chosen stays, one
    // unchosen goes, and one that no longer exists goes too. Newly chosen ones follow.
    const next = [...stored.filter((id) => (live(id) ? wanted.has(id) : exists(id))), ...[...wanted].filter((id) => !stored.includes(id))];
    // Compared as sets: the same links in another order are no step.
    const same = next.length === stored.length && next.every((id) => stored.includes(id));
    if (same) continue;
    if (next.length === 0) unset.push(LINK_PROP[kind]);
    else set[LINK_PROP[kind]] = next;
  }
  if (Object.keys(set).length === 0 && unset.length === 0) return [];
  return [{ kind: 'update', id: boardId, ...(Object.keys(set).length > 0 ? { set } : {}), ...(unset.length > 0 ? { unset } : {}) }];
}

/** The live boards that link to this scene, character or location, in the order they were made. */
export function boardsLinkedTo(records: Records, projectId: string, kind: LinkKind, id: string): SbdRecord[] {
  return linkIndex(records, projectId).get(`${kind}:${id}`) ?? [];
}

/**
 * Which live boards link to each scene, character and location, worked out once per version of the records (the store makes
 * a new object for each change) and read by every list that shows them.
 */
const linkIndexes = new WeakMap<Records, Map<string, Map<string, SbdRecord[]>>>();
function linkIndex(records: Records, projectId: string): Map<string, SbdRecord[]> {
  let byProject = linkIndexes.get(records);
  if (!byProject) {
    byProject = new Map();
    linkIndexes.set(records, byProject);
  }
  let index = byProject.get(projectId);
  if (!index) {
    index = new Map();
    for (const board of boardsOf(records, projectId)) {
      const links = boardLinks(board.props);
      for (const kind of ['scene', 'character', 'location'] as const) {
        for (const id of idsOfKind(links, kind)) {
          const key = `${kind}:${id}`;
          const list = index.get(key);
          if (list) list.push(board);
          else index.set(key, [board]);
        }
      }
    }
    byProject.set(projectId, index);
  }
  return index;
}
