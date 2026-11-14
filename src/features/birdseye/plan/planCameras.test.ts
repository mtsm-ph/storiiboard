import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../../app/projectStore';
import { setLocale } from '../../../core/i18n';
import { cameraFields, sceneRoomId, setupPlanOf, shownItems, startRoomChanges } from '../../../core/model/plan';
import { cameraFrames, linkFrameChanges } from '../../../core/model/planCamera';
import { log } from '../../../core/ops/ops';
import { nodeDriver } from '../../../core/storage/nodeDriver';
import { createProject, type Project } from '../../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../../core/storage/testFolder';
import { restoreChanges, trashItems } from '../../trash/trash';
import { cameraReach, conePoints } from './cameraDraw';
import { cameraLooks, coneLabel } from './cameraLooks';
import { placeIcon } from './planActions';
import { iconPatchChanges, placeIconChanges, planClipOf, planItemsBuilder, planPasteInView, trashPlanItemsChanges, turnChanges } from './planItems';
import { CAMERA_TOOL, PLAN_TOOLS } from './planScale';

// Cameras on a plan (6.4): placed from the Library or the C tool into the setup shown as `camera` items, the plan made
// in the same step; drawn with their cone past their box, made again only when what the cone reads changes; turned
// by [ and ]; pasted without their frames; to the Trash and back.

let folder: TestFolder;
let project: Project;
let store = createProjectStore();
beforeEach(async () => {
  setLocale('en');
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  store = createProjectStore();
  await store.getState().open(project);
});
afterEach(async () => {
  await store.getState().close();
  folder.remove();
});

const records = () => store.getState().records;
const groups = async () => (await log(project.file)).length;

/** A scene with a setup, its room started, two frames in the setup, a body and the 2.39:1 frame. */
async function scene(): Promise<{ sceneId: string; setupId: string }> {
  const sceneId = crypto.randomUUID();
  const setupId = crypto.randomUUID();
  await store.getState().apply([
    { kind: 'update', id: project.projectId, set: { aspect_ratio: '2.39:1' } },
    { kind: 'create', record: { id: 'fx3', type: 'gear_item', parentId: project.projectId, sortKey: 'a', props: { name: 'FX3', kind: 'camera_body', sensor_width_mm: 35.6, sensor_height_mm: 20, camera_letter: 'A' } } },
    { kind: 'create', record: { id: 'ana', type: 'gear_item', parentId: project.projectId, sortKey: 'b', props: { name: 'Optimo', kind: 'lens', focal_min_mm: 30, focal_max_mm: 72, squeeze: 2 } } },
    { kind: 'create', record: { id: sceneId, type: 'scene', parentId: project.projectId, sortKey: '1', props: { number: '1', name: 'Diner' } } },
    { kind: 'create', record: { id: setupId, type: 'setup', parentId: sceneId, sortKey: 'a', props: { name: '' } } },
    { kind: 'create', record: { id: 'a', type: 'shot', parentId: sceneId, sortKey: 'a', props: { number: '1A', setup_id: setupId, lens_mm: 50, lens_id: 'ana' } } },
    { kind: 'create', record: { id: 'b', type: 'shot', parentId: sceneId, sortKey: 'b', props: { number: '1B', setup_id: setupId, lens_mm: 24 } } },
  ]);
  await store.getState().apply(startRoomChanges(records(), project.projectId, sceneId));
  expect(sceneRoomId(records(), records()[sceneId])).not.toBeNull();
  return { sceneId, setupId };
}

describe('placing a camera', () => {
  it('puts a camera icon in the setup shown as a camera, at its size, its plan made in the same step', async () => {
    const { sceneId, setupId } = await scene();
    const before = await groups();
    const id = crypto.randomUUID();
    const changes = placeIconChanges(records(), { sceneId, setupId }, 'camera/dolly-track', { x: 1, y: 2 }, id);
    expect(changes.map((c) => c.kind)).toEqual(['create', 'create']);
    await store.getState().apply(changes);
    expect(await groups()).toBe(before + 1);
    expect(records()[id]?.parentId).toBe(setupPlanOf(records(), setupId)?.id);
    expect(cameraFields(records()[id]?.props ?? {})).toMatchObject({ kind: 'camera', icon: 'camera/dolly-track', x: 0.5, y: 0.5, width: 1, height: 3, rotation: 0, shotIds: [] });
    // The field of view is never an item; with only the scene shown, a camera has no setup to go in.
    expect(placeIconChanges(records(), { sceneId, setupId }, 'camera/field-of-view', { x: 0, y: 0 })).toEqual([]);
    expect(placeIconChanges(records(), { sceneId, setupId: null }, 'camera/camera', { x: 0, y: 0 })).toEqual([]);
    await store.getState().undo();
    expect(records()[id]).toBeUndefined();
  });

  it('has the C tool on the plan, a letter nothing else there uses', () => {
    const keys = PLAN_TOOLS.map((tool) => tool.key);
    expect(PLAN_TOOLS.find((tool) => tool.id === CAMERA_TOOL)?.key).toBe('C');
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('writes only into the project the gesture began in', async () => {
    const { sceneId, setupId } = await scene();
    expect(await placeIcon({ sceneId, setupId }, 'camera/camera', { x: 0, y: 0 }, null, store)).toBe('otherProject');
    expect(await placeIcon({ sceneId, setupId }, 'camera/camera', { x: 0, y: 0 }, project, store)).toBeNull();
    expect(shownItems(records(), sceneId, setupId).map((i) => i.fields.kind)).toEqual(['camera']);
  });
});

describe('a camera on the canvas', () => {
  it('draws its cone past its box, and is made again only when what the cone reads changes', async () => {
    const { sceneId, setupId } = await scene();
    const id = crypto.randomUUID();
    await store.getState().apply(placeIconChanges(records(), { sceneId, setupId }, 'camera/camera', { x: 0, y: 0 }, id));
    await store.getState().apply(linkFrameChanges(records(), id, 'a'));
    const build = planItemsBuilder();
    const shown = shownItems(records(), sceneId, setupId);
    const looks = cameraLooks(records(), shown, 'metres', []);
    expect(looks.get(id)?.lines).toEqual(['A · 50 mm · 51.1°']);
    const first = build(shown, 'metres', '#16150F', 'en', looks);
    const item = first.find((i) => i.id === id);
    expect(item?.beyond).toBeDefined();
    expect(item?.keepRatio).toBe(true);
    // The same looks: the same list.
    expect(build(shown, 'metres', '#16150F', 'en', cameraLooks(records(), shown, 'metres', []))).toBe(first);
    // The frame's lens changed on the board: a new camera item, with no edit to the plan.
    await store.getState().apply([{ kind: 'update', id: 'a', set: { lens_mm: 35 } }]);
    const again = shownItems(records(), sceneId, setupId);
    expect(again[0]?.record).toBe(shown[0]?.record);
    const next = build(again, 'metres', '#16150F', 'en', cameraLooks(records(), again, 'metres', []));
    expect(next).not.toBe(first);
    expect(cameraLooks(records(), again, 'metres', []).get(id)?.lines[0]).toMatch(/^A · 35 mm · /);
    // Selected, its edges are full ink: made again too.
    expect(cameraLooks(records(), again, 'metres', [id]).get(id)?.selected).toBe(true);
  });

  it('reaches as far as its cone, turned with it', () => {
    // A 40 × 40 box at the origin pointing up: the cone runs 600 up from its middle.
    const up = cameraReach({ x: 0, y: 0, width: 40, height: 40, rotation: 0 }, 60, 600, 0);
    expect(up.y).toBeCloseTo(20 - 600 * Math.cos(Math.PI / 6), 3);
    expect(up.y + up.height).toBeCloseTo(40, 3);
    // Turned to the right: the cone runs 600 to the right.
    const right = cameraReach({ x: 0, y: 0, width: 40, height: 40, rotation: 90 }, 60, 600, 0);
    expect(right.x + right.width).toBeCloseTo(20 + 600 * Math.cos(Math.PI / 6), 3);
    expect(right.x).toBeCloseTo(0, 3);
    // No cone: only the room round the box.
    expect(cameraReach({ x: 0, y: 0, width: 40, height: 40, rotation: 0 }, null, 600, 10)).toEqual({ x: -10, y: -10, width: 60, height: 60 });
    const [cx, cy, lx, , rx] = conePoints(40, 40, 90, 100);
    expect([cx, cy]).toEqual([20, 20]);
    expect(rx - lx).toBeCloseTo(2 * 100 * Math.sin(Math.PI / 4), 6);
  });

  it('says what is missing in its label', () => {
    expect(coneLabel({ missing: 'noBody', letter: null })).toBe('No camera body');
    expect(coneLabel({ missing: 'noFocal', letter: 'A' })).toBe('A · No focal length');
  });
});

describe('editing a camera', () => {
  it('turns by [ and ], pastes without its frames, and goes to the Trash and back', async () => {
    const { sceneId, setupId } = await scene();
    const id = crypto.randomUUID();
    await store.getState().apply(placeIconChanges(records(), { sceneId, setupId }, 'camera/camera', { x: 0, y: 0 }, id));
    await store.getState().apply(linkFrameChanges(records(), id, 'a'));
    expect(turnChanges(records(), [id], -5)).toEqual([{ kind: 'update', id, set: { rotation: 355 } }]);
    await store.getState().apply(turnChanges(records(), [id], 5));
    expect(cameraFields(records()[id]?.props ?? {})?.rotation).toBe(5);
    // Typed height and rotation through the icons' patch.
    expect(iconPatchChanges(records(), [id], { heightM: 1.5 })).toEqual([{ kind: 'update', id, set: { height_m: 1.5 } }]);
    // Pasted: a camera that shoots nothing, in the setup shown.
    const pasted = planPasteInView(records(), { sceneId, setupId }, planClipOf(records(), [id]), null);
    const made = pasted.changes.find((c) => c.kind === 'create');
    expect(made?.kind === 'create' ? made.record.props : {}).not.toHaveProperty('shot_ids');
    await store.getState().apply(pasted.changes);
    expect(cameraFrames(records(), pasted.ids[0] ?? '')).toEqual([]);
    expect(cameraFrames(records(), id).map((s) => s.id)).toEqual(['a']);
    // To the Trash and back with its links.
    await store.getState().apply(trashPlanItemsChanges(records(), [id]));
    expect(cameraFrames(records(), id)).toEqual([]);
    expect(trashItems(records(), project.projectId).some((item) => item.id === id)).toBe(true);
    await store.getState().apply(restoreChanges(records(), project.projectId, id));
    expect(cameraFrames(records(), id).map((s) => s.id)).toEqual(['a']);
  });
});
