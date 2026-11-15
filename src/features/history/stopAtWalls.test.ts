import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../core/i18n';
import type { Props, SbdRecord } from '../../core/model/record';
import type { LoggedOp } from '../../core/ops/ops';
import { changeLabel, changeValue, describeEdit, fieldChanges, lineText } from './summary';

// Stop at walls in History (6.18): one step in plain words, for a camera and for a light, in English and Spanish; the
// field named, never its prop.

const at = '2026-11-15T10:00:00.000Z';
const record = (id: string, props: Props): SbdRecord => ({ id, type: 'plan_item', parentId: 'own', sortKey: 'm', props, trashedAt: null, trashedBy: null, createdAt: at, updatedAt: at });
const op = (before: SbdRecord, after: SbdRecord): LoggedOp => ({ id: 'o', seq: 1, groupId: 'g', groupKind: 'edit', recordId: after.id, kind: 'update', before, after, author: 'local', timestamp: at });
const box = { x: 0, y: 0, width: 0.4, height: 0.4, rotation: 0 };
const camera = (props: Props = {}) => record('c', { kind: 'camera', icon: 'camera/camera', ...box, ...props });
const light = (props: Props = {}) => record('l', { kind: 'light', icon: 'lighting/fresnel', ...box, ...props });
const own = { id: 'own', type: 'plan', parentId: 'u1', sortKey: 'a', props: { kind: 'setup', name: '' }, trashedAt: null, trashedBy: null, createdAt: at, updatedAt: at } satisfies SbdRecord;
const tell = (ops: LoggedOp[]) => lineText(describeEdit(ops, new Set(), new Map([['own', own]])));

afterEach(() => {
  setLocale('en');
});

describe('History for Stop at walls (6.18)', () => {
  it('says a camera’s and a light’s switch turned off and on', () => {
    expect(tell([op(camera(), camera({ stop_at_walls: false }))])).toBe('Set a camera to go through walls');
    expect(tell([op(camera({ stop_at_walls: false }), camera())])).toBe('Set a camera to stop at walls');
    expect(tell([op(light(), light({ stop_at_walls: false }))])).toBe('Set a Fresnel to go through walls');
    expect(tell([op(light({ stop_at_walls: false }), light())])).toBe('Set a Fresnel to stop at walls');
  });

  it('names the field and its value', () => {
    const [change] = fieldChanges(camera(), camera({ stop_at_walls: false }));
    expect(change && changeLabel(change)).toBe('stops at walls');
    expect(change && changeValue(change, change.after)).toBe('Goes through walls');
  });

  it('says it in Spanish too', () => {
    setLocale('es');
    expect(tell([op(camera(), camera({ stop_at_walls: false }))])).toBe('Se hizo que una cámara atraviese las paredes');
    expect(tell([op(light({ stop_at_walls: false }), light())])).toBe('Se hizo que un Fresnel se detenga en las paredes');
  });
});
