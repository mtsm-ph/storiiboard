import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Props, SbdRecord } from '../../core/model/record';
import type { Change } from '../../core/ops/ops';
import { keyBetween } from '../../core/ops/order';
import { addNote, addNoteChanges, addScene, addSceneChanges, addShots, board, moveItem, setSceneLocation } from './board';
import { setPicture } from './framePictures';

// The storyboard's writes past a sort key keyBetween can't read (6.23, Kevin: "an unreadable one from an odd imported file
// never makes it throw"): a frame, note or scene put between two stored keys keeps the order asked for, the scene's
// items (or the project's scenes) written afresh in the same group; a sound file's keys are keyBetween's, as before.

type Records = Record<string, SbdRecord>;

const at = '2026-11-16T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, sortKey = id): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey,
  props,
  trashedAt: null,
  trashedBy: null,
  createdAt: at,
  updatedAt: at,
});
const recordsOf = (...list: SbdRecord[]): Records => Object.fromEntries(list.map((r) => [r.id, r]));

/** The changes as the store would apply them: a create, an update or a move. */
function applied(records: Records, changes: readonly Change[]): Records {
  const next: Records = { ...records };
  for (const change of changes) {
    if (change.kind === 'create') {
      const id = change.record.id;
      if (id) next[id] = { ...change.record, id, props: change.record.props ?? {}, trashedAt: null, trashedBy: null, createdAt: at, updatedAt: at };
    } else if (change.kind === 'update') {
      const was = next[change.id];
      if (!was) throw new Error(`no ${change.id}`);
      const gone = new Set(change.unset ?? []);
      next[change.id] = { ...was, props: Object.fromEntries(Object.entries({ ...was.props, ...(change.set ?? {}) }).filter(([key]) => !gone.has(key))) };
    } else if (change.kind === 'move') {
      const was = next[change.id];
      if (!was) throw new Error(`no ${change.id}`);
      next[change.id] = { ...was, parentId: change.parentId, sortKey: change.sortKey };
    }
  }
  return next;
}

const ODD = '~';

/** Scene 1 with frames A, B and C (C's key odd when asked) and scene 2 with one frame. */
const project = (cKey = 'f', s2Key = 's') =>
  recordsOf(
    record('p', 'project', null, { name: 'Odd' }),
    record('s1', 'scene', 'p', { number: '1', name: '' }, 'b'),
    record('s2', 'scene', 'p', { number: '2', name: '' }, s2Key),
    record('a', 'shot', 's1', { number: '1A', status: 'need' }, 'b'),
    record('bb', 'shot', 's1', { number: '1B', status: 'need' }, 'd'),
    record('c', 'shot', 's1', { number: '1C', status: 'need' }, cKey),
    record('x', 'shot', 's2', { number: '2A', status: 'need' }, 'b'),
  );

/** A scene's frames and notes as the board shows them. */
const items = (records: Records, sceneId: string): string[] =>
  board(records, 'p')
    .find((s) => s.record.id === sceneId)
    ?.items.map((i) => (i.kind === 'shot' ? i.shot.record.id : i.note.record.id)) ?? [];
const scenes = (records: Records): string[] => board(records, 'p').map((s) => s.record.id);
const unique = (records: Records, parentId: string) => {
  const keys = Object.values(records).filter((r) => r.parentId === parentId).map((r) => r.sortKey);
  return new Set(keys).size === keys.length;
};

describe('the storyboard past a key that can’t be read (6.23)', () => {
  it('reorders a frame past an odd key in the order asked for, the numbers following', () => {
    const odd = project(ODD);
    expect(items(odd, 's1')).toEqual(['a', 'bb', 'c']);
    // A to the end, after C's odd key.
    const last = applied(odd, moveItem(odd, 'p', 'a', 's1', null));
    expect(items(last, 's1')).toEqual(['bb', 'c', 'a']);
    expect(unique(last, 's1')).toBe(true);
    expect(['bb', 'c', 'a'].map((id) => last[id]?.props.number)).toEqual(['1A', '1B', '1C']);
    // C before B: between A's key and B's, sound, so it takes one key there.
    const earlier = applied(odd, moveItem(odd, 'p', 'c', 's1', 'bb'));
    expect(items(earlier, 's1')).toEqual(['a', 'c', 'bb']);
    // Into scene 1 from scene 2, at the end.
    const across = applied(odd, moveItem(odd, 'p', 'x', 's1', null));
    expect(items(across, 's1')).toEqual(['a', 'bb', 'c', 'x']);
    expect(items(across, 's2')).toEqual([]);
  });

  it('adds frames and a note after an odd key in the order asked for', () => {
    const odd = project(ODD);
    const made = addShots(odd, 'p', 's1', 'c', [{}, {}]);
    const after = applied(odd, made.changes);
    expect(items(after, 's1')).toEqual(['a', 'bb', 'c', ...made.shotIds]);
    expect(unique(after, 's1')).toBe(true);
    expect(['a', 'bb', 'c', ...made.shotIds].map((id) => after[id]?.props.number)).toEqual(['1A', '1B', '1C', '1D', '1E']);
    const note = addNoteChanges(odd, 's1', 'c', 'Wide first');
    expect(items(applied(odd, note.changes), 's1')).toEqual(['a', 'bb', 'c', note.id]);
    // addNote alone never throws either.
    expect(() => addNote(odd, 's1', 'c')).not.toThrow();
  });

  it('adds a scene after an odd scene key in the order asked for; a sound board’s key as before', () => {
    const odd = project('f', ODD);
    // Right after scene 1, before scene 2's odd key: no key between them, so the scenes are written afresh.
    const made = addSceneChanges(odd, 'p', 's1');
    expect(made.changes.filter((c) => c.kind === 'move').length).toBeGreaterThan(0);
    const after = applied(odd, made.changes);
    expect(scenes(after)).toEqual(['s1', made.id, 's2']);
    expect(unique(after, 'p')).toBe(true);
    const end = addSceneChanges(odd, 'p');
    expect(scenes(applied(odd, end.changes))).toEqual(['s1', 's2', end.id]);
    expect(() => addScene(odd, 'p')).not.toThrow();
    const sound = project();
    expect(addScene(sound, 'p').record.sortKey).toBe(keyBetween('s', null));
    expect(addSceneChanges(sound, 'p').changes).toHaveLength(1);
  });

  it('a sound board’s keys are keyBetween’s of the same inputs', () => {
    const sound = project();
    const move = moveItem(sound, 'p', 'a', 's1', null);
    expect(move[0]).toEqual({ kind: 'move', id: 'a', parentId: 's1', sortKey: keyBetween('f', null) });
    expect(move.filter((c) => c.kind === 'move')).toHaveLength(1);
    const between = moveItem(sound, 'p', 'c', 's1', 'bb');
    expect(between[0]).toEqual({ kind: 'move', id: 'c', parentId: 's1', sortKey: keyBetween('b', 'd') });
    const made = addShots(sound, 'p', 's1', 'a', [{}, {}]);
    const first = keyBetween('b', 'd');
    expect(made.changes.flatMap((c) => (c.kind === 'create' ? [c.record.sortKey] : []))).toEqual([first, keyBetween(first, 'd')]);
    expect(made.changes.filter((c) => c.kind === 'move')).toHaveLength(0);
    expect(addNote(sound, 's1', 'bb').record.sortKey).toBe(keyBetween('d', 'f'));
  });

  it('a frame’s new picture goes after its pictures’ last readable key; a sound frame’s key as before', () => {
    const bytes = new Uint8Array(300).map((_, i) => (i * 7) % 256);
    const picture = {
      image: {
        original: { sha256: createHash('sha256').update(bytes).digest('hex'), bytes, mime: 'image/png' as const, width: 800, height: 450, colorSpace: 'srgb' as const },
        thumbnail: { bytes: bytes.slice(0, 100), mime: 'image/jpeg' as const, width: 640, height: 360, longEdge: 640 },
      },
      source: { name: 'still.png' },
    };
    const keyOf = (records: Records) => {
      const made = setPicture(records, 'a', picture, '/Films/Odd.sbd').changes[0];
      return made?.kind === 'create' ? made.record.sortKey : null;
    };
    const old = (sortKey: string) => record(`m${sortKey}`, 'media', 'a', { kind: 'picture' }, sortKey);
    expect(keyOf({ ...project(), mb: old('b'), mo: old(ODD) })).toBe(keyBetween('b', null));
    expect(keyOf({ ...project(), mb: old('b'), md: old('d') })).toBe(keyBetween('d', null));
  });

  it('a new location for a scene goes after the last readable key', () => {
    const odd = { ...project(), l1: record('l1', 'location', 'p', { name: 'Diner' }, 'b'), l2: record('l2', 'location', 'p', { name: 'Motel' }, ODD) };
    const changes = setSceneLocation(odd, 'p', 's1', 'Gas station');
    const made = changes[0];
    expect(made?.kind === 'create' ? made.record.sortKey : null).toBe(keyBetween('b', null));
  });
});
