import { withField, withoutField } from '../../core/model/customFields';
import type { SbdRecord } from '../../core/model/record';
import { sceneNumberBetween, shotNumbers } from '../../core/model/shotNumbers';
import { projectStoryboard, sceneFields, shotFields, type SceneFields, type ShotFields } from '../../core/model/storyboard';
import type { ShotStatus } from '../../core/model/shotStatus';
import type { Change } from '../../core/ops/ops';
import { keyBetween } from '../../core/ops/order';

// The storyboard as views read it, and the changes the board makes. Views read records and never copy them
// (CLAUDE.md); counts and coverage are computed here each time, never stored. Every change that moves, adds or
// removes a shot renumbers its scene in the same op group, so undo takes back the edit and its numbers together.
// Notes (1.12) sit among a scene's frames in the same order but take no number. New sort keys are worked out among
// every item in a scene, trashed ones too, so a restored item never shares a key with one added since.

type Records = Readonly<Record<string, SbdRecord>>;

const bySortKey = (a: SbdRecord, b: SbdRecord) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0);

export interface BoardShot {
  record: SbdRecord;
  fields: ShotFields;
}

export interface BoardNote {
  record: SbdRecord;
  text: string;
}

/** A frame or a note, as the board lays them out. */
export type BoardItem = { kind: 'shot'; shot: BoardShot } | { kind: 'note'; note: BoardNote };

export interface BoardScene {
  record: SbdRecord;
  fields: SceneFields;
  /** Live shots in board order. */
  shots: BoardShot[];
  /** Live shots and notes together, in board order. */
  items: BoardItem[];
  counts: Record<ShotStatus, number>;
}

const itemRecord = (item: BoardItem) => (item.kind === 'shot' ? item.shot.record : item.note.record);

function childrenOf(records: Records, parentId: string, type: SbdRecord['type'], includeTrashed = false): SbdRecord[] {
  return Object.values(records)
    .filter((r) => r.type === type && r.parentId === parentId && (includeTrashed || r.trashedAt === null))
    .sort(bySortKey);
}

export function boardScene(records: Records, scene: SbdRecord): BoardScene {
  const shots = childrenOf(records, scene.id, 'shot').map((record) => ({ record, fields: shotFields(record.props) }));
  const notes = childrenOf(records, scene.id, 'note').map((record) => ({
    record,
    text: typeof record.props.text === 'string' ? record.props.text : '',
  }));
  const items: BoardItem[] = [
    ...shots.map((shot): BoardItem => ({ kind: 'shot', shot })),
    ...notes.map((note): BoardItem => ({ kind: 'note', note })),
  ].sort((a, b) => bySortKey(itemRecord(a), itemRecord(b)));
  const counts: Record<ShotStatus, number> = { have: 0, need: 0, source: 0 };
  for (const shot of shots) counts[shot.fields.status] += 1;
  return { record: scene, fields: sceneFields(scene.props), shots, items, counts };
}

/** Every live scene in board order, each with its live shots. */
export function board(records: Records, projectId: string): BoardScene[] {
  return childrenOf(records, projectId, 'scene').map((scene) => boardScene(records, scene));
}

/** Share of frames whose picture is in hand (status Have), 0–100; null for a board with no frames yet. */
export function coverage(scenes: readonly BoardScene[]): number | null {
  const total = scenes.reduce((n, s) => n + s.shots.length, 0);
  if (total === 0) return null;
  const have = scenes.reduce((n, s) => n + s.counts.have, 0);
  return Math.round((have / total) * 100);
}

/**
 * The updates that bring a scene's shot numbers in line, given the scene's shots after a change (`shots`, in order,
 * trashed ones included so a locked scene never reuses their letters). `sceneProps` can stand in for the scene's
 * props mid-change, as when its own number or lock is changing in the same group.
 */
export function renumber(
  records: Records,
  projectId: string,
  sceneId: string,
  shots: readonly SbdRecord[],
  sceneProps?: SbdRecord['props'],
): Change[] {
  const scene = records[sceneId];
  if (!scene) return [];
  const fields = sceneFields(sceneProps ?? scene.props);
  const { skipIO } = projectStoryboard(records[projectId]?.props);
  const numbered = shots.map((shot) => ({ id: shot.id, number: shotFields(shot.props).number, trashed: shot.trashedAt !== null }));
  const changed = shotNumbers(fields.number, numbered, { locked: fields.numbersLocked, skipIO });
  return [...changed].map(([id, number]): Change => ({ kind: 'update', id, set: { number } }));
}

/** All of a scene's shots in order, trashed included. */
function sceneShots(records: Records, sceneId: string): SbdRecord[] {
  return childrenOf(records, sceneId, 'shot', true);
}

/** Every shot and note in a scene, trashed included, in order: where new sort keys are worked out. */
function sceneItems(records: Records, sceneId: string): SbdRecord[] {
  return [...childrenOf(records, sceneId, 'shot', true), ...childrenOf(records, sceneId, 'note', true)].sort(bySortKey);
}

/** The keys either side of the place after `afterId` (or the end of the scene with null). */
function slotAfter(records: Records, sceneId: string, afterId: string | null): { before: string | null; after: string | null } {
  const items = sceneItems(records, sceneId);
  const at = afterId === null ? items.length - 1 : items.findIndex((item) => item.id === afterId);
  return { before: items[at]?.sortKey ?? null, after: items[at + 1]?.sortKey ?? null };
}

/** A scene's shots in order once `changed` takes its new place among them. */
function shotsWith(records: Records, sceneId: string, changed: SbdRecord): SbdRecord[] {
  return [...sceneShots(records, sceneId).filter((s) => s.id !== changed.id), changed].sort(bySortKey);
}

/** A new frame after `afterShotId` (or at the end of the scene), and the scene's numbers after it. */
export function addShot(
  records: Records,
  projectId: string,
  sceneId: string,
  afterShotId: string | null = null,
  props: SbdRecord['props'] = {},
): { changes: Change[]; shotId: string } {
  const { changes, shotIds } = addShots(records, projectId, sceneId, afterShotId, [props]);
  return { changes, shotId: shotIds[0] ?? '' };
}

/**
 * New frames in a row after `afterShotId` (or at the end of the scene), one per entry in `props`, and the scene's
 * numbers after them, all in one op group: a drop of five pictures is one undo.
 */
export function addShots(
  records: Records,
  projectId: string,
  sceneId: string,
  afterShotId: string | null,
  props: readonly SbdRecord['props'][],
): { changes: Change[]; shotIds: string[] } {
  const slot = slotAfter(records, sceneId, afterShotId);
  let before = slot.before;
  const after = slot.after;
  const created = props.map((own): SbdRecord => {
    before = keyBetween(before, after);
    return {
      id: crypto.randomUUID(),
      type: 'shot',
      parentId: sceneId,
      sortKey: before,
      props: { status: 'need', ...own },
      trashedAt: null,
      trashedBy: null,
      createdAt: '',
      updatedAt: '',
    };
  });
  const order = [...sceneShots(records, sceneId), ...created].sort(bySortKey);
  const numbers = renumber(records, projectId, sceneId, order);
  const isNew = new Set(created.map((shot) => shot.id));
  const numberOf = (id: string) => {
    const own = numbers.find((c) => c.kind === 'update' && c.id === id);
    return own?.kind === 'update' ? own.set?.number : undefined;
  };
  return {
    shotIds: created.map((shot) => shot.id),
    changes: [
      // Each create carries its number, so a frame never exists, even for a moment, without one.
      ...created.map((shot): Change => {
        const number = numberOf(shot.id);
        return {
          kind: 'create',
          record: {
            id: shot.id,
            type: 'shot',
            parentId: sceneId,
            sortKey: shot.sortKey,
            props: { ...shot.props, ...(number === undefined ? {} : { number }) },
          },
        };
      }),
      ...numbers.filter((c) => !(c.kind === 'update' && isNew.has(c.id))),
    ],
  };
}

/** Sets one of a frame's custom fields (1.19), or takes it off with null; from the records it lands on, so quick edits all stay. */
export function setCustomField(records: Records, shotId: string, name: string, value: string | null): Change[] {
  const props = records[shotId]?.props;
  if (!props) return [];
  return [{ kind: 'update', id: shotId, ...(value === null ? withoutField(props, name) : withField(props, name, value)) }];
}

/** Sends a frame to the Trash, and closes up its scene's letters unless they're locked. */
export function trashShot(records: Records, projectId: string, shotId: string): Change[] {
  const shot = records[shotId];
  if (!shot?.parentId) return [];
  const order = sceneShots(records, shot.parentId).map((s) => (s.id === shotId ? { ...s, trashedAt: 'now' } : s));
  return [{ kind: 'trash', id: shotId }, ...renumber(records, projectId, shot.parentId, order)];
}

/**
 * Moves a frame or a note to `beforeId`'s place in `targetSceneId` (or the end of it with null); `beforeId` can be
 * either kind. A frame renumbers the scenes it leaves and joins in the same op group, and one moved into another scene
 * is numbered there as a new frame would be: by board order while unlocked, or the next free letter once locked.
 */
export function moveItem(
  records: Records,
  projectId: string,
  id: string,
  targetSceneId: string,
  beforeId: string | null,
): Change[] {
  const item = records[id];
  const sourceSceneId = item?.parentId;
  if (!item || !sourceSceneId || beforeId === id || (item.type !== 'shot' && item.type !== 'note')) return [];
  if (leavesLockedScene(records, id, targetSceneId)) return [];
  const target = sceneItems(records, targetSceneId).filter((s) => s.id !== id);
  const at = beforeId === null ? target.length : target.findIndex((s) => s.id === beforeId);
  if (at === -1) return [];
  const sortKey = keyBetween(target[at - 1]?.sortKey ?? null, target[at]?.sortKey ?? null);
  const move: Change = { kind: 'move', id, parentId: targetSceneId, sortKey };
  if (item.type === 'note') return [move];
  const changesScene = sourceSceneId !== targetSceneId;
  const moved: SbdRecord = {
    ...item,
    parentId: targetSceneId,
    sortKey,
    // Into another scene the old number means nothing (3B in scene 4); it's given a new one.
    props: changesScene ? { ...item.props, number: '' } : item.props,
  };
  return [
    move,
    ...renumber(records, projectId, targetSceneId, shotsWith(records, targetSceneId, moved)),
    ...(changesScene
      ? renumber(records, projectId, sourceSceneId, sceneShots(records, sourceSceneId).filter((s) => s.id !== id))
      : []),
  ];
}

/**
 * Whether a move would take a frame out of a scene whose numbers are locked. It isn't allowed: the frame's number is
 * on a slate there, and once it left, nothing would stop a later frame taking the same letter. Unlocking the scene
 * first frees it to move.
 */
export function leavesLockedScene(records: Records, id: string, targetSceneId: string): boolean {
  const item = records[id];
  if (item?.type !== 'shot' || !item.parentId || item.parentId === targetSceneId) return false;
  return sceneFields(records[item.parentId]?.props ?? {}).numbersLocked;
}

/** moveItem for a frame. */
export const moveShot = moveItem;

/** A note card after `afterId` (or at the end of the scene). Notes take no shot number. */
export function addNote(
  records: Records,
  sceneId: string,
  afterId: string | null,
  text = '',
): Extract<Change, { kind: 'create' }> & { record: { id: string } } {
  const { before, after } = slotAfter(records, sceneId, afterId);
  return {
    kind: 'create',
    record: { id: crypto.randomUUID(), type: 'note', parentId: sceneId, sortKey: keyBetween(before, after), props: { text } },
  };
}

/** The live locations in the project, by name. */
export function locations(records: Records, projectId: string): { id: string; name: string }[] {
  return childrenOf(records, projectId, 'location')
    .map((record) => ({ id: record.id, name: typeof record.props.name === 'string' ? record.props.name : '' }))
    .filter((location) => location.name !== '')
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Sets a scene's location by name: the location already in the project with that name (whatever its case), or a new
 * one, in the same op group. Phase 3 gives locations their addresses and contacts.
 */
export function setSceneLocation(records: Records, projectId: string, sceneId: string, name: string): Change[] {
  const trimmed = name.trim();
  if (!records[sceneId] || trimmed === '') return [];
  const existing = locations(records, projectId).find((l) => l.name.toLowerCase() === trimmed.toLowerCase());
  // Already this scene's location: no edit, so no empty step in History.
  if (existing && sceneFields(records[sceneId].props).locationId === existing.id) return [];
  if (existing) return [{ kind: 'update', id: sceneId, set: { location_id: existing.id } }];
  const id = crypto.randomUUID();
  const all = childrenOf(records, projectId, 'location', true);
  return [
    {
      kind: 'create',
      record: { id, type: 'location', parentId: projectId, sortKey: keyBetween(all.at(-1)?.sortKey ?? null, null), props: { name: trimmed } },
    },
    { kind: 'update', id: sceneId, set: { location_id: id } },
  ];
}

/** Locks or unlocks a scene's shot numbers. Unlocking brings them back in line with the board. */
export function setNumbersLocked(records: Records, projectId: string, sceneId: string, locked: boolean): Change[] {
  const scene = records[sceneId];
  if (!scene) return [];
  const props = { ...scene.props, numbers_locked: locked };
  return [
    { kind: 'update', id: sceneId, set: { numbers_locked: locked } },
    ...renumber(records, projectId, sceneId, sceneShots(records, sceneId), props),
  ];
}

/**
 * Changes a scene's number. Unlocked, its shots follow (4A becomes 7A). Locked, they keep the numbers already on the
 * slates; only frames added later take the new scene number.
 */
export function setSceneNumber(records: Records, projectId: string, sceneId: string, number: string): Change[] {
  const scene = records[sceneId];
  if (!scene) return [];
  const props = { ...scene.props, number };
  return [
    { kind: 'update', id: sceneId, set: { number } },
    ...renumber(records, projectId, sceneId, sceneShots(records, sceneId), props),
  ];
}

/** Allows or skips I and O in shot letters for the whole project, renumbering every unlocked scene. */
export function setLettersAllowIO(records: Records, projectId: string, allow: boolean): Change[] {
  const project = records[projectId];
  if (!project) return [];
  const next = { ...records, [projectId]: { ...project, props: { ...project.props, shot_letters_allow_io: allow } } };
  const scenes = childrenOf(records, projectId, 'scene');
  return [
    { kind: 'update', id: projectId, set: { shot_letters_allow_io: allow } },
    ...scenes.flatMap((scene) => renumber(next, projectId, scene.id, sceneShots(records, scene.id))),
  ];
}

/** Slate order for scene numbers: by number, then A4 (inserted before 4), then 4, then 4A, 4B. */
export function compareSceneNumbers(a: string, b: string): number {
  const parse = (n: string) => {
    const match = /^([A-Z]*)(\d+)([A-Z]*)$/.exec(n);
    return match ? { prefix: match[1] ?? '', number: Number(match[2]), suffix: match[3] ?? '' } : null;
  };
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return a < b ? -1 : a > b ? 1 : 0;
  if (x.number !== y.number) return x.number - y.number;
  // Prefixed ones come first, then the plain number, then suffixed ones; letters by length, then alphabet.
  const rank = (p: typeof x) => (p.prefix ? 0 : p.suffix ? 2 : 1);
  if (rank(x) !== rank(y)) return rank(x) - rank(y);
  const left = x.prefix || x.suffix;
  const right = y.prefix || y.suffix;
  return left.length - right.length || (left < right ? -1 : left > right ? 1 : 0);
}

/**
 * + New scene and + Add Scene: a scene at the end of the board, numbered one past the highest. With `afterSceneId`
 * (the "/" menu), right after that scene instead, numbered between it and the next as scripts do: 4A after 4. When
 * that number would sort past the scenes that follow (4B, with 4A already next), it goes after them, so the board
 * always reads in slate order.
 */
export function addScene(
  records: Records,
  projectId: string,
  afterSceneId: string | null = null,
): Extract<Change, { kind: 'create' }> & { record: { id: string } } {
  // Trashed scenes count, so a restored one never shares a number or a place with one added since.
  const all = childrenOf(records, projectId, 'scene', true);
  const taken = all.map((scene) => sceneFields(scene.props).number);
  const live = all.filter((scene) => scene.trashedAt === null);
  const numberOf = (scene: SbdRecord | undefined) => (scene ? sceneFields(scene.props).number : null);
  let at = afterSceneId === null ? -1 : live.findIndex((scene) => scene.id === afterSceneId);
  let number: string;
  if (at === -1) {
    number = sceneNumberBetween(taken.at(-1) ?? null, null, taken);
  } else {
    number = sceneNumberBetween(numberOf(live[at]), numberOf(live[at + 1]), taken);
    // Only past scenes that also sort after the one picked: on a board renumbered out of order (1, 20, 3), a scene
    // after 20 stays right after it.
    const picked = numberOf(live[at]) ?? '';
    while (
      live[at + 1] &&
      compareSceneNumbers(numberOf(live[at + 1]) ?? '', number) < 0 &&
      compareSceneNumbers(numberOf(live[at + 1]) ?? '', picked) > 0
    ) {
      at += 1;
    }
  }
  // After the last scene, trashed ones included, when it goes at the end, as + Scene does; else between neighbours.
  const before = at === -1 || !live[at + 1] ? (all.at(-1) ?? null) : (live[at] ?? null);
  const nextKey = before ? (all[all.indexOf(before) + 1]?.sortKey ?? null) : null;
  return {
    kind: 'create',
    record: {
      // Made here, not by the op, so the caller can make the new scene the active one.
      id: crypto.randomUUID(),
      type: 'scene',
      parentId: projectId,
      sortKey: keyBetween(before?.sortKey ?? null, nextKey),
      props: { number, name: '' },
    },
  };
}
