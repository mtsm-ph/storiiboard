import { t } from '../i18n';
import type { Change } from '../ops/ops';
import { keyBetween } from '../ops/order';
import { framesOffCameras } from './cameraLinks';
import type { JsonValue, Props, SbdRecord } from './record';

// Setups (6.0, docs/PHASE6_DECISIONS.md 3). A setup is one camera position and lighting state; several frames can share
// one. It is a `setup` record under its scene, numbered within the scene (Setup 1, Setup 2), never lettered: shot
// numbers already use the letters (12A). The number is its place among the scene's live setups in the scene's order of
// children, worked out here, never stored, so a reorder or a delete renumbers the rest and a language never changes it.
// A frame joins at most one by its `setup_id`; a frame with none is a setup of its own, as Shoot days count it.
//
// One reader decides what a frame's `setup_id` means (frameSetupId): a live setup in the frame's own scene, or none.
// An id naming a setup in another scene, one in the Trash, or nothing at all reads as "no setup" everywhere. So a
// deleted setup's frames keep their id and come back into it with a restore, untouched.

type Records = Readonly<Record<string, SbdRecord>>;

export interface SetupFields {
  /** Typed by hand, '' for none: "Window side". */
  name: string;
}

const text = (value: JsonValue | undefined): string => (typeof value === 'string' ? value : '');

export function setupFields(props: Props): SetupFields {
  return { name: text(props.name).trim() };
}

export interface Setup {
  record: SbdRecord;
  fields: SetupFields;
  /** 1 for the scene's first live setup. */
  number: number;
}

const bySortKey = (a: SbdRecord, b: SbdRecord) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0);

/** Every setup under a scene in order, those in the Trash too: where new sort keys are worked out. */
function allSetups(records: Records, sceneId: string): SbdRecord[] {
  return Object.values(records)
    .filter((r) => r.type === 'setup' && r.parentId === sceneId)
    .sort(bySortKey);
}

/** The scene's live setups in order, each numbered. */
export function sceneSetups(records: Records, sceneId: string): Setup[] {
  return allSetups(records, sceneId)
    .filter((r) => r.trashedAt === null)
    .map((record, i) => ({ record, fields: setupFields(record.props), number: i + 1 }));
}

/** A live setup by its id, or null. */
function liveSetup(records: Records, id: string): SbdRecord | null {
  const setup = records[id];
  return setup?.type === 'setup' && setup.trashedAt === null ? setup : null;
}

/**
 * The one reader of a frame's `setup_id`: the id of a live setup in the frame's own scene, else null. Another scene's
 * setup, one in the Trash, or an id that names nothing are all "no setup".
 */
export function frameSetupId(records: Records, shot: SbdRecord): string | null {
  const id = shot.props.setup_id;
  if (typeof id !== 'string' || id === '') return null;
  const setup = liveSetup(records, id);
  return setup && setup.parentId !== null && setup.parentId === shot.parentId ? setup.id : null;
}

/** The frame's setup with its number, or null. */
export function frameSetup(records: Records, shot: SbdRecord): Setup | null {
  const id = frameSetupId(records, shot);
  if (id === null || shot.parentId === null) return null;
  return sceneSetups(records, shot.parentId).find((s) => s.record.id === id) ?? null;
}

/** The live frames in a scene, in board order. */
function sceneFrames(records: Records, sceneId: string): SbdRecord[] {
  return Object.values(records)
    .filter((r) => r.type === 'shot' && r.parentId === sceneId && r.trashedAt === null)
    .sort(bySortKey);
}

/** A setup's frames, in board order. */
export function setupFrames(records: Records, setupId: string): SbdRecord[] {
  const setup = liveSetup(records, setupId);
  if (!setup?.parentId) return [];
  return sceneFrames(records, setup.parentId).filter((shot) => frameSetupId(records, shot) === setupId);
}

/** A scene's live frames in no setup, in board order: what a setup can take in. */
export function framesWithoutSetup(records: Records, sceneId: string): SbdRecord[] {
  return sceneFrames(records, sceneId).filter((shot) => frameSetupId(records, shot) === null);
}

/** "Setup 2" or "Setup 2 · Window side": for labels and choices, where the parts can't be set apart. */
export function setupLabel(setup: Pick<Setup, 'number' | 'fields'>): string {
  return setup.fields.name === '' ? t('setup.label', { number: setup.number }) : t('setup.labelNamed', { number: setup.number, name: setup.fields.name });
}

// The edits. Each is one op group, so one ⌘Z.

/** A new setup at the end of the scene's (after those in the Trash too, so a restored one never shares a key). */
export function addSetup(records: Records, sceneId: string, id: string = crypto.randomUUID()): Change[] {
  const scene = records[sceneId];
  if (scene?.type !== 'scene' || scene.trashedAt !== null) return [];
  const last = allSetups(records, sceneId).at(-1)?.sortKey ?? null;
  return [{ kind: 'create', record: { id, type: 'setup', parentId: sceneId, sortKey: keyBetween(last, null), props: { name: '' } } }];
}

/** A setup's name, trimmed; '' takes it off. Nothing when it's that already or the setup isn't live. */
export function renameSetup(records: Records, id: string, name: string): Change[] {
  const setup = liveSetup(records, id);
  const next = name.trim();
  if (!setup || setupFields(setup.props).name === next) return [];
  return [{ kind: 'update', id, set: { name: next } }];
}

/**
 * A setup to place `to` (0 for first) among its scene's live setups. Its new key sits right after the live setup it
 * follows, among every setup in the scene, trashed ones included, so it never shares a key with one in the Trash.
 */
export function moveSetup(records: Records, id: string, to: number): Change[] {
  const setup = liveSetup(records, id);
  if (!setup?.parentId) return [];
  const live = sceneSetups(records, setup.parentId).map((s) => s.record);
  const from = live.findIndex((r) => r.id === id);
  const target = Math.max(0, Math.min(to, live.length - 1));
  if (from === -1 || from === target) return [];
  const others = live.filter((r) => r.id !== id);
  const all = allSetups(records, setup.parentId).filter((r) => r.id !== id);
  const before = others[target - 1] ?? null;
  let sortKey: string;
  if (before) {
    const next = all[all.indexOf(before) + 1] ?? null;
    sortKey = keyBetween(before.sortKey, next?.sortKey ?? null);
  } else {
    const first = others[0] ?? null;
    const previous = first ? (all[all.indexOf(first) - 1] ?? null) : null;
    sortKey = keyBetween(previous?.sortKey ?? null, first?.sortKey ?? null);
  }
  return [{ kind: 'move', id, parentId: setup.parentId, sortKey }];
}

/** A setup to the Trash; its frames keep their `setup_id`, so they read as "no setup" until a restore brings it back. */
export function trashSetup(records: Records, id: string): Change[] {
  return liveSetup(records, id) ? [{ kind: 'trash', id }] : [];
}

const liveShot = (records: Records, id: string): SbdRecord | null => {
  const shot = records[id];
  return shot?.type === 'shot' && shot.trashedAt === null ? shot : null;
};

/**
 * Frames into a setup, in one edit. Only live frames of the setup's own scene; one already in it is left as it is. Each
 * comes off the cameras that list it (its old setup's above all, cameraLinks.ts), so going back later never silently
 * links it to one of them again.
 */
export function joinSetup(records: Records, shotIds: readonly string[], setupId: string): Change[] {
  const setup = liveSetup(records, setupId);
  if (!setup) return [];
  const joining = [...new Set(shotIds)].filter((id) => {
    const shot = liveShot(records, id);
    return shot !== null && shot.parentId === setup.parentId && shot.props.setup_id !== setupId;
  });
  return [...joining.map((id): Change => ({ kind: 'update', id, set: { setup_id: setupId } })), ...framesOffCameras(records, joining)];
}

/**
 * Frames out of their setups, in one edit. Only frames that read as in one: a frame whose setup is in the Trash keeps
 * its id, so a restore still brings it back into it. Each comes off its setup's cameras in the same edit.
 */
export function leaveSetup(records: Records, shotIds: readonly string[]): Change[] {
  const leaving = [...new Set(shotIds)].filter((id) => {
    const shot = liveShot(records, id);
    return shot !== null && frameSetupId(records, shot) !== null;
  });
  return [...leaving.map((id): Change => ({ kind: 'update', id, unset: ['setup_id'] })), ...framesOffCameras(records, leaving)];
}

/** The scene all these live frames share, or null when they're in more than one (or none is live). */
export function sharedScene(records: Records, shotIds: readonly string[]): string | null {
  const scenes = new Set(shotIds.map((id) => liveShot(records, id)?.parentId ?? null));
  const [only] = [...scenes];
  return scenes.size === 1 && typeof only === 'string' ? only : null;
}

/** New setup from frames: a setup at the end of their scene's, with them in it, as one edit. Only frames of one scene. */
export function newSetupFromFrames(records: Records, shotIds: readonly string[], id: string = crypto.randomUUID()): Change[] {
  const sceneId = sharedScene(records, shotIds);
  if (sceneId === null) return [];
  const made = addSetup(records, sceneId, id);
  if (made.length === 0) return [];
  const frames = [...new Set(shotIds)];
  const joined = frames.map((shotId): Change => ({ kind: 'update', id: shotId, set: { setup_id: id } }));
  // Out of the setups they were in: off those setups' cameras too.
  return [...made, ...joined, ...framesOffCameras(records, frames)];
}
