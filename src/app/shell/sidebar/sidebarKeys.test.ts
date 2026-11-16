import { describe, expect, it } from 'vitest';
import type { Props, SbdRecord } from '../../../core/model/record';
import type { Change } from '../../../core/ops/ops';
import { keyBetween } from '../../../core/ops/order';
import { addNote, addScene } from '../../../features/storyboard/board';
import { addSceneChange, sceneEntries, sidebarSceneChanges } from './scenes';

// + Add Scene in the sidebar past a scene key keyBetween can't read (6.23 review, M2): it applies the new scene with the
// moves that keep it last, so SC 1 'b' and SC 2 '~' read 1, 2, 3; the single-create forms never return a key that is
// right only with moves they leave out.

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

/** The changes as the store would apply them: a create or a move. */
function applied(records: Records, changes: readonly Change[]): Records {
  const next: Records = { ...records };
  for (const change of changes) {
    if (change.kind === 'create') {
      const id = change.record.id;
      if (id) next[id] = { ...change.record, id, props: change.record.props ?? {}, trashedAt: null, trashedBy: null, createdAt: at, updatedAt: at };
    } else if (change.kind === 'move') {
      const was = next[change.id];
      if (!was) throw new Error(`no ${change.id}`);
      next[change.id] = { ...was, parentId: change.parentId, sortKey: change.sortKey };
    }
  }
  return next;
}

const ODD = '~';
const project = (second: string) =>
  recordsOf(record('p', 'project', null, { name: 'Odd' }), record('s1', 'scene', 'p', { number: '1', name: '' }, 'b'), record('s2', 'scene', 'p', { number: '2', name: '' }, second));
const numbers = (records: Records) => sceneEntries(records, 'p').map((s) => s.number);
const keysUnique = (records: Records, parentId: string) => {
  const keys = Object.values(records).filter((r) => r.parentId === parentId).map((r) => r.sortKey);
  return new Set(keys).size === keys.length;
};

describe('+ Add Scene in the sidebar past an odd key (6.23 review, M2)', () => {
  it('applies the new scene with its moves: 1, 2, 3', () => {
    const odd = project(ODD);
    const made = sidebarSceneChanges(odd, 'p');
    const after = applied(odd, made.changes);
    expect(numbers(after)).toEqual(['1', '2', '3']);
    expect(sceneEntries(after, 'p').at(-1)?.id).toBe(made.id);
    expect(keysUnique(after, 'p')).toBe(true);
  });

  it('a sound file’s sidebar edit is the one create it was', () => {
    const sound = project('d');
    const made = sidebarSceneChanges(sound, 'p');
    expect(made.changes).toHaveLength(1);
    expect(made.changes[0]).toMatchObject({ kind: 'create', record: { sortKey: keyBetween('d', null) } });
    expect(addSceneChange(sound, 'p').record.sortKey).toBe(keyBetween('d', null));
  });

  it('the single-create forms on an odd file take a key after the last readable one, right with no moves', () => {
    const odd = project(ODD);
    const scene = addScene(odd, 'p');
    expect(scene.record.sortKey).toBe(keyBetween('b', null));
    expect(keysUnique(applied(odd, [scene]), 'p')).toBe(true);
    // A note between frame A and frame B's odd key: after the scene's last readable key, no other record moved.
    const frames = { ...odd, a: record('a', 'shot', 's1', { number: '1A' }, 'b'), z: record('z', 'shot', 's1', { number: '1B' }, ODD) };
    const note = addNote(frames, 's1', 'a');
    expect(note.record.sortKey).toBe(keyBetween('b', null));
    expect(keysUnique(applied(frames, [note]), 's1')).toBe(true);
    // A sound file's: between its neighbours, as before.
    const sound = { ...project('d'), a: record('a', 'shot', 's1', { number: '1A' }, 'b'), z: record('z', 'shot', 's1', { number: '1B' }, 'd') };
    expect(addNote(sound, 's1', 'a').record.sortKey).toBe(keyBetween('b', 'd'));
  });
});
