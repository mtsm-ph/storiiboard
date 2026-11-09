import { describe, expect, it } from 'vitest';
import type { SbdRecord } from '../../core/model/record';
import { departmentCounts, departmentFrames, departmentPeople } from './departmentView';

// A department's view of a scene (3.6a): its frames with this department's states, Seen included, counted; and its
// people. Read from the records, never stored.

const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: SbdRecord['props'], trashedAt: string | null = null): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey: id,
  props,
  trashedAt,
  trashedBy: null,
  createdAt: '2026-11-08T12:00:00.000Z',
  updatedAt: '2026-11-08T12:00:00.000Z',
});

const records = {
  p: record('p', 'project', null, {}),
  s1: record('s1', 'scene', 'p', { number: '4' }),
  a: record('a', 'shot', 's1', { number: '4A', department_status: { camera: { priority: true, done: true }, sound: { working: true } } }),
  b: record('b', 'shot', 's1', { number: '4B', department_status: { camera: { approvals: [{ name: 'Kevin Matos', roles: ['dp'], at: 'x' }] } } }),
  c: record('c', 'shot', 's1', { number: '4C' }),
  gone: record('gone', 'shot', 's1', { number: '4D', department_status: { camera: { priority: true } } }, '2026-11-08T13:00:00.000Z'),
  s2: record('s2', 'scene', 'p', { number: '5' }, '2026-11-08T13:00:00.000Z'),
  x: record('x', 'shot', 's2', { number: '5A' }),
  kevin: record('kevin', 'person', 'p', { name: 'Kevin Matos', role: 'dp', departments: ['camera', 'grip-electric'] }),
  ana: record('ana', 'person', 'p', { name: 'Ana Ruiz', role: 'other', departments: ['camera'] }),
  sam: record('sam', 'person', 'p', { name: 'Sam Ortiz', role: 'gaffer', departments: ['grip-electric'] }),
  left: record('left', 'person', 'p', { name: 'Lee', departments: ['camera'] }, '2026-11-08T13:00:00.000Z'),
};

describe('a department’s view of a scene', () => {
  it('lists the scene’s live frames in board order, each with this department’s states, Seen included', () => {
    const frames = departmentFrames(records, 's1', 'camera', { c: ['camera', 'sound'], a: ['sound'] });
    expect(frames.map((f) => [f.shot.fields.number, f.states])).toEqual([
      ['4A', ['priority', 'done']],
      // A frame's own approvals from before schema 9 count for nothing here: approvals are the scene's (3.6b).
      ['4B', []],
      ['4C', ['seen']],
    ]);
    // Another department reads its own row of the same frames.
    expect(departmentFrames(records, 's1', 'sound', { a: ['sound'] }).map((f) => f.states)).toEqual([['seen', 'working'], [], []]);
  });

  it('has no frames for no scene, a scene in the Trash, or a record that isn’t a scene', () => {
    expect(departmentFrames(records, null, 'camera', {})).toEqual([]);
    expect(departmentFrames(records, 's2', 'camera', {})).toEqual([]);
    expect(departmentFrames(records, 'a', 'camera', {})).toEqual([]);
    expect(departmentFrames(records, 'nowhere', 'camera', {})).toEqual([]);
  });

  it('counts the frames in each state, leaving out states none are in', () => {
    const frames = departmentFrames(records, 's1', 'camera', { c: ['camera'] });
    expect(departmentCounts(frames)).toEqual([
      { state: 'priority', count: 1 },
      { state: 'seen', count: 1 },
      { state: 'done', count: 1 },
    ]);
    expect(departmentCounts([])).toEqual([]);
  });

  it('names the department’s live people by name, someone in two departments in both', () => {
    expect(departmentPeople(records, 'p', 'camera').map((p) => p.fields.name)).toEqual(['Ana Ruiz', 'Kevin Matos']);
    expect(departmentPeople(records, 'p', 'grip-electric').map((p) => p.fields.name)).toEqual(['Kevin Matos', 'Sam Ortiz']);
    expect(departmentPeople(records, 'p', 'hmu')).toEqual([]);
  });
});
