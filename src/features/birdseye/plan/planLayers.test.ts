import { afterEach, beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import { noticeStore } from '../../../app/notice';
import { createProjectStore, projectStore } from '../../../app/projectStore';
import { setLocale } from '../../../core/i18n';
import { CAMERA_ICON, iconGroup, LIGHT_ICON, PLAN_ITEM_KINDS, PLAN_LAYERS, planItemLayer, shownItems, startRoomChanges } from '../../../core/model/plan';
import { ALL_SHOWN, layeredItems, layerOfItem, myDepartmentStates, soloStates, type PlanLayerStates } from '../../../core/model/planLayers';
import { placeMarkChanges } from '../../../core/model/planBlocking';
import type { Props } from '../../../core/model/record';
import { log } from '../../../core/ops/ops';
import { nodeDriver } from '../../../core/storage/nodeDriver';
import { createProject, type Project } from '../../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../../core/storage/testFolder';
import { marqueePicks, pickOrder } from '../../../ui/canvas/picking';
import { PLAN_ICONS } from '../../../ui/icons/plan/planIcons';
import { layersStore, layerStatesNow, setLayerLocked, setLayerShow, showAllLayers, soloLayer } from './layersStore';
import { placeIcon, placeMark, planSelection } from './planActions';
import { drawWallsChanges, openingSpotInWall, placeIconChanges, placeOpeningChanges, planItemsBuilder, trashPlanItemsChanges } from './planItems';
import { layerKeyFor } from './PlanTile';
import { planStore } from './planStore';

// The plan's layers (6.8): every kind and icon group on exactly one layer, a hidden layer's items left out of what the
// canvas is given (a wall's openings with it), a dimmed or locked one's carried as the core's `dim` and `locked`, select
// all and the marquee never picking them, Delete after them changing nothing there, placing onto a hidden layer showing
// it, and Solo and back. Never an op: the state lives in this computer's settings.

let folder: TestFolder;
let project: Project;
let store = createProjectStore();
beforeEach(async () => {
  setLocale('en');
  layersStore.setState({ saved: null, solo: null });
  planStore.setState({ selections: {} });
  folder = makeTestFolder();
  project = await createProject(folder.path('Layers.sbd'), { driver: nodeDriver, backups: false });
  store = createProjectStore();
  await store.getState().open(project);
});
afterEach(async () => {
  layersStore.setState({ saved: null, solo: null });
  await store.getState().close();
  folder.remove();
});

const records = () => store.getState().records;

/** Scene 1 with ANA, a setup and its room: a wall with a door, a sofa, a camera, a light and ANA's mark. */
async function plan() {
  const sceneId = crypto.randomUUID();
  const setupId = crypto.randomUUID();
  await store.getState().apply([
    { kind: 'create', record: { id: 'ana', type: 'character', parentId: project.projectId, sortKey: 'a', props: { name: 'ANA' } } },
    { kind: 'create', record: { id: sceneId, type: 'scene', parentId: project.projectId, sortKey: '1', props: { number: '1', character_ids: ['ana'] } } },
    { kind: 'create', record: { id: setupId, type: 'setup', parentId: sceneId, sortKey: 'a', props: { name: '' } } },
  ]);
  await store.getState().apply(startRoomChanges(records(), project.projectId, sceneId));
  const view = { sceneId, setupId };
  const walls = drawWallsChanges(records(), sceneId, [
    { x: 0, y: 0 },
    { x: 500, y: 0 },
  ]);
  await store.getState().apply(walls.changes);
  const wall = walls.ids[0] ?? '';
  const spot = openingSpotInWall(shownItems(records(), sceneId, setupId), wall, 'door');
  if (!spot) throw new Error('no spot');
  await store.getState().apply(placeOpeningChanges(records(), spot, 'door', 'door', view));
  await store.getState().apply(placeIconChanges(records(), view, 'set-art/sofa', { x: 2, y: 2 }, 'sofa'));
  await store.getState().apply(placeIconChanges(records(), view, CAMERA_ICON, { x: 1, y: 4 }, 'camera'));
  await store.getState().apply(placeIconChanges(records(), view, LIGHT_ICON, { x: 4, y: 4 }, 'light'));
  await store.getState().apply(placeMarkChanges(records(), view, { x: 3, y: 2 }, { width: 0.5, depth: 0.5 }, 'ana', 'mark'));
  return { view, wall };
}

const states = (patch: Partial<Record<keyof PlanLayerStates, Partial<PlanLayerStates['camera']>>>): PlanLayerStates =>
  Object.fromEntries(PLAN_LAYERS.map((l) => [l, { ...ALL_SHOWN[l], ...patch[l] }])) as unknown as PlanLayerStates;

describe('an item’s layer', () => {
  it('is one layer for every kind this version knows, the underlay its own row', () => {
    const props: Record<string, Props> = { icon: { icon: 'set-art/sofa' } };
    for (const kind of PLAN_ITEM_KINDS) {
      const layer = planItemLayer({ kind, ...(props[kind] ?? {}) });
      if (kind === 'underlay') expect(layer).toBeNull();
      else expect(PLAN_LAYERS.filter((l) => l === layer)).toHaveLength(1);
    }
    expect(planItemLayer({ kind: 'path', camera_id: 'c' })).toBe('camera');
    expect(planItemLayer({ kind: 'path' })).toBe('cast');
    expect(planItemLayer({ kind: 'measure' })).toBe('production');
  });

  it('is its group for every icon in the kit', () => {
    expect(PLAN_ICONS.length).toBeGreaterThan(0);
    for (const icon of PLAN_ICONS) {
      expect(iconGroup(icon.id)).toBe(icon.group);
      expect(planItemLayer({ kind: 'icon', icon: icon.id })).toBe(icon.group);
    }
    // Every group has icons, so every layer is one the Library can fill.
    expect(new Set(PLAN_ICONS.map((i) => i.group))).toEqual(new Set(PLAN_LAYERS));
  });

  it('of a door is its wall’s', async () => {
    await plan();
    const door = records().door;
    if (!door) throw new Error('no door');
    expect(layerOfItem(records(), door)).toBe('set-art');
    expect(layerOfItem(records(), records().mark as never)).toBe('cast');
  });
});

describe('the canvas items under the layers', () => {
  it('leave a hidden layer out, its wall’s door with it, and carry dim and locked', async () => {
    const { view, wall } = await plan();
    const shown = shownItems(records(), view.sceneId, view.setupId);
    const build = planItemsBuilder();
    const all = layeredItems(records(), shown, ALL_SHOWN);
    expect(all.visible).toBe(shown);
    const first = build(all.visible, 'metres', '#000', 'en', undefined, undefined, undefined, undefined, all.looks);
    expect(first.map((i) => i.id).filter((id) => id !== wall).sort()).toEqual(['camera', 'door', 'light', 'mark', 'sofa']);
    expect(first.map((i) => i.id)).toContain(wall);
    expect(first.some((i) => i.dim === true || i.locked === true)).toBe(false);

    const hid = layeredItems(records(), shown, states({ 'set-art': { show: 'hidden' }, lighting: { show: 'dimmed' }, camera: { locked: true } }));
    const items = build(hid.visible, 'metres', '#000', 'en', undefined, undefined, undefined, undefined, hid.looks);
    const ids = items.map((i) => i.id);
    // The wall hidden with its door; the sofa is art too.
    expect(ids).not.toContain('door');
    expect(ids).not.toContain(wall);
    expect(ids).not.toContain('sofa');
    expect(items.some((i) => i.label.toLowerCase().includes('wall'))).toBe(false);
    expect(items.find((i) => i.id === 'light')).toMatchObject({ dim: true });
    expect(items.find((i) => i.id === 'light')?.locked).toBeUndefined();
    expect(items.find((i) => i.id === 'camera')).toMatchObject({ locked: true });
    expect(items.find((i) => i.id === 'camera')?.dim).toBeUndefined();
    expect(items.find((i) => i.id === 'mark')).toMatchObject({ id: 'mark' });

    // The state is in the builder's key: the same state again gives the same list, another a new item for that layer only.
    const again = build(hid.visible, 'metres', '#000', 'en', undefined, undefined, undefined, undefined, hid.looks);
    expect(again).toBe(items);
    const unlocked = layeredItems(records(), shown, states({ 'set-art': { show: 'hidden' }, lighting: { show: 'dimmed' } }));
    const next = build(unlocked.visible, 'metres', '#000', 'en', undefined, undefined, undefined, undefined, unlocked.looks);
    expect(next).not.toBe(items);
    expect(next.find((i) => i.id === 'camera')?.locked).toBeUndefined();
    expect(next.find((i) => i.id === 'light')).toBe(items.find((i) => i.id === 'light'));
  });

  it('are never picked by select all or the marquee on a hidden or locked layer, so Delete leaves them', async () => {
    const { view, wall } = await plan();
    const shown = shownItems(records(), view.sceneId, view.setupId);
    const layered = layeredItems(records(), shown, states({ lighting: { show: 'hidden' }, 'set-art': { locked: true } }));
    const items = planItemsBuilder()(layered.visible, 'metres', '#000', 'en', undefined, undefined, undefined, undefined, layered.looks);
    const all = pickOrder([], [], items);
    expect(all.sort()).toEqual(['camera', 'mark']);
    const box = { x: -1000, y: -1000, width: 5000, height: 5000 };
    expect(marqueePicks(items, box).sort()).toEqual(['camera', 'mark']);

    // A selection made before the layers changed: Delete takes only what can still be picked.
    setLayerShow('lighting', 'hidden');
    setLayerLocked('set-art', true);
    planStore.getState().select(`setup:${view.setupId}`, ['camera', 'light', 'sofa', wall, 'door']);
    expect(planSelection(records(), view)).toEqual(['camera']);
    const changes = trashPlanItemsChanges(records(), planSelection(records(), view));
    expect(changes.map((c) => (c.kind === 'trash' || c.kind === 'update' ? c.id : null)).filter((id) => id !== null && id !== 'camera')).toEqual([]);
  });

  it('take a newly hidden or locked layer’s items out of the selection', async () => {
    const { view } = await plan();
    // The selection is checked against the open project's records, the app's store's.
    const was = projectStore.getState().records;
    projectStore.setState({ records: records() });
    onTestFinished(() => {
      projectStore.setState({ records: was });
    });
    const key = `setup:${view.setupId}`;
    planStore.getState().select(key, ['camera', 'light', 'sofa']);
    setLayerShow('lighting', 'dimmed');
    expect(planStore.getState().selections[key]).toEqual(['camera', 'light', 'sofa']);
    setLayerShow('lighting', 'hidden');
    expect(planStore.getState().selections[key]).toEqual(['camera', 'sofa']);
    setLayerLocked('set-art', true);
    expect(planStore.getState().selections[key]).toEqual(['camera']);
  });
});

describe('placing onto a hidden or locked layer', () => {
  it('shows and unlocks the layer, and says so', async () => {
    const { view } = await plan();
    setLayerShow('lighting', 'hidden');
    setLayerLocked('cast', true);
    setLayerShow('set-art', 'dimmed');
    noticeStore.setState({ message: null });
    expect(await placeIcon(view, LIGHT_ICON, { x: 5, y: 5 }, project, store)).toBeNull();
    expect(layerStatesNow().lighting).toEqual({ show: 'shown', locked: false });
    expect(noticeStore.getState().message).toBe('Shown and unlocked so what you placed can be seen and picked: Lighting.');
    expect(await placeMark(view, { x: 1, y: 1 }, project, store)).toBeNull();
    expect(layerStatesNow().cast).toEqual({ show: 'shown', locked: false });
    // A dimmed layer can be seen and picked: placing on it leaves it dimmed.
    noticeStore.setState({ message: null });
    expect(await placeIcon(view, 'set-art/table', { x: 6, y: 6 }, project, store)).toBeNull();
    expect(layerStatesNow()['set-art'].show).toBe('dimmed');
    expect(noticeStore.getState().message).toBeNull();
  });
});

describe('the layers’ state', () => {
  it('starts from the person’s department, all shown for the director, the DP and Full view', () => {
    const only = (s: PlanLayerStates) => PLAN_LAYERS.filter((l) => s[l].show === 'shown');
    expect(only(myDepartmentStates({ fullView: false, departments: ['camera'] }))).toEqual(['camera']);
    expect(only(myDepartmentStates({ fullView: false, departments: ['grip-electric'] }))).toEqual(['lighting', 'grip']);
    expect(only(myDepartmentStates({ fullView: false, departments: ['art'] }))).toEqual(['set-art']);
    expect(only(myDepartmentStates({ fullView: false, departments: ['cast'] }))).toEqual(['cast']);
    expect(only(myDepartmentStates({ fullView: false, departments: ['sound'] }))).toEqual(['sound']);
    expect(only(myDepartmentStates({ fullView: false, departments: ['production'] }))).toEqual(['production']);
    const gaffer = myDepartmentStates({ fullView: false, departments: ['grip-electric'] });
    expect(gaffer.camera).toEqual({ show: 'dimmed', locked: false });
    expect(myDepartmentStates({ fullView: true, departments: ['grip-electric'] })).toBe(ALL_SHOWN);
    expect(myDepartmentStates({ fullView: false, departments: ['hmu'] })).toBe(ALL_SHOWN);
    expect(myDepartmentStates({ fullView: false, departments: [] })).toBe(ALL_SHOWN);
    expect(PLAN_LAYERS.every((l) => !gaffer[l].locked)).toBe(true);
  });

  it('solos a layer and puts back what was before', () => {
    setLayerShow('sound', 'hidden');
    setLayerLocked('set-art', true);
    const before = layerStatesNow();
    soloLayer('camera');
    expect(layerStatesNow()).toEqual(soloStates(before, 'camera'));
    expect(layerStatesNow().camera.show).toBe('shown');
    expect(layerStatesNow().lighting.show).toBe('dimmed');
    expect(layerStatesNow()['set-art'].locked).toBe(true);
    expect(layersStore.getState().solo?.layer).toBe('camera');
    soloLayer('camera');
    expect(layerStatesNow()).toEqual(before);
    expect(layersStore.getState().solo).toBeNull();
    // Another change after a solo ends it: pressing Solo again solos afresh.
    soloLayer('cast');
    setLayerShow('camera', 'hidden');
    expect(layersStore.getState().solo).toBeNull();
    soloLayer('cast');
    expect(layerStatesNow().cast.show).toBe('shown');
    showAllLayers();
    expect(layerStatesNow()).toEqual(ALL_SHOWN);
  });

  it('writes nothing to the project', async () => {
    await plan();
    const before = (await log(project.file)).length;
    const kept = records();
    setLayerShow('camera', 'hidden');
    setLayerLocked('cast', true);
    soloLayer('lighting');
    showAllLayers();
    expect((await log(project.file)).length).toBe(before);
    expect(records()).toBe(kept);
  });

  it('keys 1 to 7 solo the layers in call-sheet order, 0 shows all, never with Shift or a modifier', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => layerKeyFor({ code: `Digit${String(n)}` }))).toEqual(['camera', 'lighting', 'grip', 'set-art', 'sound', 'production', 'cast']);
    expect(layerKeyFor({ code: 'Digit0' })).toBe('all');
    expect(layerKeyFor({ code: 'Numpad2' })).toBe('lighting');
    expect(layerKeyFor({ code: 'Digit8' })).toBeNull();
    expect(layerKeyFor({ code: 'Digit1', shiftKey: true })).toBeNull();
    expect(layerKeyFor({ code: 'Digit1', ctrlKey: true })).toBeNull();
    expect(layerKeyFor({ code: 'KeyV' })).toBeNull();
  });
});
