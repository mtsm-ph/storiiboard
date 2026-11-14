import { describe, expect, it } from 'vitest';
import { planLensDiffers, runChecks } from '../checks';
import type { Change } from '../ops/ops';
import { callSheetFingerprint } from '../../features/callsheets/fingerprint';
import { cameraLooks } from '../../features/birdseye/plan/cameraLooks';
import { moveItem } from '../../features/storyboard/board';
import { callSheet } from './callsheet';
import { cameraFields, setupPlanOf, shownItems } from './plan';
import {
  assignFrameChanges,
  cameraBody,
  cameraBodyChanges,
  cameraCone,
  cameraFrames,
  cameraHeight,
  cameraLens,
  cameraLensMmChanges,
  cameraLensRefusal,
  cameraOnSideChanges,
  cameraTitle,
  frameCamera,
  framesDiffering,
  linkFrameChanges,
  pickCameraLensChanges,
  setupReadingsMade,
  showFrameChanges,
  shownFrame,
  takeFrameLensChanges,
  unlinkFrameChanges,
  withoutFrameLinks,
} from './planCamera';
import { copySetupChanges } from './planRooms';
import type { Props, SbdRecord } from './record';
import { approvalBasis } from './sceneApprovals';
import { joinSetup, leaveSetup, newSetupFromFrames } from './setup';

// A camera on a setup's plan (6.4): which frames it shoots (one reader, every stale link read as none), the frame whose
// lens it draws, its body, its lens and height, the cone's numbers through fieldOfView from records (Kevin's three
// values), live from the board with no edit to the plan; linking, unlinking and showing as op lists; copies that drop
// the links; the lens check; and approvals and an issued call sheet untouched by any of it.

type Records = Record<string, SbdRecord>;

const at = '2026-11-14T10:00:00.000Z';
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
const recordsOf = (...list: SbdRecord[]): Records => Object.fromEntries(list.map((r) => [r.id, r]));
const camera = (id: string, props: Props = {}, sortKey = id) =>
  record(id, 'plan_item', 'own', { kind: 'camera', icon: 'camera/camera', x: 0, y: 0, width: 0.4, height: 0.4, rotation: 0, ...props }, sortKey);

/** The changes applied to a copy of the records, as the store would write them. */
function applied(records: Records, changes: readonly Change[]): Records {
  const next: Records = { ...records };
  for (const change of changes) {
    if (change.kind === 'create') {
      const id = change.record.id;
      if (id) next[id] = { ...change.record, id, props: change.record.props ?? {}, trashedAt: null, trashedBy: null, createdAt: at, updatedAt: at };
    }
    else if (change.kind === 'update') {
      const was = next[change.id];
      if (!was) continue;
      const gone = new Set(change.unset ?? []);
      const props: Props = Object.fromEntries(Object.entries({ ...was.props, ...(change.set ?? {}) }).filter(([key]) => !gone.has(key)));
      next[change.id] = { ...was, props };
    } else if (change.kind === 'trash') {
      const was = next[change.id];
      if (was) next[change.id] = { ...was, trashedAt: at };
    } else if (change.kind === 'restore') {
      const was = next[change.id];
      if (was) next[change.id] = { ...was, trashedAt: null };
    } else if (change.kind === 'move') {
      const was = next[change.id];
      if (was) next[change.id] = { ...was, parentId: change.parentId, sortKey: change.sortKey };
    }
  }
  return next;
}

/** A project shot on a 35.6 × 20.0 mm mode at 2.39:1: Setup 1 with frames 1A (50 mm on a 2× zoom) and 1B (24 mm), and a camera listing them. */
const base = (cameraProps: Props = { shot_ids: ['a', 'b'] }, aspect = '2.39:1'): Records =>
  recordsOf(
    record('p', 'project', null, { name: 'Bey County', aspect_ratio: aspect }),
    record('fx3', 'gear_item', 'p', { name: 'FX3', kind: 'camera_body', sensor_width_mm: 35.6, sensor_height_mm: 20, camera_letter: 'A' }),
    record('ana', 'gear_item', 'p', { name: 'Optimo', kind: 'lens', focal_min_mm: 30, focal_max_mm: 72, squeeze: 2 }),
    record('p24', 'gear_item', 'p', { name: 'Cooke', kind: 'lens', focal_min_mm: 24, focal_max_mm: 24 }),
    record('s1', 'scene', 'p', { number: '1' }),
    record('u1', 'setup', 's1', { name: '' }, 'a'),
    record('u2', 'setup', 's1', { name: '' }, 'b'),
    record('own', 'plan', 'u1', { kind: 'setup', name: '' }),
    record('a', 'shot', 's1', { number: '1A', setup_id: 'u1', lens_mm: 50, lens_id: 'ana' }, 'a'),
    record('b', 'shot', 's1', { number: '1B', setup_id: 'u1', lens_mm: 24, lens_id: 'p24' }, 'b'),
    record('c', 'shot', 's1', { number: '1C', setup_id: 'u2', lens_mm: 35 }, 'c'),
    record('gone', 'shot', 's1', { number: '1D', setup_id: 'u1' }, 'd', at),
    camera('cam', cameraProps),
  );

describe('which frames a camera shoots', () => {
  it('counts only live frames of its own setup, in board order; a trashed, missing or other setup’s frame reads as not linked', () => {
    const records = base({ shot_ids: ['b', 'c', 'gone', 'nowhere', 'a'] });
    expect(cameraFrames(records, 'cam').map((s) => s.id)).toEqual(['a', 'b']);
    // A frame taken out of the setup, or its scene's setup in the Trash, isn't linked; the camera keeps its ids.
    const out = applied(records, [{ kind: 'update', id: 'a', unset: ['setup_id'] }]);
    expect(cameraFrames(out, 'cam').map((s) => s.id)).toEqual(['b']);
    expect(cameraFields(out.cam?.props ?? {})?.shotIds).toEqual(['b', 'c', 'gone', 'nowhere', 'a']);
    const setupGone = applied(records, [{ kind: 'trash', id: 'u1' }]);
    expect(cameraFrames(setupGone, 'cam')).toEqual([]);
  });

  it('gives a frame to one camera: the first of its setup, in plan order, that lists it', () => {
    const records = { ...base({ shot_ids: ['a', 'b'] }), cam2: camera('cam2', { shot_ids: ['b'] }, 'z') };
    expect(frameCamera(records, 'b')).toBe('cam');
    expect(cameraFrames(records, 'cam2')).toEqual([]);
    // Linking it to the other takes it from the first, in the same group.
    const changes = linkFrameChanges(records, 'cam2', 'b');
    expect(changes).toEqual([{ kind: 'update', id: 'cam', set: { shot_ids: ['a'] } }]);
    const moved = applied(records, changes);
    expect(frameCamera(moved, 'b')).toBe('cam2');
    expect(cameraFrames(moved, 'cam').map((s) => s.id)).toEqual(['a']);
    // A frame of another setup, or one in the Trash, can't be linked.
    expect(linkFrameChanges(records, 'cam', 'c')).toEqual([]);
    expect(linkFrameChanges(records, 'cam', 'gone')).toEqual([]);
  });

  it('links, unlinks and shows as one op each; unlinking the shown frame takes the mark off', () => {
    const records = base({ shot_ids: ['a'] });
    expect(linkFrameChanges(records, 'cam', 'b')).toEqual([{ kind: 'update', id: 'cam', set: { shot_ids: ['a', 'b'] } }]);
    expect(linkFrameChanges(records, 'cam', 'a')).toEqual([]);
    const both = applied(records, linkFrameChanges(records, 'cam', 'b'));
    expect(showFrameChanges(both, 'cam', 'b')).toEqual([{ kind: 'update', id: 'cam', set: { shown_shot_id: 'b' } }]);
    // The first linked frame is shown already, with nothing stored.
    expect(showFrameChanges(both, 'cam', 'a')).toEqual([]);
    const shown = applied(both, showFrameChanges(both, 'cam', 'b'));
    expect(unlinkFrameChanges(shown, 'cam', 'b')).toEqual([{ kind: 'update', id: 'cam', set: { shot_ids: ['a'] }, unset: ['shown_shot_id'] }]);
    expect(unlinkFrameChanges(shown, 'cam', 'c')).toEqual([]);
    // The Frames tile's choice: a camera, or none.
    expect(assignFrameChanges(shown, 'a', null)).toEqual([{ kind: 'update', id: 'cam', set: { shot_ids: ['b'] } }]);
    expect(assignFrameChanges(records, 'b', 'cam')).toEqual([{ kind: 'update', id: 'cam', set: { shot_ids: ['a', 'b'] } }]);
    // The last one out leaves no list behind.
    expect(unlinkFrameChanges(records, 'cam', 'a')).toEqual([{ kind: 'update', id: 'cam', unset: ['shot_ids'] }]);
  });

  it('draws the shown frame: `shown_shot_id` when linked, else the first linked frame in board order', () => {
    expect(shownFrame(base(), 'cam')?.id).toBe('a');
    expect(shownFrame(base({ shot_ids: ['a', 'b'], shown_shot_id: 'b' }), 'cam')?.id).toBe('b');
    expect(shownFrame(base({ shot_ids: ['a', 'b'], shown_shot_id: 'c' }), 'cam')?.id).toBe('a');
    expect(shownFrame(base({ shot_ids: ['a', 'b'], shown_shot_id: 'gone' }), 'cam')?.id).toBe('a');
    expect(shownFrame(base({}), 'cam')).toBeNull();
  });
});

describe('a camera’s body, lens and height', () => {
  it('is the project’s default body unless it names a live one', () => {
    const records: Records = { ...base(), fx6: record('fx6', 'gear_item', 'p', { name: 'FX6', kind: 'camera_body', sensor_width_mm: 35.7, sensor_height_mm: 18.8, camera_letter: 'B' }) };
    expect(cameraBody(records, records.cam as SbdRecord)).toMatchObject({ isDefault: true, record: { id: 'fx3' } });
    const named = applied(records, cameraBodyChanges(records, 'cam', 'fx6'));
    expect(cameraBody(named, named.cam as SbdRecord)).toMatchObject({ isDefault: false, record: { id: 'fx6' } });
    // Its body in the Trash: the default body again, the id kept.
    const trashed = applied(named, [{ kind: 'trash', id: 'fx6' }]);
    expect(cameraBody(trashed, trashed.cam as SbdRecord)).toMatchObject({ isDefault: true, record: { id: 'fx3' } });
    expect(cameraFields(trashed.cam?.props ?? {})?.bodyId).toBe('fx6');
    expect(cameraBodyChanges(named, 'cam', null)).toEqual([{ kind: 'update', id: 'cam', unset: ['body_id'] }]);
    // Not a body: refused.
    expect(cameraBodyChanges(records, 'cam', 'ana')).toEqual([]);
  });

  it('takes its lens from the shown frame, else the one typed on it, and its height from the frame’s when the frame has one', () => {
    const records = base();
    expect(cameraLens(records, 'cam')).toMatchObject({ from: 'frame', mm: 50, squeeze: 2 });
    const frameless = base({ lens_mm: 35, height_m: 1.5 });
    expect(cameraLens(frameless, 'cam')).toMatchObject({ from: 'camera', mm: 35, squeeze: 1 });
    expect(cameraHeight(frameless, 'cam')).toEqual({ from: 'camera', metres: 1.5 });
    const withHeight = applied(base({ shot_ids: ['a'], height_m: 1.5 }), [{ kind: 'update', id: 'a', set: { height: 'eye' } }]);
    expect(cameraHeight(withHeight, 'cam')).toMatchObject({ from: 'frame', value: 'eye' });
  });

  it('refuses a typed focal length outside its picked lens, and picks a lens as a frame does', () => {
    const records = base({});
    expect(pickCameraLensChanges(records, 'cam', 'ana')).toEqual([{ kind: 'update', id: 'cam', set: { lens_id: 'ana', lens_mm: 30 } }]);
    const picked = applied(records, pickCameraLensChanges(records, 'cam', 'ana'));
    expect(cameraLensRefusal(picked, 'cam', 100)).toEqual({ range: { min: 30, max: 72 } });
    expect(cameraLensMmChanges(picked, 'cam', 100)).toEqual([]);
    expect(cameraLensMmChanges(picked, 'cam', 50)).toEqual([{ kind: 'update', id: 'cam', set: { lens_mm: 50 } }]);
    expect(cameraLensRefusal(records, 'cam', 0)).toBe('notFocal');
    expect(cameraOnSideChanges(records, ['cam'], true)).toEqual([{ kind: 'update', id: 'cam', set: { on_side: true } }]);
  });
});

describe('the cone’s numbers, from records', () => {
  it('reads Kevin’s values: 50 mm on a 2× squeeze at 2.39:1 is 51.1° (not 70.9°)', () => {
    const cone = cameraCone(base(), 'cam');
    if (!cone || 'missing' in cone) throw new Error('no cone');
    expect(cone.degrees).toBeCloseTo(51.1, 1);
    expect(cone.widthMm).toBeCloseTo(47.8, 1);
    expect(cone.degrees).not.toBeCloseTo(70.9, 0);
    expect(cone.letter).toBe('A');
  });

  it('reads 24 mm at 9:16 as 26.4°, and on its side 45.2°', () => {
    const records = base({ shot_ids: ['b'] }, '9:16');
    const upright = cameraCone(records, 'cam');
    if (!upright || 'missing' in upright) throw new Error('no cone');
    expect(upright.degrees).toBeCloseTo(26.4, 1);
    const turned = applied(records, cameraOnSideChanges(records, ['cam'], true));
    const side = cameraCone(turned, 'cam');
    if (!side || 'missing' in side) throw new Error('no cone');
    expect(side.degrees).toBeCloseTo(45.2, 1);
    expect(side.widthMm).toBeCloseTo(20, 1);
  });

  it('follows the board live: a frame’s lens changed changes the cone, with no edit to the plan', () => {
    const records = base();
    const before = cameraCone(records, 'cam');
    const changes: Change[] = [{ kind: 'update', id: 'a', set: { lens_mm: 35 } }];
    // The edit touches the frame alone: the plan's records stay as they were.
    expect(changes.every((c) => c.kind === 'update' && records[c.id]?.type === 'shot')).toBe(true);
    const after = applied(records, changes);
    expect(after.cam).toBe(records.cam);
    const cone = cameraCone(after, 'cam');
    if (!before || 'missing' in before || !cone || 'missing' in cone) throw new Error('no cone');
    expect(cone.focalMm).toBe(35);
    expect(cone.degrees).toBeGreaterThan(before.degrees);
    // The project's frame shape changed: so does the cone.
    const square = applied(records, [{ kind: 'update', id: 'p', set: { aspect_ratio: '1:1' } }]);
    const squareCone = cameraCone(square, 'cam');
    if (!squareCone || 'missing' in squareCone) throw new Error('no cone');
    expect(squareCone.degrees).not.toBeCloseTo(before.degrees, 1);
  });

  it('says what is missing and draws no cone: no body, no focal length', () => {
    const records = base({});
    expect(cameraCone(records, 'cam')).toEqual({ missing: 'noFocal', letter: 'A' });
    const bodiless = applied(records, [{ kind: 'trash', id: 'fx3' }]);
    expect(cameraCone(bodiless, 'cam')).toEqual({ missing: 'noBody', letter: null });
  });
});

describe('copies drop frame links', () => {
  it('leaves out a camera’s frames when a setup starts from another, and in the props a paste keeps', () => {
    const records = base({ shot_ids: ['a', 'b'], shown_shot_id: 'b', lens_mm: 35 });
    const changes = copySetupChanges(records, 'u1', 'u2', 'own2');
    const made = changes.find((c): c is Extract<Change, { kind: 'create' }> => c.kind === 'create' && c.record.type === 'plan_item');
    expect(made?.record.props).toMatchObject({ kind: 'camera', copied_from: 'cam', lens_mm: 35 });
    expect(made?.record.props).not.toHaveProperty('shot_ids');
    expect(made?.record.props).not.toHaveProperty('shown_shot_id');
    const copied = applied(records, changes);
    expect(setupPlanOf(copied, 'u2')?.id).toBe('own2');
    expect(shownItems(copied, 's1', 'u2').map((i) => i.fields.kind)).toEqual(['camera']);
    // The original still shoots both.
    expect(cameraFrames(copied, 'cam').map((s) => s.id)).toEqual(['a', 'b']);
    expect(withoutFrameLinks({ kind: 'camera', shot_ids: ['a'], shown_shot_id: 'a', body_id: 'fx3' })).toEqual({ kind: 'camera', body_id: 'fx3' });
    // Any other item's props pass through.
    expect(withoutFrameLinks({ kind: 'icon', shot_ids: ['x'] })).toEqual({ kind: 'icon', shot_ids: ['x'] });
  });
});

describe('the lens check', () => {
  it('fires for a typed lens a linked frame disagrees with, clears with “Use the frame’s lens”, and never without a typed lens', () => {
    const typed = base({ lens_mm: 50, shot_ids: ['a', 'b'] });
    // 1A is 50 mm too: only 1B disagrees.
    expect(planLensDiffers(typed, 'p')).toEqual([{ kind: 'plan-lens-differs', sceneId: 's1', setupId: 'u1', cameraId: 'cam', shotId: 'b', frameMm: 24, cameraMm: 50 }]);
    expect(runChecks(typed, 'p').filter((f) => f.kind === 'plan-lens-differs')).toHaveLength(1);
    expect(framesDiffering(typed, 'cam').map((d) => d.shot.id)).toEqual(['b']);
    const cleared = applied(typed, takeFrameLensChanges(typed, 'cam'));
    expect(planLensDiffers(cleared, 'p')).toEqual([]);
    expect(planLensDiffers(base(), 'p')).toEqual([]);
    // A camera in the Trash, or its frame in the Trash, isn't a mistake.
    expect(planLensDiffers(applied(typed, [{ kind: 'trash', id: 'cam' }]), 'p')).toEqual([]);
    expect(planLensDiffers(applied(typed, [{ kind: 'trash', id: 'b' }]), 'p')).toEqual([]);
    // Another project's check sees none of it.
    expect(planLensDiffers(typed, 'other')).toEqual([]);
  });
});

describe('approvals and issued call sheets', () => {
  it('are untouched by linking, showing and turning a camera: no frame prop changes', async () => {
    const records: Records = {
      ...base({}),
      loc: record('loc', 'location', 'p', { name: 'Diner', address: '12 Route 9', latitude: 40.7, longitude: -74 }),
      d: record('d', 'shoot_day', 'p', { date: '2030-11-16', call_time: '07:00', wrap_time: '19:00' }),
      cs: record('cs', 'callsheet', 'd', { notes: 'Park behind' }),
    };
    const day = applied(records, [
      { kind: 'update', id: 's1', set: { location_id: 'loc', int_ext: 'INT', day_night: 'NIGHT' } },
      { kind: 'update', id: 'a', set: { shoot_day_id: 'd', status: 'need' } },
      { kind: 'update', id: 'b', set: { shoot_day_id: 'd', status: 'need' } },
    ]);
    const zones = new Map<string, string | null>([['loc', 'America/New_York']]);
    const fingerprint = async (r: Records) => {
      const sheet = callSheet(r, 'p', 'd', undefined, zones);
      if (!sheet) throw new Error('no sheet');
      return callSheetFingerprint(sheet, 'google', 'Bey County');
    };
    const bases = (r: Records) => ['camera', 'sound', 'art', 'grip-electric'].map((dept) => approvalBasis(r, 's1', dept).current);
    let linked = applied(day, linkFrameChanges(day, 'cam', 'a'));
    linked = applied(linked, linkFrameChanges(linked, 'cam', 'b'));
    linked = applied(linked, showFrameChanges(linked, 'cam', 'b'));
    linked = applied(linked, cameraOnSideChanges(linked, ['cam'], true));
    expect(cameraFrames(linked, 'cam').map((s) => s.id)).toEqual(['a', 'b']);
    for (const id of ['a', 'b', 's1']) expect(linked[id]).toBe(day[id]);
    expect(bases(linked)).toEqual(bases(day));
    expect(await fingerprint(linked)).toBe(await fingerprint(day));
  });
});

describe('a frame never moves silently to another camera (6.4 review)', () => {
  /** Camera A (`cam`, first in plan order) and camera B (`cam2`) on Setup 1's plan. */
  const two = (a: Props, b: Props): Records => ({ ...base(a), cam2: camera('cam2', b, 'z') });

  it('takes a frame given to B off A in the Trash too, so restoring A leaves it with B', () => {
    const records = two({ shot_ids: ['a'], shown_shot_id: 'a' }, {});
    const trashed = applied(records, [{ kind: 'trash', id: 'cam' }]);
    expect(frameCamera(trashed, 'a')).toBeNull();
    const changes = linkFrameChanges(trashed, 'cam2', 'a');
    // One group: A (in the Trash) lets it go, its shown mark with it; B takes it.
    expect(changes).toEqual([
      { kind: 'update', id: 'cam', unset: ['shot_ids', 'shown_shot_id'] },
      { kind: 'update', id: 'cam2', set: { shot_ids: ['a'] } },
    ]);
    const given = applied(trashed, changes);
    expect(frameCamera(given, 'a')).toBe('cam2');
    const restored = applied(given, [{ kind: 'restore', id: 'cam' }]);
    expect(frameCamera(restored, 'a')).toBe('cam2');
    expect(cameraFrames(restored, 'cam')).toEqual([]);
    expect(cameraFrames(restored, 'cam2').map((s) => s.id)).toEqual(['a']);
  });

  it('takes a frame two cameras list off both for “None” and for Unlink, so it never reads as the other’s', () => {
    // An import left 1A on both; A holds it, being first.
    const records = two({ shot_ids: ['a', 'b'] }, { shot_ids: ['a'], shown_shot_id: 'a' });
    expect(frameCamera(records, 'a')).toBe('cam');
    const none = assignFrameChanges(records, 'a', null);
    expect(none).toEqual([
      { kind: 'update', id: 'cam', set: { shot_ids: ['b'] } },
      { kind: 'update', id: 'cam2', unset: ['shot_ids', 'shown_shot_id'] },
    ]);
    expect(frameCamera(applied(records, none), 'a')).toBeNull();
    const unlinked = applied(records, unlinkFrameChanges(records, 'cam', 'a'));
    expect(frameCamera(unlinked, 'a')).toBeNull();
    expect(cameraFields(unlinked.cam2?.props ?? {})?.shotIds).toEqual([]);
    // Linking it to B takes it off A, and gives B no second copy.
    const toB = linkFrameChanges(records, 'cam2', 'a');
    expect(toB).toEqual([{ kind: 'update', id: 'cam', set: { shot_ids: ['b'] } }]);
    expect(frameCamera(applied(records, toB), 'a')).toBe('cam2');
  });

  it('takes a frame off its cameras when it leaves its setup, so coming back never re-links it', () => {
    const records = base({ shot_ids: ['a', 'b'], shown_shot_id: 'a' });
    const out = leaveSetup(records, ['a']);
    expect(out).toEqual([
      { kind: 'update', id: 'a', unset: ['setup_id'] },
      { kind: 'update', id: 'cam', set: { shot_ids: ['b'] }, unset: ['shown_shot_id'] },
    ]);
    const left = applied(records, out);
    const back = applied(left, joinSetup(left, ['a'], 'u1'));
    expect(frameSetupIdOf(back, 'a')).toBe('u1');
    expect(frameCamera(back, 'a')).toBeNull();
    expect(cameraFrames(back, 'cam').map((s) => s.id)).toEqual(['b']);
    // Straight into another setup, or into a new one, and back: the same.
    const across = applied(records, joinSetup(records, ['a'], 'u2'));
    expect(cameraFields(across.cam?.props ?? {})?.shotIds).toEqual(['b']);
    expect(frameCamera(applied(across, joinSetup(across, ['a'], 'u1')), 'a')).toBeNull();
    const made = applied(records, newSetupFromFrames(records, ['a'], 'u3'));
    expect(cameraFields(made.cam?.props ?? {})?.shotIds).toEqual(['b']);
    expect(frameCamera(applied(made, joinSetup(made, ['a'], 'u1')), 'a')).toBeNull();
  });

  it('takes a frame off its cameras when it moves to another scene, and moved back it is linked to none', () => {
    const records: Records = { ...base({ shot_ids: ['a', 'b'] }), s2: record('s2', 'scene', 'p', { number: '2' }, 's2') };
    const moved = moveItem(records, 'p', 'a', 's2', null);
    expect(moved).toContainEqual({ kind: 'update', id: 'cam', set: { shot_ids: ['b'] } });
    const there = applied(records, moved);
    const home = applied(there, moveItem(there, 'p', 'a', 's1', null));
    const rejoined = applied(home, joinSetup(home, ['a'], 'u1'));
    expect(frameCamera(rejoined, 'a')).toBeNull();
    // A move inside its scene leaves the links as they are.
    expect(moveItem(records, 'p', 'b', 's1', 'a').some((c) => c.kind === 'update' && c.id === 'cam')).toBe(false);
  });
});

describe('reading cameras once per records (6.4 review)', () => {
  it('works out a setup’s frames, cameras and who holds each frame once for 10 cameras and 30 frames', () => {
    const frames = Array.from({ length: 30 }, (_, i) => record(`f${String(i).padStart(2, '0')}`, 'shot', 's1', { number: `1${String(i)}`, setup_id: 'u1', lens_mm: 24 + i }, `f${String(i).padStart(2, '0')}`));
    const cameras = Array.from({ length: 10 }, (_, i) =>
      camera(`c${String(i)}`, { shot_ids: frames.slice(i * 3, i * 3 + 3).map((f) => f.id), height_m: 1.2 }, `c${String(i)}`),
    );
    const records: Records = { ...base({}), ...recordsOf(...frames, ...cameras) };
    const read = (r: Records) => {
      const shown = shownItems(r, 's1', 'u1');
      const looks = cameraLooks(r, shown, 'metres', []);
      for (const f of frames) frameCamera(r, f.id);
      for (const c of cameras) cameraTitle(r, c.id, (icon) => icon);
      return looks;
    };
    const before = setupReadingsMade();
    const looks = read(records);
    expect(looks.size).toBe(11);
    expect(looks.get('c0')?.lines[0]).toMatch(/^A · 24 mm · /);
    expect(setupReadingsMade() - before).toBe(1);
    // The same records again: nothing read again. A new records object (an edit): read once more.
    read(records);
    expect(setupReadingsMade() - before).toBe(1);
    read({ ...records });
    expect(setupReadingsMade() - before).toBe(2);
  });
});

/** A frame's setup as the one reader has it. */
const frameSetupIdOf = (records: Records, id: string): string | null => {
  const shot = records[id];
  return shot && typeof shot.props.setup_id === 'string' ? shot.props.setup_id : null;
};
