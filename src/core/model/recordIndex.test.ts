import { afterEach, describe, expect, it, vi } from 'vitest';
import { scenesOf } from '../../app/shell/sidebar/scenes';
import { roomUnderlays } from '../../features/birdseye/plan/underlayEdits';
import { boardsOf } from '../../features/moodboards/boards';
import { projectGear } from './gear';
import { blockingPlansOf, itemsOfPlan, planFields, plansShown, sceneRoomId, scenesUsingRoom, setupPlanOf, shownFields, underlayFields } from './plan';
import { byPositionOrder, cameraMarks, ownerMarks, type MarkOwner } from './planBlocking';
import type { Props, SbdRecord } from './record';
import { childrenOf, keptFor, recordsOfType, recordsTypeIndexed } from './recordIndex';
import { framesWithoutSetup, frameSetupId, sceneHasFrames, sceneSetups, setupFields, setupFrames } from './setup';
import { projectShootDays } from './shootDay';

// 6.21: an edit must not cost a scan of every record per tile. The readers the tiles call on every edit read from an
// index kept per records object: each gives exactly what it gave before (the old bodies are kept here as the reference),
// reads the records whole at most once however often it is asked, and reads a new records object (after an edit) anew.

type Records = Readonly<Record<string, SbdRecord>>;

const at = '2026-11-15T10:00:00.000Z';
const later = '2026-11-15T11:00:00.000Z';
const gone = '2026-11-15T12:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, sortKey = id, trashedAt: string | null = null, createdAt = at): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey,
  props,
  trashedAt,
  trashedBy: trashedAt === null ? null : 'me',
  createdAt,
  updatedAt: createdAt,
});
const recordsOf = (...list: SbdRecord[]): Records => Object.fromEntries(list.map((r) => [r.id, r]));
const box = (x = 0, y = 0) => ({ x, y, width: 1, height: 1, rotation: 0 });

/**
 * A project with what each reader must tell apart: live and trashed scenes, setups (one tied on its sort key, one in the
 * Trash, one in another scene), frames (live, trashed, in no setup, naming a setup of another scene or one in the
 * Trash, two tied on their sort key), a room shared by two scenes, two blocking plans, setup plans (one in the Trash),
 * items in the room, the blocking and a setup's plan (one of a kind this version doesn't know, one trashed), marks of a
 * character and of a camera (one in another scene's plan), gear, days, boards, and strokes that are none of these.
 */
function project(): Records {
  return recordsOf(
    record('p', 'project', null, {}),
    record('stroke-1', 'stroke', 'f1', {}),
    record('room1', 'plan', 'p', { kind: 'room', name: 'Diner' }),
    record('room2', 'plan', 'p', { kind: 'room', name: 'Old' }, 'b', gone),
    record('s1', 'scene', 'p', { number: '1', room_id: 'room1' }, 'b'),
    record('s2', 'scene', 'p', { number: '2', room_id: 'room1' }, 'a'),
    record('s3', 'scene', 'p', { number: '3', room_id: 'room1' }, 'c', gone),
    record('s4', 'scene', 'p', { number: '4' }, 'b'),
    record('su1', 'setup', 's1', { name: 'Window' }, 'b'),
    record('su2', 'setup', 's1', { name: '' }, 'a'),
    record('su2b', 'setup', 's1', { name: 'Tie' }, 'a'),
    record('su3', 'setup', 's1', { name: '' }, 'c', gone),
    record('su4', 'setup', 's2', { name: '' }, 'a'),
    record('su5', 'setup', 's3', { name: '' }, 'a'),
    record('stroke-2', 'stroke', 'f2', {}),
    record('pb1', 'plan', 's1', { kind: 'blocking', name: '' }, 'a', null, later),
    record('pb2', 'plan', 's1', { kind: 'blocking', name: '' }, 'a', null, at),
    record('pb3', 'plan', 's1', { kind: 'blocking', name: '' }, '0', gone),
    record('ps1', 'plan', 'su1', { kind: 'setup', name: '' }),
    record('ps1t', 'plan', 'su1', { kind: 'setup', name: '' }, '0', gone),
    record('ps3', 'plan', 'su3', { kind: 'setup', name: '' }),
    record('ps4', 'plan', 'su4', { kind: 'setup', name: '' }),
    record('f1', 'shot', 's1', { number: '1A', setup_id: 'su1' }, 'b'),
    record('f2', 'shot', 's1', { number: '1B', setup_id: 'su2' }, 'a'),
    record('f3', 'shot', 's1', { number: '1C', setup_id: 'su1' }, 'c', gone),
    record('f4', 'shot', 's1', { number: '1D' }, 'd'),
    record('f5', 'shot', 's2', { number: '2A', setup_id: 'su1' }, 'a'),
    record('f6', 'shot', 's1', { number: '1E', setup_id: 'su3' }, 'b'),
    record('f7', 'shot', 's1', { number: '1F', setup_id: 'su1' }, 'b'),
    record('f8', 'shot', 's3', { number: '3A', setup_id: 'su5' }, 'a'),
    record('w1', 'plan_item', 'room1', { kind: 'wall', ...box(), width: 4, height: 0.1 }, 'b'),
    record('sofa', 'plan_item', 'room1', { kind: 'icon', icon: 'set-art/sofa', ...box(1, 1) }, 'a'),
    record('u1', 'plan_item', 'room1', { kind: 'underlay', ...box(), width: 8, height: 6 }, 'a'),
    record('u2', 'plan_item', 'room1', { kind: 'underlay', ...box(), width: 8, height: 6 }, 'c', gone),
    record('old', 'plan_item', 'room1', { kind: 'icon', icon: 'set-art/table', ...box() }, '0', gone),
    record('cam1', 'plan_item', 'ps1', { kind: 'camera', icon: 'camera/camera', ...box() }, 'a'),
    record('l1', 'plan_item', 'ps1', { kind: 'light', icon: 'lighting/fresnel', ...box(2, 0) }, 'b'),
    record('future', 'plan_item', 'ps1', { kind: 'hologram', ...box() }, 'c'),
    record('m4', 'plan_item', 'ps1', { kind: 'mark', icon: 'cast/tape-mark', ...box(), camera_id: 'cam1', order: 'b' }, 'd'),
    record('m5', 'plan_item', 'ps1', { kind: 'mark', icon: 'cast/tape-mark', ...box(), camera_id: 'cam1', order: 'a' }, 'e'),
    record('m5t', 'plan_item', 'ps1', { kind: 'mark', icon: 'cast/tape-mark', ...box(), camera_id: 'cam1', order: '0' }, 'f', gone),
    record('m6', 'plan_item', 'ps4', { kind: 'mark', icon: 'cast/tape-mark', ...box(), camera_id: 'cam1' }, 'a'),
    record('m7', 'plan_item', 'ps3', { kind: 'mark', icon: 'cast/tape-mark', ...box(), camera_id: 'cam1' }, 'a'),
    record('c1', 'character', 'p', { name: 'Ana' }),
    record('m1', 'plan_item', 'pb1', { kind: 'mark', icon: 'cast/cast-mark', ...box(), character_id: 'c1', order: 'b' }, 'a'),
    record('m2', 'plan_item', 'pb2', { kind: 'mark', icon: 'cast/cast-mark', ...box(), character_id: 'c1', order: 'a' }, 'b'),
    record('m3', 'plan_item', 'pb1', { kind: 'mark', icon: 'cast/cast-mark', ...box(), character_id: 'c1', order: 'c' }, 'c', gone),
    record('m8', 'plan_item', 'pb1', { kind: 'mark', icon: 'cast/cast-mark', ...box(), character_id: 7 }, 'd'),
    record('g1', 'gear_item', 'p', { name: 'Fresnel', department: 'grip-electric' }),
    record('g2', 'gear_item', 'p', { name: 'Old', department: 'camera' }, 'g2', gone),
    record('g3', 'gear_item', 'p', { name: 'Body', department: 'camera' }),
    record('d1', 'shoot_day', 'p', { date: '2026-11-17' }),
    record('d2', 'shoot_day', 'p', { date: '2026-11-16' }),
    record('d3', 'shoot_day', 'p', { date: '' }),
    record('d4', 'shoot_day', 'p', { date: '2026-11-15' }, 'd4', gone),
    record('b1', 'board', 'p', { name: 'Look' }, 'b'),
    record('b2', 'board', 'p', { name: 'Gone' }, 'a', gone),
    record('b3', 'board', 'p', { name: 'Tie' }, 'b'),
    record('stroke-3', 'stroke', 'f4', {}),
  );
}

// The readers as they were before 6.21, word for word: the reference.

const setupOrder = (a: SbdRecord, b: SbdRecord) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0);
const planOrder = (a: SbdRecord, b: SbdRecord) =>
  a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const itemOrder = (a: SbdRecord, b: SbdRecord) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const old = {
  allSetups: (records: Records, sceneId: string) =>
    Object.values(records)
      .filter((r) => r.type === 'setup' && r.parentId === sceneId)
      .sort(setupOrder),
  sceneSetups: (records: Records, sceneId: string) =>
    old
      .allSetups(records, sceneId)
      .filter((r) => r.trashedAt === null)
      .map((record, i) => ({ record, fields: setupFields(record.props), number: i + 1 })),
  sceneFrames: (records: Records, sceneId: string) =>
    Object.values(records)
      .filter((r) => r.type === 'shot' && r.parentId === sceneId && r.trashedAt === null)
      .sort(setupOrder),
  setupFrames: (records: Records, setupId: string) => {
    const setup = records[setupId];
    const live = setup?.type === 'setup' && setup.trashedAt === null ? setup : null;
    if (!live?.parentId) return [];
    return old.sceneFrames(records, live.parentId).filter((shot) => frameSetupId(records, shot) === setupId);
  },
  framesWithoutSetup: (records: Records, sceneId: string) => old.sceneFrames(records, sceneId).filter((shot) => frameSetupId(records, shot) === null),
  plansUnder: (records: Records, parentId: string, kind: string) =>
    Object.values(records)
      .filter((r) => r.type === 'plan' && r.parentId === parentId && r.trashedAt === null && planFields(r.props)?.kind === kind)
      .sort(planOrder),
  itemsOfPlan: (records: Records, planId: string, withTrashed = false) =>
    Object.values(records)
      .filter((r) => r.type === 'plan_item' && r.parentId === planId && (withTrashed || r.trashedAt === null) && shownFields(r.props) !== null)
      .sort(itemOrder),
  scenesUsingRoom: (records: Records, roomId: string) => Object.values(records).filter((r) => r.type === 'scene' && r.trashedAt === null && sceneRoomId(records, r) === roomId),
  scenePlanIds: (records: Records, sceneId: string) => {
    const setups = new Set(Object.values(records).flatMap((r) => (r.type === 'setup' && r.parentId === sceneId ? [r.id] : [])));
    return new Set(
      Object.values(records).flatMap((r) => {
        if (r.type !== 'plan' || r.parentId === null) return [];
        const kind = planFields(r.props)?.kind;
        return (kind === 'blocking' && r.parentId === sceneId) || (kind === 'setup' && setups.has(r.parentId)) ? [r.id] : [];
      }),
    );
  },
  ownerMarks: (records: Records, sceneId: string, owner: MarkOwner) => {
    const plans = old.scenePlanIds(records, sceneId);
    const prop = owner.kind === 'character' ? 'character_id' : 'camera_id';
    return Object.values(records).filter((r) => r.type === 'plan_item' && r.props.kind === 'mark' && r.parentId !== null && plans.has(r.parentId) && r.props[prop] === owner.id);
  },
  cameraMarks: (records: Records, cameraId: string) => {
    const camera = records[cameraId];
    if (!camera) return [];
    return Object.values(records)
      .filter((r) => r.type === 'plan_item' && r.trashedAt === null && r.parentId === camera.parentId && r.props.kind === 'mark' && r.props.camera_id === cameraId)
      .sort(byPositionOrder);
  },
  scenesOf: (records: Records, projectId: string) =>
    Object.values(records)
      .filter((r) => r.type === 'scene' && r.parentId === projectId && r.trashedAt === null)
      .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0)),
  roomUnderlays: (records: Records, roomId: string | null) => {
    if (roomId === null) return [];
    return Object.values(records)
      .filter((r) => r.type === 'plan_item' && r.parentId === roomId && r.trashedAt === null && underlayFields(r.props) !== null)
      .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  },
};

const ids = (list: readonly { id: string }[]) => list.map((r) => r.id);
const SCENES = ['s1', 's2', 's3', 's4', 'nothing'];
const SETUPS = ['su1', 'su2', 'su2b', 'su3', 'su4', 'su5', 'nothing'];
const PLANS = ['room1', 'room2', 'pb1', 'pb2', 'pb3', 'ps1', 'ps1t', 'ps3', 'ps4', 'nothing'];
const OWNERS: MarkOwner[] = [
  { kind: 'character', id: 'c1' },
  { kind: 'camera', id: 'cam1' },
  { kind: 'character', id: 'nobody' },
];

/** How many times a run read these records whole (Object.values on them), as gearOnDay.test.ts counts it. */
function scansOf(records: Records, run: () => void): number {
  const values = vi.spyOn(Object, 'values');
  try {
    run();
    return values.mock.calls.filter(([read]) => read === records).length;
  } finally {
    values.mockRestore();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the readers from the index give what they gave before (6.21)', () => {
  it('setups by scene, live frames by scene, a setup’s frames and the frames in none', () => {
    const records = project();
    for (const scene of SCENES) {
      expect(sceneSetups(records, scene), scene).toEqual(old.sceneSetups(records, scene));
      expect(ids(framesWithoutSetup(records, scene)), scene).toEqual(ids(old.framesWithoutSetup(records, scene)));
      expect(sceneHasFrames(records, scene), scene).toBe(Object.values(records).some((r) => r.type === 'shot' && r.parentId === scene && r.trashedAt === null));
    }
    for (const setup of SETUPS) expect(ids(setupFrames(records, setup)), setup).toEqual(ids(old.setupFrames(records, setup)));
    // The ties keep the order they had: su2 and su2b share a key, as do f1, f6 and f7.
    expect(sceneSetups(records, 's1').map((s) => s.record.id)).toEqual(['su2', 'su2b', 'su1']);
    expect(ids(setupFrames(records, 'su1'))).toEqual(['f1', 'f7']);
  });

  it('plans under a parent, a plan’s items, the scenes in a room', () => {
    const records = project();
    for (const scene of SCENES) expect(ids(blockingPlansOf(records, scene)), scene).toEqual(ids(old.plansUnder(records, scene, 'blocking')));
    for (const setup of SETUPS) expect(setupPlanOf(records, setup)?.id ?? null, setup).toBe(old.plansUnder(records, setup, 'setup')[0]?.id ?? null);
    for (const plan of PLANS) {
      expect(ids(itemsOfPlan(records, plan)), plan).toEqual(ids(old.itemsOfPlan(records, plan)));
      expect(ids(itemsOfPlan(records, plan, true)), plan).toEqual(ids(old.itemsOfPlan(records, plan, true)));
      expect(ids(scenesUsingRoom(records, plan)), plan).toEqual(ids(old.scenesUsingRoom(records, plan)));
      expect(ids(roomUnderlays(records, plan)), plan).toEqual(ids(old.roomUnderlays(records, plan)));
    }
    expect(ids(blockingPlansOf(records, 's1'))).toEqual(['pb2', 'pb1']);
    expect(ids(itemsOfPlan(records, 'ps1'))).toEqual(['cam1', 'l1', 'm4', 'm5']);
    // A view's plans, as the old readers gave them: the room, the blocking plans, the setup's own (a live setup of the scene only).
    for (const scene of SCENES) {
      for (const setup of [...SETUPS, null]) {
        const s = records[scene];
        const su = setup === null ? undefined : records[setup];
        const liveScene = s?.type === 'scene' && s.trashedAt === null;
        const own = su?.type === 'setup' && su.trashedAt === null && su.parentId === scene ? su : null;
        const blockings = liveScene ? old.plansUnder(records, scene, 'blocking') : [];
        const roomId = sceneRoomId(records, s);
        const want = liveScene
          ? { room: roomId === null ? null : (records[roomId] ?? null), blocking: blockings[0] ?? null, setup: own ? (old.plansUnder(records, own.id, 'setup')[0] ?? null) : null, blockings }
          : { room: null, blocking: null, setup: null, blockings: [] };
        expect(plansShown(records, scene, setup), `${scene} ${String(setup)}`).toEqual(want);
      }
    }
  });

  it('marks by owner in a scene and a camera’s marks', () => {
    const records = project();
    for (const scene of SCENES) for (const owner of OWNERS) expect(ids(ownerMarks(records, scene, owner)), `${scene} ${owner.id}`).toEqual(ids(old.ownerMarks(records, scene, owner)));
    for (const camera of ['cam1', 'l1', 'nothing']) expect(ids(cameraMarks(records, camera)), camera).toEqual(ids(old.cameraMarks(records, camera)));
    expect(ids(ownerMarks(records, 's1', { kind: 'camera', id: 'cam1' }))).toEqual(['m4', 'm5', 'm5t', 'm7']);
    expect(ids(cameraMarks(records, 'cam1'))).toEqual(['m5', 'm4']);
  });

  it('the project’s scenes and the room’s underlays from the records by type', () => {
    const records = project();
    expect(ids(scenesOf(records, 'p'))).toEqual(ids(old.scenesOf(records, 'p')));
    expect(ids(boardsOf(records, 'p'))).toEqual(['b1', 'b3']);
    expect(ids(boardsOf(records, 'p', true))).toEqual(['b2', 'b1', 'b3']);
    expect(projectShootDays(records, 'p').map((d) => [d.record.id, d.number])).toEqual([
      ['d2', 1],
      ['d1', 2],
      ['d3', 3],
    ]);
    expect(projectGear(records, 'p').map((g) => g.record.id)).toEqual(['g3', 'g1']);
  });

  it('hands each caller a list of its own: changing one never changes what the next reads', () => {
    const records = project();
    const first = setupFrames(records, 'su1');
    first.pop();
    expect(ids(setupFrames(records, 'su1'))).toEqual(['f1', 'f7']);
    const items = itemsOfPlan(records, 'ps1');
    items.reverse();
    expect(ids(itemsOfPlan(records, 'ps1'))).toEqual(['cam1', 'l1', 'm4', 'm5']);
    const setups = sceneSetups(records, 's1');
    setups.length = 0;
    expect(sceneSetups(records, 's1')).toHaveLength(3);
    const plans = blockingPlansOf(records, 's1');
    plans.length = 0;
    expect(ids(blockingPlansOf(records, 's1'))).toEqual(['pb2', 'pb1']);
    const marks = cameraMarks(records, 'cam1');
    marks.length = 0;
    expect(ids(cameraMarks(records, 'cam1'))).toEqual(['m5', 'm4']);
  });
});

describe('the readers read the records whole at most once per records object (6.21)', () => {
  const each: [string, (records: Records) => unknown][] = [
    ['sceneSetups', (r) => SCENES.map((s) => sceneSetups(r, s))],
    ['setupFrames', (r) => SETUPS.map((s) => setupFrames(r, s))],
    ['framesWithoutSetup', (r) => SCENES.map((s) => framesWithoutSetup(r, s))],
    ['sceneHasFrames', (r) => SCENES.map((s) => sceneHasFrames(r, s))],
    ['itemsOfPlan', (r) => PLANS.map((p) => [itemsOfPlan(r, p), itemsOfPlan(r, p, true)])],
    ['scenesUsingRoom', (r) => PLANS.map((p) => scenesUsingRoom(r, p))],
    ['ownerMarks', (r) => SCENES.flatMap((s) => OWNERS.map((o) => ownerMarks(r, s, o)))],
    ['cameraMarks', (r) => ['cam1', 'l1', 'nothing'].map((c) => cameraMarks(r, c))],
    ['scenesOf', (r) => scenesOf(r, 'p')],
    ['boardsOf', (r) => boardsOf(r, 'p')],
    ['projectShootDays', (r) => projectShootDays(r, 'p')],
    ['projectGear', (r) => projectGear(r, 'p')],
    ['roomUnderlays', (r) => PLANS.map((p) => roomUnderlays(r, p))],
  ];
  for (const [name, read] of each) {
    it(`${name}: twenty readings, one scan`, () => {
      const records = project();
      expect(
        scansOf(records, () => {
          for (let i = 0; i < 20; i += 1) read(records);
        }),
      ).toBeLessThanOrEqual(1);
    });
  }

  it('plans under a parent: each parent and kind read once, however often it is asked', () => {
    const records = project();
    const once = scansOf(records, () => setupPlanOf(records, 'su1'));
    expect(once).toBe(1);
    expect(
      scansOf(records, () => {
        for (let i = 0; i < 20; i += 1) {
          setupPlanOf(records, 'su1');
          blockingPlansOf(records, 's1');
        }
      }),
    ).toBe(1);
  });

  it('indexes by type once per records object', () => {
    const records = project();
    const before = recordsTypeIndexed();
    for (let i = 0; i < 5; i += 1) {
      recordsOfType(records, 'shot');
      childrenOf(records, 's1', 'setup');
    }
    expect(recordsTypeIndexed() - before).toBe(1);
    expect(keptFor(records, 'test.kept', () => ({ made: 1 }))).toBe(keptFor(records, 'test.kept', () => ({ made: 2 })));
  });
});

describe('a new records object is read anew (6.21)', () => {
  it('gives what the edit made, never what the last records held', () => {
    const records = project();
    // Read everything once, so every index of these records is made.
    expect(sceneSetups(records, 's1')).toHaveLength(3);
    expect(ids(setupFrames(records, 'su1'))).toEqual(['f1', 'f7']);
    expect(ids(itemsOfPlan(records, 'ps1'))).toEqual(['cam1', 'l1', 'm4', 'm5']);
    expect(ids(cameraMarks(records, 'cam1'))).toEqual(['m5', 'm4']);
    expect(setupPlanOf(records, 'su2')).toBeNull();
    expect(ids(scenesUsingRoom(records, 'room1'))).toEqual(['s1', 's2']);
    // An edit: a setup trashed, a frame joining su1, a light put in ps1, a mark trashed, a plan made for su2, a scene leaving the room.
    const su2 = records['su2'] as SbdRecord;
    const f4 = records['f4'] as SbdRecord;
    const m4 = records['m4'] as SbdRecord;
    const s2 = records['s2'] as SbdRecord;
    const edited: Records = {
      ...records,
      su2: { ...su2, trashedAt: gone },
      f4: { ...f4, props: { ...f4.props, setup_id: 'su1' } },
      l2: record('l2', 'plan_item', 'ps1', { kind: 'light', icon: 'lighting/fresnel', ...box() }, '0'),
      m4: { ...m4, trashedAt: gone },
      ps2: record('ps2', 'plan', 'su2b', { kind: 'setup', name: '' }),
      s2: { ...s2, props: { number: '2' } },
    };
    expect(sceneSetups(edited, 's1').map((s) => s.record.id)).toEqual(['su2b', 'su1']);
    expect(ids(setupFrames(edited, 'su1'))).toEqual(['f1', 'f7', 'f4']);
    expect(ids(itemsOfPlan(edited, 'ps1'))).toEqual(['l2', 'cam1', 'l1', 'm5']);
    expect(ids(cameraMarks(edited, 'cam1'))).toEqual(['m5']);
    expect(setupPlanOf(edited, 'su2b')?.id).toBe('ps2');
    expect(ids(scenesUsingRoom(edited, 'room1'))).toEqual(['s1']);
    // And the old records still read as they were.
    expect(sceneSetups(records, 's1')).toHaveLength(3);
    expect(ids(setupFrames(records, 'su1'))).toEqual(['f1', 'f7']);
    // Each agrees with the old readers on the edited records too.
    for (const scene of SCENES) expect(sceneSetups(edited, scene), scene).toEqual(old.sceneSetups(edited, scene));
    for (const setup of SETUPS) expect(ids(setupFrames(edited, setup)), setup).toEqual(ids(old.setupFrames(edited, setup)));
    for (const plan of PLANS) expect(ids(itemsOfPlan(edited, plan)), plan).toEqual(ids(old.itemsOfPlan(edited, plan)));
  });
});
