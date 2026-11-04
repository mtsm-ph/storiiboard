import { mediaFields } from '../../core/media/store';
import type { SbdRecord } from '../../core/model/record';
import { sceneFields, sceneLabel, shotFields } from '../../core/model/storyboard';
import type { Change } from '../../core/ops/ops';
import { restoredScene, restoreShot } from '../storyboard/board';
import { headingOf } from '../storyboard/ScenesView';

// The Trash (1.20, CLAUDE.md): what's been deleted (frames, scenes, notes and pictures), kept until Empty Trash
// (1.21), each restorable with one click. Never mixed with an archived project, which is the project's `state`.
// Sketch strokes the eraser took aren't listed: they're part of a frame's sketch, and undo brings them back.

type Records = Readonly<Record<string, SbdRecord>>;

export type TrashKind = 'scene' | 'frame' | 'note' | 'picture';

export const TRASH_KIND_LABEL: Readonly<Record<TrashKind, string>> = {
  scene: 'Scene',
  frame: 'Frame',
  note: 'Note',
  picture: 'Picture',
};

export interface NamePart {
  text: string;
  mono: boolean;
}

export interface TrashItem {
  id: string;
  kind: TrashKind;
  /** What it was, as the board names it: `1A`, `SC 04 INT. DINER — NIGHT`, a note's first words, a picture's file. */
  name: string;
  /** The name in pieces, the shot and scene numbers in it marked to be set in mono. */
  parts: readonly NamePart[];
  /** The scene it belongs to, for the filter, and how that reads: `SC 04`. Null for the project's own image. */
  sceneId: string | null;
  sceneName: string | null;
  /** When it went to the Trash (ISO). */
  trashedAt: string;
}

/** The scene a record sits in: itself for a scene, its parent for a frame or a note, its frame's for a picture. */
function sceneOf(records: Records, record: SbdRecord): SbdRecord | null {
  let at: SbdRecord | undefined = record;
  for (let depth = 0; at && depth < 4; depth += 1) {
    if (at.type === 'scene') return at;
    at = at.parentId ? records[at.parentId] : undefined;
  }
  return null;
}

function kindOf(record: SbdRecord): TrashKind | null {
  if (record.type === 'scene') return 'scene';
  if (record.type === 'shot') return 'frame';
  if (record.type === 'note') return 'note';
  if (record.type === 'media') return 'picture';
  return null;
}

const mono = (text: string): NamePart => ({ text, mono: true });
const plain = (text: string): NamePart => ({ text, mono: false });

function partsOf(records: Records, record: SbdRecord, kind: TrashKind): NamePart[] {
  switch (kind) {
    case 'scene': {
      const fields = sceneFields(record.props);
      return [mono(sceneLabel(fields.number)), plain(`  ${headingOf(fields)}`)];
    }
    case 'frame': {
      const number = shotFields(record.props).number;
      return [number ? mono(number) : plain('Unnumbered frame')];
    }
    case 'note': {
      const text = typeof record.props.text === 'string' ? record.props.text.trim().replace(/\s+/g, ' ') : '';
      return [plain(text === '' ? 'Empty note' : text.length > 60 ? `${text.slice(0, 59)}…` : text)];
    }
    case 'picture': {
      const file = plain(mediaFields(record.props)?.sourceName || 'Pasted picture');
      const parent = record.parentId ? records[record.parentId] : undefined;
      return parent?.type === 'shot' ? [file, plain(' of '), mono(shotFields(parent.props).number)] : [file, plain(' (logo or key image)')];
    }
  }
}

/** Whether a record went to the Trash with its parent, in the same op group (a scene's frames and notes). */
function trashedWithParent(records: Records, record: SbdRecord): boolean {
  const parent = record.parentId ? records[record.parentId] : undefined;
  return parent !== undefined && parent.trashedAt !== null && parent.trashedAt === record.trashedAt && parent.trashedBy === record.trashedBy;
}

/** A scene's frames and notes that went to the Trash with it. */
function trashedWith(records: Records, scene: SbdRecord): SbdRecord[] {
  return Object.values(records).filter((r) => r.parentId === scene.id && (r.type === 'shot' || r.type === 'note') && trashedWithParent(records, r));
}

/** Everything in the project's Trash, the most recently deleted first; a scene's frames deleted with it are in its row. */
export function trashItems(records: Records, projectId: string): TrashItem[] {
  const items: TrashItem[] = [];
  for (const record of Object.values(records)) {
    if (record.trashedAt === null) continue;
    const kind = kindOf(record);
    if (!kind || (record.type !== 'scene' && record.type !== 'media' && trashedWithParent(records, record))) continue;
    const scene = sceneOf(records, record);
    // Only this project's records (a file holds one project, but the check is cheap and keeps the list honest).
    let top: SbdRecord | undefined = record;
    while (top?.parentId) top = records[top.parentId];
    if (top?.id !== projectId) continue;
    const inside = kind === 'scene' ? trashedWith(records, record).filter((r) => r.type === 'shot').length : 0;
    const parts = [...partsOf(records, record, kind), ...(inside > 0 ? [plain(` (with ${String(inside)} ${inside === 1 ? 'frame' : 'frames'})`)] : [])];
    items.push({
      id: record.id,
      kind,
      name: parts.map((p) => p.text).join(''),
      parts,
      sceneId: scene?.id ?? null,
      sceneName: scene ? sceneLabel(sceneFields(scene.props).number) : null,
      trashedAt: record.trashedAt,
    });
  }
  return items.sort((a, b) => (a.trashedAt < b.trashedAt ? 1 : a.trashedAt > b.trashedAt ? -1 : a.id.localeCompare(b.id)));
}

/**
 * The op group that brings one item back, with what it needs to be seen again:
 * - a frame or a note comes back with its scene, if that's in the Trash too; a frame's scene renumbers unless locked;
 * - a frame's picture comes back with its frame, as the frame's picture again, and the one it has now goes to the
 *   Trash in its place, so nothing is lost and undo swaps them back;
 * - the project's logo or key image comes back on its own; Settings → Theme makes it the theme's image again.
 */
export function restoreChanges(records: Records, projectId: string, id: string): Change[] {
  const record = records[id];
  if (!record || record.trashedAt === null) return [];
  const parent = record.parentId ? records[record.parentId] : undefined;
  switch (record.type) {
    case 'shot':
      return restoreShot(records, projectId, id);
    case 'note':
      return parent?.type === 'scene' ? restoredScene(records, projectId, parent.id, [id]) : [{ kind: 'restore', id }];
    case 'media': {
      if (parent?.type !== 'shot') return [{ kind: 'restore', id }];
      const current = shotFields(parent.props).mediaId;
      const showing = current ? records[current] : undefined;
      return [
        ...(parent.trashedAt !== null ? restoreShot(records, projectId, parent.id) : []),
        { kind: 'restore', id },
        { kind: 'update', id: parent.id, set: { media_id: id }, unset: ['crop'] },
        ...(showing && showing.id !== id && showing.trashedAt === null ? [{ kind: 'trash' as const, id: showing.id }] : []),
      ];
    }
    case 'scene':
      // With the frames and notes deleted with it (docs/SBD_FORMAT.md, Trash), not ones deleted before.
      // With a new number if a live scene has taken its own; its frames are numbered the board's way.
      return restoredScene(records, projectId, id, trashedWith(records, record).map((r) => r.id));
    default:
      return [{ kind: 'restore', id }];
  }
}
