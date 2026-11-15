import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { noticeStore } from '../../../app/notice';
import { createProjectStore, projectStore } from '../../../app/projectStore';
import { projectSelfStore } from '../../../app/settings/projectRole';
import { setLocale } from '../../../core/i18n';
import { CAMERA_ICON, iconGroup, LIGHT_ICON, NORTH_ICON, PLAN_ITEM_KINDS, PLAN_LAYERS, planItemLayer, shownItems, startRoomChanges } from '../../../core/model/plan';
import { ALL_SHOWN, LAYER_ROWS, layeredItems, layeredItemsKeeper, layerOfItem, myDepartmentStates, sameStates, soloStates, type PlanLayerStates } from '../../../core/model/planLayers';
import { itemLayer, markOwnerChanges, nextPositionChanges, placeMarkChanges } from '../../../core/model/planBlocking';
import type { Props } from '../../../core/model/record';
import { log } from '../../../core/ops/ops';
import { nodeDriver } from '../../../core/storage/nodeDriver';
import { createProject, type Project } from '../../../core/storage/project';
import { loadSettings } from '../../../core/storage/settings';
import { makeTestFolder, type TestFolder } from '../../../core/storage/testFolder';
import { marqueePicks, pickOrder } from '../../../ui/canvas/picking';
import { snapMoveByPoints } from '../../../ui/canvas/scale';
import { PLAN_ICONS } from '../../../ui/icons/plan/planIcons';
import { layersStore, layerStatesNow, myDepartmentLayers, reloadLayersForTests, revealLayers, setLayerLocked, setLayerShow, showAllLayers, soloLayer } from './layersStore';
import { copyPlanSelection, copySetup, markSizes, pastePlan, placeIcon, placeMark, planSelection, setMarkOwner } from './planActions';
import { drawWallsChanges, openingSpotInWall, placeIconChanges, placeOpeningChanges, planItemsBuilder, shownItemsKeeper, trashPlanItemsChanges } from './planItems';
import { openCameraOnPlan } from './PlanLensLine';
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
  layersStore.setState({ saved: null, solo: null, said: { text: '', by: 'tile' } });
  planStore.setState({ selections: {}, clipboard: [] });
  folder = makeTestFolder();
  project = await createProject(folder.path('Layers.sbd'), { driver: nodeDriver, backups: false });
  store = createProjectStore();
  await store.getState().open(project);
});
afterEach(async () => {
  layersStore.setState({ saved: null, solo: null, said: { text: '', by: 'tile' } });
  vi.unstubAllGlobals();
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
  Object.fromEntries(LAYER_ROWS.map((l) => [l, { ...ALL_SHOWN[l], ...patch[l] }])) as unknown as PlanLayerStates;

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

  it('of a door or window is its wall’s, by what each is', async () => {
    await plan();
    const door = records().door;
    if (!door) throw new Error('no door');
    expect(layerOfItem(records(), door)).toBe('set-art');
    expect(layerOfItem(records(), records().mark as never)).toBe('cast');
    // L13: walls, doors and windows are one layer by construction, so a hidden wall always hides its openings; no
    // reading of the wall's own layer is needed (that branch could never differ, and is gone).
    expect(new Set(['wall', 'door', 'window'].map((kind) => planItemLayer({ kind })))).toEqual(new Set(['set-art']));
  });

  it('of the room’s north is the set’s, with its walls, though its icon is in production’s Library group (M2)', () => {
    expect(planItemLayer({ kind: 'north', icon: 'production/north' })).toBe('set-art');
    expect(iconGroup('production/north')).toBe('production');
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
    expect(noticeStore.getState().message).toBe('Layer shown so you can see what you’re working on: Lighting.');
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
    // Another row's choice during a solo is the solo's, held (6.8 second review, M-a): nothing changes, the solo stays.
    soloLayer('cast');
    const soloed = layerStatesNow();
    setLayerShow('camera', 'hidden');
    setLayerLocked('camera', false);
    expect(layersStore.getState().solo?.layer).toBe('cast');
    expect(layerStatesNow()).toEqual(soloed);
    soloLayer('cast');
    expect(layerStatesNow()).toEqual(before);
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
    expect(layerKeyFor({ code: 'Numpad2', key: '2' })).toBe('lighting');
    // NumLock off (L2): the same keys are End, Down, Insert…, and solo nothing.
    expect(layerKeyFor({ code: 'Numpad1', key: 'End' })).toBeNull();
    expect(layerKeyFor({ code: 'Numpad7', key: 'Home' })).toBeNull();
    expect(layerKeyFor({ code: 'Numpad5', key: 'Clear' })).toBeNull();
    expect(layerKeyFor({ code: 'Numpad0', key: 'Insert' })).toBeNull();
    expect(layerKeyFor({ code: 'Numpad0', key: '0' })).toBe('all');
    expect(layerKeyFor({ code: 'Digit8' })).toBeNull();
    expect(layerKeyFor({ code: 'Digit1', shiftKey: true })).toBeNull();
    expect(layerKeyFor({ code: 'Digit1', ctrlKey: true })).toBeNull();
    expect(layerKeyFor({ code: 'KeyV' })).toBeNull();
  });
});

/** The app's own project store holds the test project: for the flows that read it (paste, Open on the plan, pruning). */
async function useAppStore() {
  await store.getState().close();
  // Closing a store closes its project, so the app's store opens one of its own.
  project = await createProject(folder.path('Layers in the app.sbd'), { driver: nodeDriver, backups: false });
  store = projectStore;
  await store.getState().open(project);
}

const without = (states: PlanLayerStates, patch: Partial<Record<keyof PlanLayerStates, Partial<PlanLayerStates['camera']>>>): PlanLayerStates =>
  Object.fromEntries(LAYER_ROWS.map((l) => [l, { ...states[l], ...patch[l] }])) as unknown as PlanLayerStates;

const memoryStorage = () => {
  const kept = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) });
};

describe('a solo (6.8 review)', () => {
  it('dims and locks every other layer, so Select all then Delete touches only the solo layer (M3)', async () => {
    const { view } = await plan();
    soloLayer('camera');
    const now = layerStatesNow();
    expect(now.camera).toEqual({ show: 'shown', locked: false });
    expect(PLAN_LAYERS.filter((l) => l !== 'camera').every((l) => now[l].show === 'dimmed' && now[l].locked)).toBe(true);
    const shown = shownItems(records(), view.sceneId, view.setupId);
    const layered = layeredItems(records(), shown, now);
    const items = planItemsBuilder()(layered.visible, 'metres', '#000', 'en', undefined, undefined, undefined, undefined, layered.looks);
    // Select all picks the camera alone; a selection made before the solo keeps only it too; Delete trashes only it.
    expect(pickOrder([], [], items)).toEqual(['camera']);
    planStore.getState().select(`setup:${view.setupId}`, shown.map((i) => i.record.id));
    expect(planSelection(records(), view)).toEqual(['camera']);
    const trashed = trashPlanItemsChanges(records(), planSelection(records(), view)).flatMap((c) => (c.kind === 'trash' ? [c.id] : []));
    expect(trashed).toEqual(['camera']);
  });

  it('ends as it began: 1, 2, then 2 again goes back to the state before 1 (L1), hidden layers and locks included', () => {
    setLayerShow('sound', 'hidden');
    setLayerLocked('set-art', true);
    setLayerShow('cast', 'dimmed');
    const before = layerStatesNow();
    soloLayer('camera');
    soloLayer('lighting');
    expect(layersStore.getState().solo?.layer).toBe('lighting');
    expect(layerStatesNow().camera).toEqual({ show: 'dimmed', locked: true });
    soloLayer('lighting');
    expect(layerStatesNow()).toEqual(before);
    expect(layersStore.getState().solo).toBeNull();
  });

  it('is never what the settings keep, and the solo row’s own change during it is kept in it and after it', () => {
    memoryStorage();
    setLayerShow('sound', 'hidden');
    const before = layerStatesNow();
    soloLayer('grip');
    // A reload during a solo comes back without it.
    const kept = loadSettings().planLayers;
    expect(kept !== null && sameStates(kept, before)).toBe(true);
    // Another row's change is held: the solo stays, and nothing changes.
    setLayerShow('cast', 'dimmed');
    expect(layersStore.getState().solo?.layer).toBe('grip');
    expect(layerStatesNow().cast).toEqual({ show: 'dimmed', locked: true });
    expect(sameStates(loadSettings().planLayers ?? ALL_SHOWN, before)).toBe(true);
    // The solo row's own choice: changed in the solo, kept after it and in the settings.
    setLayerShow('grip', 'dimmed');
    expect(layersStore.getState().solo?.layer).toBe('grip');
    expect(layerStatesNow().grip).toEqual({ show: 'dimmed', locked: false });
    expect(layerStatesNow().camera).toEqual({ show: 'dimmed', locked: true });
    expect(loadSettings().planLayers?.grip.show).toBe('dimmed');
    soloLayer('grip');
    expect(layerStatesNow()).toEqual(without(before, { grip: { show: 'dimmed' } }));
  });

  it('holds the other rows: their choices and locks do nothing, and pressing a current choice does nothing ever (M-a)', () => {
    setLayerShow('cast', 'hidden');
    const saved = layersStore.getState().saved;
    // The choice already current: nothing at all, not even a new object.
    setLayerShow('cast', 'hidden');
    setLayerLocked('cast', false);
    expect(layersStore.getState().saved).toBe(saved);
    soloLayer('camera');
    const soloed = layersStore.getState();
    for (const layer of ['lighting', 'cast', 'underlay'] as const) {
      setLayerShow(layer, 'shown');
      setLayerShow(layer, 'hidden');
      setLayerLocked(layer, false);
    }
    // Pressing the solo row's current choice, or its lock as it is, keeps everything as it was.
    setLayerShow('camera', 'shown');
    setLayerLocked('camera', false);
    expect(layersStore.getState().saved).toBe(soloed.saved);
    expect(layersStore.getState().solo).toBe(soloed.solo);
  });

  it('keeps itself through its own row’s lock, and through a reveal of its own layer', () => {
    soloLayer('camera');
    setLayerLocked('camera', true);
    expect(layersStore.getState().solo?.layer).toBe('camera');
    expect(layerStatesNow().camera).toEqual({ show: 'shown', locked: true });
    noticeStore.setState({ message: null });
    revealLayers(['camera']);
    expect(layersStore.getState().solo?.layer).toBe('camera');
    expect(layerStatesNow().camera).toEqual({ show: 'shown', locked: false });
    expect(noticeStore.getState().message).toBe('Layer unlocked so you can pick what you’re working on: Camera.');
  });

  it('ends by Show all, My department, key 0 or another row’s Solo, each saying so', () => {
    const said = () => layersStore.getState().said;
    setLayerShow('sound', 'hidden');
    const before = layerStatesNow();
    soloLayer('camera');
    expect(said()).toEqual({ text: 'Camera layer solo, the others dimmed and locked', by: 'tile' });
    // Another row's Solo moves it, and the first one's end is said.
    soloLayer('lighting');
    expect(layersStore.getState().solo?.layer).toBe('lighting');
    expect(said().text).toBe('Camera solo ended. Lighting layer solo, the others dimmed and locked');
    showAllLayers();
    expect(layersStore.getState().solo).toBeNull();
    expect(layerStatesNow()).toEqual(without(before, { sound: { show: 'shown' } }));
    expect(said().text).toBe('Lighting solo ended. All layers shown, none locked');
    // Key 0 on the plan is Show all, said on the canvas's line.
    soloLayer('grip', 'plan');
    showAllLayers('plan');
    expect(said()).toEqual({ text: 'Grip solo ended. All layers shown, none locked', by: 'plan' });
    soloLayer('cast');
    myDepartmentLayers();
    expect(layersStore.getState().solo).toBeNull();
    expect(said().text).toBe('Cast solo ended. Your department’s layers shown, the rest dimmed');
    // Ended by its own button: only that it is back, no "ended" for a press that says what it does.
    soloLayer('cast');
    soloLayer('cast');
    expect(said().text).toBe('Layers back as they were before the solo');
    // Without a solo, Show all says only what it did.
    showAllLayers();
    expect(said().text).toBe('All layers shown, none locked');
    // In Spanish too.
    setLocale('es');
    onTestFinished(() => {
      setLocale('en');
    });
    soloLayer('camera');
    showAllLayers();
    expect(said().text).toBe('Terminó el solo de Cámara. Todas las capas visibles, ninguna bloqueada');
  });

  it('ends by a reveal of another layer, the notice saying what it showed and that the solo ended (L4, L8)', () => {
    setLayerShow('lighting', 'hidden');
    soloLayer('camera');
    noticeStore.setState({ message: null });
    revealLayers(['lighting']);
    expect(layersStore.getState().solo).toBeNull();
    expect(layerStatesNow().lighting).toEqual({ show: 'shown', locked: false });
    expect(noticeStore.getState().message).toBe('Layer shown so you can see what you’re working on: Lighting. Camera solo ended so you can pick what you’re working on.');
    // A layer that comes back pickable anyway: only the solo's end is said.
    soloLayer('camera');
    revealLayers(['grip'], ['Pasted.']);
    expect(noticeStore.getState().message).toBe('Pasted. Camera solo ended so you can pick what you’re working on.');
  });

  it('begun with nothing saved writes nothing, so after it the start follows “This is me” again (L5)', () => {
    memoryStorage();
    reloadLayersForTests();
    expect(layersStore.getState().saved).toBeNull();
    soloLayer('camera');
    soloLayer('lighting');
    expect(loadSettings().planLayers).toBeNull();
    soloLayer('lighting');
    expect(layersStore.getState().saved).toBeNull();
    expect(loadSettings().planLayers).toBeNull();
    // A solo row's own change is a choice: kept from then on.
    soloLayer('camera');
    setLayerLocked('camera', true);
    soloLayer('camera');
    expect(layersStore.getState().saved?.camera).toEqual({ show: 'shown', locked: true });
    expect(loadSettings().planLayers?.camera.locked).toBe(true);
  });
});

describe('the spoken lines (L3)', () => {
  it('a single control says nothing on either line; a change in the tile never speaks on the canvas’s line', () => {
    setLayerShow('lighting', 'hidden');
    expect(layersStore.getState().said.text).toBe('');
    setLayerLocked('grip', true);
    expect(layersStore.getState().said.text).toBe('');
    soloLayer('camera');
    // Said in one step, by the tile, so the canvas's line (by 'plan') reads nothing of it.
    expect(layersStore.getState().said).toEqual({ text: 'Camera layer solo, the others dimmed and locked', by: 'tile' });
    soloLayer('camera');
    showAllLayers();
    showAllLayers();
    // The same words twice change, so they are read out again.
    expect(layersStore.getState().said.text).not.toBe('All layers shown, none locked');
    expect(layersStore.getState().said.text.trim()).toBe('All layers shown, none locked');
  });

  it('a selection made anywhere clears the canvas’s layer words', () => {
    soloLayer('lighting', 'plan');
    expect(layersStore.getState().said).toEqual({ text: 'Lighting layer solo, the others dimmed and locked', by: 'plan' });
    planStore.getState().select('setup:x', ['a']);
    expect(layersStore.getState().said.text).toBe('');
  });
});

describe('a real settings save (L9, L8)', () => {
  it('keeps a row a newer version wrote, through a layer change', () => {
    const kept = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) });
    kept.set('storiiboard.settings', JSON.stringify({ planLayers: { ...ALL_SHOWN, rigging: { show: 'dimmed', locked: true, extra: 'x' } } }));
    reloadLayersForTests();
    setLayerShow('camera', 'hidden');
    soloLayer('cast');
    soloLayer('cast');
    showAllLayers();
    const after = JSON.parse(kept.get('storiiboard.settings') ?? '{}') as { planLayers: Record<string, unknown> };
    expect(after.planLayers.rigging).toEqual({ show: 'dimmed', locked: true, extra: 'x' });
    expect(after.planLayers.camera).toEqual({ show: 'shown', locked: false });
  });
});

describe('a camera’s later position (L14)', () => {
  it('is hidden and locked with the Camera layer', async () => {
    const { view } = await plan();
    await store.getState().apply(nextPositionChanges(records(), view, 'camera', { width: 0.5, depth: 0.5 }, null, 'camera-2'));
    const later = records()['camera-2'];
    if (!later) throw new Error('no later position');
    expect(itemLayer(records(), later)).toBe('camera');
    const shown = shownItems(records(), view.sceneId, view.setupId);
    expect(layeredItems(records(), shown, states({ camera: { show: 'hidden' } })).visible.map((i) => i.record.id)).not.toContain('camera-2');
    expect(layeredItems(records(), shown, states({ camera: { locked: true } })).looks.get('camera-2')).toEqual({ dim: false, locked: true });
  });
});

describe('snapping under the layers (L14)', () => {
  it('reaches a locked layer’s points, never a hidden one’s', async () => {
    const { view } = await plan();
    const shown = shownItems(records(), view.sceneId, view.setupId);
    const targetsWith = (s: PlanLayerStates) => {
      const layered = layeredItems(records(), shown, s);
      return planItemsBuilder()(layered.visible, 'metres', '#000', 'en', undefined, undefined, undefined, undefined, layered.looks).flatMap((item) => item.snapPoints ?? []);
    };
    // A point dragged 3 cm and 2 cm off the wall's end: drawn and locked, the wall still takes it; hidden, nothing does.
    const near = [{ x: 503, y: 2 }];
    expect(snapMoveByPoints(near, 0, 0, targetsWith(states({ 'set-art': { locked: true } })), undefined, 1, 'magnet', 10)).toEqual({ dx: -3, dy: -2 });
    expect(snapMoveByPoints(near, 0, 0, targetsWith(states({ 'set-art': { show: 'hidden' } })), undefined, 1, 'magnet', 10)).toEqual({ dx: 0, dy: 0 });
  });
});

describe('the layered items (L12)', () => {
  it('are the same objects after an edit elsewhere in the project, new once a mark’s layer changes', async () => {
    const { view } = await plan();
    const keepShown = shownItemsKeeper();
    const keep = layeredItemsKeeper();
    const hidden = states({ lighting: { show: 'hidden' } });
    const first = keep(records(), keepShown(records(), view.sceneId, view.setupId), hidden);
    expect(first.visible.map((i) => i.record.id)).not.toContain('light');
    // An unrelated edit: a new scene.
    await store.getState().apply([{ kind: 'create', record: { type: 'scene', parentId: project.projectId, sortKey: '2', props: { number: '2' } } }]);
    const again = keep(records(), keepShown(records(), view.sceneId, view.setupId), hidden);
    expect(again).toBe(first);
    expect(again.visible).toBe(first.visible);
    expect(again.looks).toBe(first.looks);
    // ANA's mark given the camera goes to the camera layer: worked out again.
    await store.getState().apply(markOwnerChanges(records(), view, ['mark'], { kind: 'camera', id: 'camera' }, markSizes()));
    const moved = keep(records(), keepShown(records(), view.sceneId, view.setupId), states({ lighting: { show: 'hidden' }, camera: { show: 'hidden' } }));
    expect(moved.visible.map((i) => i.record.id)).not.toContain('mark');
  });
});

describe('the flows that put items on hidden or locked layers', () => {
  it('a paste onto two hidden layers shows both, and names both (L4, L14)', async () => {
    await useAppStore();
    const { view } = await plan();
    planStore.getState().select(`setup:${view.setupId}`, ['camera', 'light']);
    expect(copyPlanSelection(view)).toBe(2);
    setLayerShow('camera', 'hidden');
    setLayerShow('lighting', 'hidden');
    noticeStore.setState({ message: null });
    await pastePlan(view, null);
    expect(layerStatesNow().camera).toEqual({ show: 'shown', locked: false });
    expect(layerStatesNow().lighting).toEqual({ show: 'shown', locked: false });
    expect(noticeStore.getState().message).toBe('2 layers shown so you can see what you’re working on: Camera and Lighting.');
    // Only locked: the words say unlocked, in the singular.
    setLayerLocked('cast', true);
    await placeMark(view, { x: 1, y: 1 }, project, store);
    expect(noticeStore.getState().message).toBe('Layer unlocked so you can pick what you’re working on: Cast.');
    // In Spanish, the plural too.
    setLocale('es');
    onTestFinished(() => {
      setLocale('en');
    });
    setLayerShow('camera', 'hidden');
    setLayerLocked('lighting', true);
    await pastePlan(view, null);
    expect(noticeStore.getState().message).toBe('Se mostraron y desbloquearon 2 capas para que veas y elijas con qué estás trabajando: Cámara y Iluminación.');
  });

  it('a pasted north the room has already selects the room’s own and shows its layer (L6)', async () => {
    await useAppStore();
    const { view } = await plan();
    expect(await placeIcon(view, NORTH_ICON, { x: 3, y: 3 }, project, store)).toBeNull();
    const north = Object.values(records()).find((r) => r.type === 'plan_item' && r.props.kind === 'north' && r.trashedAt === null);
    if (!north) throw new Error('no north');
    expect(layerOfItem(records(), north)).toBe('set-art');
    planStore.getState().select(`setup:${view.setupId}`, [north.id]);
    copyPlanSelection(view);
    setLayerShow('set-art', 'hidden');
    await pastePlan(view, null);
    expect(layerStatesNow()['set-art'].show).toBe('shown');
    expect(planStore.getState().selections[`setup:${view.setupId}`]).toEqual([north.id]);
  });

  it('"Start from another setup" shows the copies’ layers (L5)', async () => {
    await useAppStore();
    const { view } = await plan();
    const other = crypto.randomUUID();
    await store.getState().apply([{ kind: 'create', record: { id: other, type: 'setup', parentId: view.sceneId, sortKey: 'b', props: { name: '' } } }]);
    setLayerShow('lighting', 'hidden');
    noticeStore.setState({ message: null });
    expect(await copySetup({ sceneId: view.sceneId, setupId: other }, view.setupId)).toBe(true);
    expect(layerStatesNow().lighting.show).toBe('shown');
    expect(noticeStore.getState().message).toContain('Lighting');
  });

  it('"Open on the plan" shows and unlocks the camera’s layer before selecting it (M1)', async () => {
    await useAppStore();
    const { view } = await plan();
    setLayerShow('camera', 'hidden');
    setLayerLocked('camera', true);
    noticeStore.setState({ message: null });
    openCameraOnPlan(view.sceneId, view.setupId, 'camera');
    expect(layerStatesNow().camera).toEqual({ show: 'shown', locked: false });
    expect(planSelection(records(), view)).toEqual(['camera']);
    expect(noticeStore.getState().message).toBe('Layer shown and unlocked so you can see and pick what you’re working on: Camera.');
  });

  it('a selected mark given a locked layer’s camera leaves the selection (M1)', async () => {
    await useAppStore();
    const { view } = await plan();
    const key = `setup:${view.setupId}`;
    setLayerLocked('camera', true);
    planStore.getState().select(key, ['mark', 'sofa']);
    await store.getState().apply(markOwnerChanges(records(), view, ['mark'], { kind: 'camera', id: 'camera' }, markSizes()));
    expect(planStore.getState().selections[key]).toEqual(['sofa']);
  });

  it('a mark the person gives a locked layer’s camera in the Selection tile unlocks that layer and stays selected (L1)', async () => {
    await useAppStore();
    const { view } = await plan();
    const key = `setup:${view.setupId}`;
    setLayerLocked('camera', true);
    planStore.getState().select(key, ['mark']);
    noticeStore.setState({ message: null });
    expect(await setMarkOwner(view, ['mark'], { kind: 'camera', id: 'camera' })).toBe(true);
    expect(layerOfItem(records(), records().mark as never)).toBe('camera');
    expect(layerStatesNow().camera).toEqual({ show: 'shown', locked: false });
    expect(planStore.getState().selections[key]).toEqual(['mark']);
    expect(noticeStore.getState().message).toBe('Layer unlocked so you can pick what you’re working on: Camera.');
    // A layer locked afterwards, or an undo, still takes it out: that is no edit of the person's to that item.
    setLayerLocked('camera', true);
    expect(planStore.getState().selections[key]).toEqual([]);
  });

  it('a paste says what it left out and what it showed in one notice, in that order (L4)', async () => {
    await useAppStore();
    const { view } = await plan();
    expect(await placeIcon(view, NORTH_ICON, { x: 3, y: 3 }, project, store)).toBeNull();
    const north = Object.values(records()).find((r) => r.type === 'plan_item' && r.props.kind === 'north' && r.trashedAt === null);
    if (!north) throw new Error('no north');
    planStore.getState().select(`setup:${view.setupId}`, [north.id, 'light']);
    copyPlanSelection(view);
    setLayerShow('lighting', 'hidden');
    noticeStore.setState({ message: null });
    await pastePlan(view, null);
    expect(noticeStore.getState().message).toBe('This room has its north already: the copied north wasn’t pasted. Layer shown so you can see what you’re working on: Lighting.');
    // During a solo: the solo's end follows.
    soloLayer('camera');
    await pastePlan(view, null);
    expect(layersStore.getState().solo).toBeNull();
    expect(noticeStore.getState().message).toBe('This room has its north already: the copied north wasn’t pasted. Camera solo ended so you can pick what you’re working on.');
  });
});

describe('the starting state as the app reads it (L14)', () => {
  it('follows "This is me" until the first layer change, the settings untouched till then', async () => {
    memoryStorage();
    reloadLayersForTests();
    await useAppStore();
    await store.getState().apply([
      { kind: 'create', record: { id: 'sam', type: 'person', parentId: project.projectId, sortKey: 'a', props: { name: 'Sam Ortiz', role: 'gaffer' } } },
      { kind: 'create', record: { id: 'mia', type: 'person', parentId: project.projectId, sortKey: 'b', props: { name: 'Mia Ruiz', role: 'sound' } } },
    ]);
    const selves = projectSelfStore.getState();
    onTestFinished(() => {
      projectSelfStore.setState(selves, true);
    });
    projectSelfStore.setState({ [project.projectId]: 'sam' });
    const showing = (show: string) => PLAN_LAYERS.filter((l) => layerStatesNow()[l].show === show);
    expect(showing('shown')).toEqual(['lighting', 'grip']);
    expect(showing('dimmed')).toEqual(['camera', 'set-art', 'cast', 'sound', 'production']);
    expect(layersStore.getState().saved).toBeNull();
    expect(loadSettings().planLayers).toBeNull();
    // Another "This is me": the layers follow.
    projectSelfStore.setState({ [project.projectId]: 'mia' });
    expect(showing('shown')).toEqual(['sound']);
    // After a first change they are what was chosen, whoever this is.
    setLayerShow('cast', 'hidden');
    expect(loadSettings().planLayers?.cast.show).toBe('hidden');
    projectSelfStore.setState({ [project.projectId]: 'sam' });
    expect(showing('shown')).toEqual(['sound']);
  });
});
