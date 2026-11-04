import { mediaFields } from '../../core/media/store';
import type { SbdRecord } from '../../core/model/record';
import { sceneFields, sceneLabel, shotFields } from '../../core/model/storyboard';
import type { Change } from '../../core/ops/ops';
import { restoreShot } from '../storyboard/board';
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

export interface TrashItem {
  id: string;
  kind: TrashKind;
  /** What it was, as the board names it: `1A`, `SC 04 INT. DINER — NIGHT`, a note's first words, a picture's file. */
  name: string;
  /** Technical names (shot and scene numbers) are set in mono. */
  mono: boolean;
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

function nameOf(records: Records, record: SbdRecord, kind: TrashKind): { name: string; mono: boolean } {
  switch (kind) {
    case 'scene': {
      const fields = sceneFields(record.props);
      return { name: `${sceneLabel(fields.number)}  ${headingOf(fields)}`, mono: false };
    }
    case 'frame':
      return { name: shotFields(record.props).number || 'Unnumbered frame', mono: true };
    case 'note': {
      const text = typeof record.props.text === 'string' ? record.props.text.trim().replace(/\s+/g, ' ') : '';
      return { name: text === '' ? 'Empty note' : text.length > 60 ? `${text.slice(0, 59)}…` : text, mono: false };
    }
    case 'picture': {
      const file = mediaFields(record.props)?.sourceName ?? '';
      const parent = record.parentId ? records[record.parentId] : undefined;
      const of = parent?.type === 'shot' ? ` of ${shotFields(parent.props).number}` : ' (logo or key image)';
      return { name: `${file || 'Pasted picture'}${of}`, mono: false };
    }
  }
}

/** Everything in the project's Trash, the most recently deleted first. */
export function trashItems(records: Records, projectId: string): TrashItem[] {
  const items: TrashItem[] = [];
  for (const record of Object.values(records)) {
    if (record.trashedAt === null) continue;
    const kind = kindOf(record);
    if (!kind) continue;
    const scene = sceneOf(records, record);
    // Only this project's records (a file holds one project, but the check is cheap and keeps the list honest).
    let top: SbdRecord | undefined = record;
    while (top?.parentId) top = records[top.parentId];
    if (top?.id !== projectId) continue;
    items.push({
      id: record.id,
      kind,
      ...nameOf(records, record, kind),
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
      return [...(parent?.type === 'scene' && parent.trashedAt !== null ? [{ kind: 'restore' as const, id: parent.id }] : []), { kind: 'restore', id }];
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
    default:
      return [{ kind: 'restore', id }];
  }
}
