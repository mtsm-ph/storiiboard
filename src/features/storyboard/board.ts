import type { SbdRecord } from '../../core/model/record';
import { sceneNumberBetween, shotNumbers } from '../../core/model/shotNumbers';
import { projectStoryboard, sceneFields, shotFields, type SceneFields, type ShotFields } from '../../core/model/storyboard';
import type { ShotStatus } from '../../core/model/shotStatus';
import type { Change } from '../../core/ops/ops';
import { keyBetween } from '../../core/ops/order';

// The storyboard as views read it, and the changes the board makes. Views read records and never copy them
// (CLAUDE.md); counts and coverage are computed here each time, never stored. Every change that moves, adds or
// removes a shot renumbers its scene in the same op group, so undo takes back the edit and its numbers together.

type Records = Readonly<Record<string, SbdRecord>>;

const bySortKey = (a: SbdRecord, b: SbdRecord) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0);

export interface BoardShot {
  record: SbdRecord;
  fields: ShotFields;
}

export interface BoardScene {
  record: SbdRecord;
  fields: SceneFields;
  /** Live shots in board order. */
  shots: BoardShot[];
  counts: Record<ShotStatus, number>;
}

function childrenOf(records: Records, parentId: string, type: SbdRecord['type'], includeTrashed = false): SbdRecord[] {
  return Object.values(records)
    .filter((r) => r.type === type && r.parentId === parentId && (includeTrashed || r.trashedAt === null))
    .sort(bySortKey);
}

export function boardScene(records: Records, scene: SbdRecord): BoardScene {
  const shots = childrenOf(records, scene.id, 'shot').map((record) => ({ record, fields: shotFields(record.props) }));
  const counts: Record<ShotStatus, number> = { have: 0, need: 0, source: 0 };
  for (const shot of shots) counts[shot.fields.status] += 1;
  return { record: scene, fields: sceneFields(scene.props), shots, counts };
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
  const shots = sceneShots(records, sceneId);
  const at = afterShotId === null ? shots.length - 1 : shots.findIndex((s) => s.id === afterShotId);
  const after = shots[at + 1]?.sortKey ?? null;
  let before = shots[at]?.sortKey ?? null;
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
  const order = [...shots.slice(0, at + 1), ...created, ...shots.slice(at + 1)];
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

/** Sends a frame to the Trash, and closes up its scene's letters unless they're locked. */
export function trashShot(records: Records, projectId: string, shotId: string): Change[] {
  const shot = records[shotId];
  if (!shot?.parentId) return [];
  const order = sceneShots(records, shot.parentId).map((s) => (s.id === shotId ? { ...s, trashedAt: 'now' } : s));
  return [{ kind: 'trash', id: shotId }, ...renumber(records, projectId, shot.parentId, order)];
}

/**
 * Moves a frame to `beforeShotId`'s place in `targetSceneId` (or the end of it with null), renumbering the scenes it
 * leaves and joins in the same op group. A frame moved into another scene is numbered there as a new frame would be:
 * by board order while unlocked, or the next free letter once locked.
 */
export function moveShot(
  records: Records,
  projectId: string,
  shotId: string,
  targetSceneId: string,
  beforeShotId: string | null,
): Change[] {
  const shot = records[shotId];
  const sourceSceneId = shot?.parentId;
  if (!shot || !sourceSceneId || beforeShotId === shotId) return [];
  const target = sceneShots(records, targetSceneId).filter((s) => s.id !== shotId);
  const at = beforeShotId === null ? target.length : target.findIndex((s) => s.id === beforeShotId);
  if (at === -1) return [];
  const sortKey = keyBetween(target[at - 1]?.sortKey ?? null, target[at]?.sortKey ?? null);
  const changesScene = sourceSceneId !== targetSceneId;
  const moved: SbdRecord = {
    ...shot,
    parentId: targetSceneId,
    sortKey,
    // Into another scene the old number means nothing (3B in scene 4); it's given a new one.
    props: changesScene ? { ...shot.props, number: '' } : shot.props,
  };
  const order = [...target.slice(0, at), moved, ...target.slice(at)];
  return [
    { kind: 'move', id: shotId, parentId: targetSceneId, sortKey },
    ...renumber(records, projectId, targetSceneId, order),
    ...(changesScene
      ? renumber(records, projectId, sourceSceneId, sceneShots(records, sourceSceneId).filter((s) => s.id !== shotId))
      : []),
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

/** + New scene and + Add Scene: a scene at the end of the board, numbered one past the highest. */
export function addScene(records: Records, projectId: string): Extract<Change, { kind: 'create' }> & { record: { id: string } } {
  const scenes = childrenOf(records, projectId, 'scene');
  const taken = scenes.map((scene) => sceneFields(scene.props).number);
  return {
    kind: 'create',
    record: {
      // Made here, not by the op, so the caller can make the new scene the active one.
      id: crypto.randomUUID(),
      type: 'scene',
      parentId: projectId,
      sortKey: keyBetween(scenes.at(-1)?.sortKey ?? null, null),
      props: { number: sceneNumberBetween(taken.at(-1) ?? null, null, taken), name: '' },
    },
  };
}
