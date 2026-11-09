import { describe, expect, it } from 'vitest';
import type { Approval } from './departmentStatus';
import type { Props, SbdRecord } from './record';
import { approvalBasis, approvalState, isCurrent, sceneApprovals, sceneApprovalText, withMySceneApproval, type ApprovalBasis } from './sceneApprovals';

// Approvals per scene (3.6b): who signed each department off, and whether the scene has changed since.

const at = '2026-11-09T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, sortKey = id, trashedAt: string | null = null): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey,
  props,
  trashedAt,
  trashedBy: null,
  createdAt: at,
  updatedAt: at,
});
const recordsOf = (...list: SbdRecord[]) => Object.fromEntries(list.map((r) => [r.id, r]));

describe('a scene’s approvals', () => {
  const director: Approval = { name: 'Kevin Matos', roles: ['director'], at };
  const dp: Approval = { name: 'Sam Reyes', roles: ['dp'], at };

  it('keeps each approver’s sign-off: the DP’s beside the director’s, and each takes back only their own', () => {
    let props: Props = { department_approvals: withMySceneApproval({}, 'camera', director, 'b1') ?? {} };
    props = { department_approvals: withMySceneApproval(props, 'camera', dp, 'b1') ?? {} };
    expect(sceneApprovals(props).camera).toMatchObject([{ ...director, basis: 'b1' }, { ...dp, basis: 'b1' }]);
    props = { department_approvals: withMySceneApproval(props, 'camera', { ...dp, at: 'later' }, 'b1') ?? {} };
    expect(sceneApprovals(props).camera).toMatchObject([director]);
    // Approvals go by role: a DP's tick is the DP's sign-off, whoever gave the one there (one DP on a shoot).
    const kevinBoth: Approval = { name: 'Kevin Matos', roles: ['director', 'dp'], at };
    const both: Props = { department_approvals: withMySceneApproval({}, 'art', kevinBoth, 'b1') ?? {} };
    expect(withMySceneApproval(both, 'art', dp, 'b1')).toBeNull();
    // The last one taken back leaves nothing to store.
    expect(withMySceneApproval(props, 'camera', director, 'b1')).toBeNull();
  });

  it('gives a changed approval again, now, rather than taking it back', () => {
    const props: Props = { department_approvals: withMySceneApproval({}, 'art', director, 'before') ?? {} };
    expect(approvalState(sceneApprovals(props).art ?? [], 'after')).toBe('changed');
    const again: Props = { department_approvals: withMySceneApproval(props, 'art', { ...director, at: 'later' }, 'after') ?? {} };
    expect(sceneApprovals(again).art).toMatchObject([{ at: 'later', basis: 'after' }]);
    expect(approvalState(sceneApprovals(again).art ?? [], 'after')).toBe('approved');
  });

  it('reads as changed when any sign-off was given before the change, and none without any', () => {
    const props: Props = { department_approvals: { sound: [{ ...director, basis: 'now' }, { ...dp, basis: 'then' }, { ...dp, basis: '' }] } };
    expect(approvalState(sceneApprovals(props).sound ?? [], 'now')).toBe('changed');
    expect(approvalState([], 'now')).toBe('none');
    // One with no fingerprint never reads as current.
    expect(approvalState([{ ...director, basis: '' }], '')).toBe('changed');
  });

  it('writes back what this version can’t read, other departments and other roles’ sign-offs alike', () => {
    const odd = { name: 'X', roles: ['producer'], at };
    const props: Props = { department_approvals: { camera: [odd], drone: 'later', art: [{ ...dp, basis: 'b' }] } };
    expect(withMySceneApproval(props, 'camera', director, 'b')).toEqual({
      camera: [odd, { name: 'Kevin Matos', roles: ['director'], at, basis: 'b' }],
      drone: 'later',
      art: [{ ...dp, basis: 'b' }],
    });
    expect(sceneApprovals(props).camera).toBeUndefined();
  });

  it('reads in History as who approved, without the fingerprint', () => {
    expect(sceneApprovalText([{ ...dp, basis: 'b' }])).toBe('approved by Sam Reyes (DP)');
    expect(sceneApprovalText(undefined)).toBe('—');
  });
});

describe('what a department touches in a scene', () => {
  const base = () =>
    recordsOf(
      record('s', 'scene', 'p', { number: '4', int_ext: 'INT' }),
      record('a', 'shot', 's', { number: '4A', lens_mm: 35, department_status: { camera: { done: true } } }, 'a'),
      record('b', 'shot', 's', { number: '4B' }, 'b'),
      record('n', 'note', 's', { text: 'Rain' }, 'c'),
      record('m', 'media', 'a', { kind: 'image', file: 'a'.repeat(64), source_path: 'one/a.jpg' }),
    );
  const basis = (records: Record<string, SbdRecord>, department = 'camera') => approvalBasis(records, 's', department).current;
  const withProps = (records: Record<string, SbdRecord>, id: string, props: Props) => {
    const r = records[id];
    if (!r) throw new Error(id);
    return { ...records, [id]: { ...r, props: { ...r.props, ...props } } };
  };

  it('changes for every department with the shared fields: picture, sketch, action, dialogue, size, lens, movement (3.15)', () => {
    const records = base();
    for (const department of ['camera', 'art', 'sound']) {
      const before = basis(records, department);
      const changes = [
        { lens_mm: 50 },
        { size: 'CU' },
        { move: 'pan' },
        { action: 'She runs' },
        { dialogue: 'Wait!' },
        { crop: { x: 0.2, y: 0.5, zoom: 1.5 } },
        { clip: { video_id: 'v', in_frame: 40, out_frame: 80 } },
        { location_id: 'barn' },
      ];
      for (const change of changes) {
        expect(basis(withProps(records, 'a', change), department)).not.toBe(before);
      }
      // Another picture stored under the same record: the stored file's sha256 is what counts.
      expect(basis(withProps(records, 'm', { file: 'b'.repeat(64) }), department)).not.toBe(before);
      expect(basis({ ...records, k: record('k', 'stroke', 'a', { points: [1, 2] }) }, department)).not.toBe(before);
      // Which frames the scene has, and in what order; and where and when it is.
      expect(basis({ ...records, c: record('c', 'shot', 's', { number: '4C' }) }, department)).not.toBe(before);
      expect(basis({ ...records, b: { ...(records.b as SbdRecord), sortKey: '0' } }, department)).not.toBe(before);
      for (const change of [{ name: 'DINER' }, { heading: 'INT. DINER' }, { int_ext: 'EXT' }, { day_night: 'NIGHT' }, { location_id: 'l' }]) {
        expect(basis(withProps(records, 's', change), department)).not.toBe(before);
      }
    }
  });

  it('changes for a department with its own notes and ticks only, never with another’s, Priority, Seen or the approvals', () => {
    const records = base();
    const before = basis(records);
    expect(basis(withProps(records, 'a', { department_status: { camera: { done: false } } }))).not.toBe(before);
    expect(basis(withProps(records, 'b', { department_status: { camera: { working: true } } }))).not.toBe(before);
    expect(basis(withProps(records, 'a', { department_status: { camera: { done: true, note: 'B unit' } } }))).not.toBe(before);
    // Another department's notes and ticks change its approval, not this one's.
    const artTicked = withProps(records, 'a', { department_status: { camera: { done: true }, art: { done: true, note: 'Swap the sign' } } });
    expect(basis(artTicked)).toBe(before);
    expect(basis(artTicked, 'art')).not.toBe(basis(records, 'art'));
    expect(basis(withProps(records, 'a', { department_status: { camera: { done: true, priority: true } } }))).toBe(before);
    // Only Priority, an empty entry, or a tick written off, is the same as none.
    expect(basis(withProps(records, 'b', { department_status: { camera: { priority: true } } }))).toBe(before);
    expect(basis(withProps(records, 'b', { department_status: { camera: {} } }))).toBe(before);
    expect(basis(withProps(records, 'b', { department_status: { camera: { done: false, working: false } } }))).toBe(before);
    expect(basis(withProps(records, 's', { department_approvals: { camera: [] } }))).toBe(before);
    // A picture moved or relinked is the same picture.
    expect(basis(withProps(records, 'm', { source_path: 'two/a.jpg' }))).toBe(before);
    // Undone, the scene reads as it did: the approval is current again.
    expect(basis(withProps(withProps(records, 'a', { lens_mm: 50 }), 'a', { lens_mm: 35 }))).toBe(before);
    // Each department has its own.
    expect(basis(records, 'art')).not.toBe(before);
  });

  it('changes no approval with what no department works from: T-stop, support, height, a title, custom fields, gear, a note card', () => {
    const records = base();
    const before = basis(records);
    for (const change of [{ t_stop: 2.8 }, { support: 'Dolly' }, { height: 'Low' }, { title: 'Her reaction' }, { custom: { Mood: 'Blue' } }, { gear_ids: ['g'] }, { shoot_day_id: 'd' }]) {
      expect(basis(withProps(records, 'a', change))).toBe(before);
    }
    expect(basis(withProps(records, 'n', { text: 'Snow' }))).toBe(before);
    for (const change of [{ number: '5' }, { page_eighths: 3 }, { character_ids: ['c'] }, { numbers_locked: true }]) {
      expect(basis(withProps(records, 's', change))).toBe(before);
    }
    expect(basis(withProps(records, 'a', { number: '4Z' }))).toBe(before);
    expect(basis(withProps(records, 'a', { status: 'have' }))).toBe(before);
  });

  it('keeps both rules’ fingerprints exactly: approvals already stored depend on them, so any change here is a bug', () => {
    const now = approvalBasis(base(), 's', 'camera');
    // 3.6b's, as v2 computed it before 3.15 (from the same records).
    expect(now.legacy).toBe('0022f03f4eb4b7');
    // 3.15's, as stored from here on.
    expect(now.current).toBe('2:148ee4eebe8262');
  });

  it('never works out 3.6b’s fingerprint for an approval made by 3.15’s rule', () => {
    const basis: ApprovalBasis = {
      current: '2:x',
      get legacy(): string {
        throw new Error('legacy read');
      },
    };
    const fresh = { name: 'Sam Reyes', roles: ['dp' as const], at, basis: '2:x' };
    expect(isCurrent(fresh, basis)).toBe(true);
    expect(approvalState([fresh], basis)).toBe('approved');
  });

  it('reads an approval given before 3.15 by the rule it was given under, and a new one by the new rule', () => {
    const records = base();
    const now = approvalBasis(records, 's', 'camera');
    expect(now.current.startsWith('2:')).toBe(true);
    const old = { name: 'Sam Reyes', roles: ['dp' as const], at, basis: now.legacy };
    const fresh = { ...old, basis: now.current };
    expect(approvalState([old], now)).toBe('approved');
    expect(approvalState([fresh], now)).toBe('approved');
    // A T-stop changed: under 3.6b's rule every field counted, so the old one reads as changed; the new one doesn't.
    const changed = approvalBasis(withProps(records, 'a', { t_stop: 4 }), 's', 'camera');
    expect(approvalState([old], changed)).toBe('changed');
    expect(approvalState([fresh], changed)).toBe('approved');
    // Given again, it keeps the new rule's fingerprint.
    const props = { department_approvals: withMySceneApproval({}, 'camera', old, changed) ?? {} };
    expect(sceneApprovals(props).camera?.[0]?.basis).toBe(changed.current);
  });

  it('leaves out a frame in the Trash, and keeps the frames that went to the Trash with their scene', () => {
    const records = base();
    const before = basis(records);
    expect(basis({ ...records, b: { ...(records.b as SbdRecord), trashedAt: at } })).not.toBe(before);
    expect(basis({ ...records, x: record('x', 'shot', 's', { number: '4X' }, 'x', at) })).toBe(before);
    const trashed = Object.fromEntries(
      Object.entries(records).map(([id, r]) => [id, ['s', 'a', 'b', 'n'].includes(id) ? { ...r, trashedAt: at } : r]),
    );
    expect(basis(trashed)).toBe(before);
    expect(approvalBasis(records, 'nothing', 'camera')).toEqual({ current: '', legacy: '' });
  });
});
