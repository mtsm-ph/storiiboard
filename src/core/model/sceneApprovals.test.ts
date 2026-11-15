import { describe, expect, it } from 'vitest';
import type { Approval } from './departmentStatus';
import type { Props, SbdRecord } from './record';
import { approvalBasis, approvalsKeptThrough, approvalState, isCurrent, sceneApprovals, sceneApprovalSummary, sceneApprovalText, withMySceneApproval, type ApprovalBasis } from './sceneApprovals';

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

  it('changes camera’s and grip-electric’s with T-stop, support and height, and no other department’s (3.18)', () => {
    const records = base();
    for (const change of [{ t_stop: 2.8 }, { support: 'Dolly' }, { height: 'Low' }]) {
      const changed = withProps(records, 'a', change);
      for (const department of ['camera', 'grip-electric']) expect(basis(changed, department)).not.toBe(basis(records, department));
      for (const department of ['art', 'sound', 'hmu']) expect(basis(changed, department)).toBe(basis(records, department));
    }
  });

  it('changes every department’s with the scene’s characters (3.18)', () => {
    const records = base();
    for (const department of ['camera', 'art', 'sound', 'wardrobe']) {
      const before = basis(records, department);
      expect(basis(withProps(records, 's', { character_ids: ['c'] }), department)).not.toBe(before);
      expect(basis(withProps(records, 's', { characters: [42] }), department)).not.toBe(before);
      // The same characters in another order are another cast list as the scene shows it.
      const two = withProps(records, 's', { character_ids: ['c', 'd'] });
      expect(basis(withProps(two, 's', { character_ids: ['d', 'c'] }), department)).not.toBe(basis(two, department));
    }
  });

  it('changes no approval with what no department works from: a title, custom fields, gear, the day, a note card', () => {
    const records = base();
    for (const department of ['camera', 'grip-electric', 'art']) {
      const before = basis(records, department);
      for (const change of [{ title: 'Her reaction' }, { custom: { Mood: 'Blue' } }, { gear_ids: ['g'] }, { shoot_day_id: 'd' }]) {
        expect(basis(withProps(records, 'a', change), department)).toBe(before);
      }
      expect(basis(withProps(records, 'n', { text: 'Snow' }), department)).toBe(before);
      for (const change of [{ number: '5' }, { page_eighths: 3 }, { numbers_locked: true }]) {
        expect(basis(withProps(records, 's', change), department)).toBe(before);
      }
      expect(basis(withProps(records, 'a', { number: '4Z' }), department)).toBe(before);
      expect(basis(withProps(records, 'a', { status: 'have' }), department)).toBe(before);
    }
  });

  it('keeps every rule’s fingerprint exactly: approvals already stored depend on them, so any change here is a bug', () => {
    const now = approvalBasis(base(), 's', 'camera');
    // 3.6b's, as v2 computed it before 3.15 (from the same records).
    expect(now.legacy).toBe('0022f03f4eb4b7');
    // 3.15's, as stored until 3.18.
    expect(now.v2).toBe('2:148ee4eebe8262');
    // 3.18's, as stored from here on; with a cast and a rig, for a department the rig counts for and one it doesn't.
    expect(now.current).toBe('3:098c62161d39c6');
    const scene = base().s as SbdRecord;
    const frame = base().a as SbdRecord;
    const full = {
      ...base(),
      s: { ...scene, props: { ...scene.props, character_ids: ['mary', 'tom'], characters: [42] } },
      a: { ...frame, props: { ...frame.props, t_stop: 2.8, support: 'dolly', height: 'low' } },
    };
    expect(approvalBasis(full, 's', 'camera').current).toBe('3:02b67c02a3f0b8');
    expect(approvalBasis(full, 's', 'art').current).toBe('3:12d3d80e546e54');
  });

  it('reads an approval by the rule it was given under, so a change of rule turns none “Changed” (3.18)', () => {
    const records = base();
    const now = approvalBasis(records, 's', 'camera');
    const sign = (basis: string) => [{ name: 'Sam Reyes', roles: ['dp' as const], at, basis }];
    const old = sign(now.legacy);
    const v2 = sign(now.v2);
    const fresh = sign(now.current);
    for (const given of [old, v2, fresh]) expect(approvalState(given, now)).toBe('approved');
    // A T-stop: 3.6b counted every field, 3.18 counts it for camera; 3.15 didn't, so its approval stays current.
    const stop = approvalBasis(withProps(records, 'a', { t_stop: 4 }), 's', 'camera');
    expect([old, v2, fresh].map((given) => approvalState(given, stop))).toEqual(['changed', 'approved', 'changed']);
    // The scene's characters: 3.6b and 3.18 read them, 3.15 didn't.
    const cast = approvalBasis(withProps(records, 's', { character_ids: ['c'] }), 's', 'camera');
    expect([old, v2, fresh].map((given) => approvalState(given, cast))).toEqual(['changed', 'approved', 'changed']);
    // Lens counts under every rule.
    const lens = approvalBasis(withProps(records, 'a', { lens_mm: 85 }), 's', 'camera');
    expect([old, v2, fresh].map((given) => approvalState(given, lens))).toEqual(['changed', 'changed', 'changed']);
    // A rule this version doesn't know reads as changed; approving again writes 3.18's.
    expect(approvalState(sign('4:x'), now)).toBe('changed');
    const props = { department_approvals: withMySceneApproval({ department_approvals: { camera: v2 } }, 'camera', { name: 'Sam Reyes', roles: ['dp'], at }, lens) ?? {} };
    expect(sceneApprovals(props).camera?.[0]?.basis).toBe(lens.current);
  });

  it('keeps a 3.6b approval current when only a Phase 6 link is set: a frame’s lens or setup, a scene’s room', () => {
    const records = base();
    const old = [{ name: 'Sam Reyes', roles: ['dp' as const], at, basis: approvalBasis(records, 's', 'camera').legacy }];
    for (const [id, change] of [
      ['a', { lens_id: 'cooke-35' }],
      ['a', { setup_id: 'su1' }],
      ['s', { room_id: 'room1' }],
    ] as const) {
      expect(approvalState(old, approvalBasis(withProps(records, id, change), 's', 'camera')), JSON.stringify(change)).toBe('approved');
    }
    // The focal length still counts.
    expect(approvalState(old, approvalBasis(withProps(records, 'a', { lens_id: 'cooke-35', lens_mm: 50 }), 's', 'camera'))).toBe('changed');
  });

  it('re-stamps through an upgrade only the approvals that were current before it, each by its own rule', () => {
    const scene = base().s as SbdRecord;
    // Before the upgrade: a script's names on the scene.
    const plain = { ...base(), s: { ...scene, props: { ...scene.props, characters: ['MARY'] } } };
    const then = (department: string) => approvalBasis(plain, 's', department);
    const sign = (basis: string, roles: ('dp' | 'director')[] = ['dp']) => ({ name: 'Sam Reyes', roles, at, basis });
    const approvals = {
      camera: [sign(then('camera').legacy), sign('stale', ['director'])],
      art: [sign(then('art').current)],
      sound: [sign(then('sound').v2)],
      drone: 'later',
    };
    const was = { ...plain, s: { ...scene, props: { ...scene.props, characters: ['MARY'], department_approvals: approvals } } };
    // The upgrade: the names become ids.
    const after = { ...was, s: { ...scene, props: { ...scene.props, character_ids: ['mary'], department_approvals: approvals } } };
    const kept = approvalsKeptThrough(was, after, 's');
    expect(kept).toBeDefined();
    const restamped = { ...after, s: { ...scene, props: { ...scene.props, character_ids: ['mary'], department_approvals: kept ?? {} } } };
    const state = (department: string) => approvalState(sceneApprovals(restamped.s.props)[department] ?? [], approvalBasis(restamped, 's', department));
    // The director's was changed before the upgrade, so camera stays changed; the DP's alone is re-stamped.
    expect(kept?.camera).toEqual([sign(approvalBasis(after, 's', 'camera').legacy), sign('stale', ['director'])]);
    expect(state('camera')).toBe('changed');
    expect(state('art')).toBe('approved');
    // 3.15's doesn't read characters: nothing to re-stamp.
    expect(kept?.sound).toEqual(approvals.sound);
    expect(state('sound')).toBe('approved');
    expect(kept?.drone).toBe('later');
    // Nothing a rule reads changed: nothing to do.
    expect(approvalsKeptThrough(was, was, 's')).toBeUndefined();
  });

  it('counts a scene’s departments approved and changed since, for its heading (3.16)', () => {
    const records = base();
    const now = (department: string) => approvalBasis(records, 's', department).current;
    const sign = (basis: string) => [{ name: 'Sam Reyes', roles: ['dp'], at, basis }];
    const scene = { ...(records.s as SbdRecord), props: { ...(records.s as SbdRecord).props, department_approvals: { camera: sign(now('camera')), art: sign(now('art')), sound: sign('2:stale') } } };
    expect(sceneApprovalSummary({ ...records, s: scene }, 's')).toEqual({ approved: 2, changed: 1 });
    expect(sceneApprovalSummary(records, 's')).toEqual({ approved: 0, changed: 0 });
    // One current and one stale sign-off on a department: changed. A department this version doesn't show: not counted.
    // A focus view: your departments alone.
    const mixed = { ...scene, props: { ...scene.props, department_approvals: { camera: [...sign(now('camera')), { name: 'Kevin Matos', roles: ['director'], at, basis: '2:stale' }], drone: sign('2:x') } } };
    expect(sceneApprovalSummary({ ...records, s: mixed }, 's')).toEqual({ approved: 0, changed: 1 });
    expect(sceneApprovalSummary({ ...records, s: scene }, 's', ['camera', 'sound'])).toEqual({ approved: 1, changed: 1 });
  });

  it('never works out an older rule’s fingerprint for an approval made by a newer one', () => {
    const basis: ApprovalBasis = {
      current: '3:x',
      get v2(): string {
        throw new Error('v2 read');
      },
      get legacy(): string {
        throw new Error('legacy read');
      },
    };
    const fresh = { name: 'Sam Reyes', roles: ['dp' as const], at, basis: '3:x' };
    expect(isCurrent(fresh, basis)).toBe(true);
    expect(approvalState([fresh], basis)).toBe('approved');
    // A 3.15 approval reads 3.15's alone.
    const v2: ApprovalBasis = { current: '3:x', v2: '2:y', get legacy(): string { throw new Error('legacy read'); } };
    expect(isCurrent({ ...fresh, basis: '2:y' }, v2)).toBe(true);
  });

  it('gives an approval again with the newest rule’s fingerprint', () => {
    const records = base();
    const now = approvalBasis(records, 's', 'camera');
    expect(now.current.startsWith('3:')).toBe(true);
    const old = { name: 'Sam Reyes', roles: ['dp' as const], at, basis: now.legacy };
    const changed = approvalBasis(withProps(records, 'a', { lens_mm: 85 }), 's', 'camera');
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
    expect(approvalBasis(records, 'nothing', 'camera')).toEqual({ current: '', v2: '', legacy: '' });
  });
});
