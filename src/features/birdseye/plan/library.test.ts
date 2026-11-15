import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../../app/projectStore';
import { setLocale } from '../../../core/i18n';
import { iconFields, openingFields, planItemFields, planItemLayer, plansShown, sceneRoomId, setupPlanOf, shownItems, startRoomChanges } from '../../../core/model/plan';
import type { Props, SbdRecord } from '../../../core/model/record';
import { iconHome, itemHome, itemLevel, setRoomChanges, setupOnlyChanges } from '../../../core/model/planRooms';
import { loadRecords, log } from '../../../core/ops/ops';
import { nodeDriver } from '../../../core/storage/nodeDriver';
import { createProject, openProject, type Project } from '../../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../../core/storage/testFolder';
import { restoreChanges, trashItems } from '../../trash/trash';
import { boundsOf } from '../../../ui/canvas/hitTest';
import { fitBounds, unionBounds } from '../../../ui/canvas/viewport';
import { placeIcon } from './planActions';
import { anIcon, iconLabel } from './iconWords';
import { dropAt, libraryGroups, libraryState } from './library';
import {
  iconPatchChanges,
  iconPatchRefused,
  iconRefusal,
  planCanvasItems,
  planClipOf,
  planGeometryChanges,
  planItemsBuilder,
  planNudgeChanges,
  planPasteInView,
  placeIconChanges,
  trashPlanItemsChanges,
} from './planItems';
import { PLAN_ZOOM, planScale } from './planScale';

// The library (6.3): icons placed at their real sizes, at the level they belong to (a set piece in the room, so every
// scene and setup in it shows it; the rest in the setup shown, its plan made in the same step), edited, copied, sent
// to the Trash and back; an icon id this version doesn't know kept as it is; the Library's filter and what it says.

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
  setLocale('en');
  await store.getState().close();
  folder.remove();
});

const records = () => store.getState().records;
const groups = async () => (await log(project.file)).length;

/** A scene with two setups and its room started. */
async function scene(number = '4', name = 'Diner'): Promise<{ sceneId: string; roomId: string; setups: [string, string] }> {
  const sceneId = crypto.randomUUID();
  const setups: [string, string] = [crypto.randomUUID(), crypto.randomUUID()];
  await store.getState().apply([
    { kind: 'create', record: { id: sceneId, type: 'scene', parentId: project.projectId, sortKey: number, props: { number, name } } },
    { kind: 'create', record: { id: setups[0], type: 'setup', parentId: sceneId, sortKey: 'a', props: { name: '' } } },
    { kind: 'create', record: { id: setups[1], type: 'setup', parentId: sceneId, sortKey: 'b', props: { name: '' } } },
  ]);
  await store.getState().apply(startRoomChanges(records(), project.projectId, sceneId));
  return { sceneId, roomId: sceneRoomId(records(), records()[sceneId]) ?? '', setups };
}

describe('an icon’s level and layer', () => {
  it('follow its group: set pieces the room’s, cast the scene’s, the rest the setup’s; the layer is the group', () => {
    expect(iconHome('set-art/sofa')).toBe('room');
    expect(iconHome('cast/cast-mark')).toBe('blocking');
    for (const id of ['grip/c-stand', 'sound/boom', 'production/zone', 'camera/camera']) expect(iconHome(id)).toBe('setup');
    expect(itemHome({ kind: 'icon', icon: 'set-art/table' })).toBe('room');
    expect(itemHome({ kind: 'wall' })).toBe('room');
    expect(planItemLayer({ kind: 'icon', icon: 'grip/c-stand' })).toBe('grip');
    expect(planItemLayer({ kind: 'icon', icon: 'set-art/sofa' })).toBe('set-art');
    expect(planItemLayer({ kind: 'wall' })).toBe('set-art');
    expect(planItemLayer({ kind: 'icon', icon: 'nowhere/thing' })).toBeNull();
  });
});

describe('placing an icon', () => {
  it('puts a set piece in the room at its real size, its middle where it was dropped, in one step', async () => {
    const { sceneId, roomId, setups } = await scene();
    const view = { sceneId, setupId: setups[0] };
    const before = await groups();
    const id = crypto.randomUUID();
    await store.getState().apply(placeIconChanges(records(), view, 'set-art/sofa', { x: 1, y: 2 }, id));
    expect(await groups()).toBe(before + 1);
    expect(records()[id]?.parentId).toBe(roomId);
    expect(iconFields(records()[id]?.props ?? {})).toMatchObject({ icon: 'set-art/sofa', x: 0, y: 1.55, width: 2, height: 0.9, rotation: 0 });
    expect(itemLevel(records(), sceneId, setups[0], id)).toBe('room');
    // No setup plan was made for it.
    expect(setupPlanOf(records(), setups[0])).toBeNull();
  });

  it('puts a grip item in the setup shown, its plan made in the same step, and one undo takes both back', async () => {
    const { sceneId, setups } = await scene();
    const view = { sceneId, setupId: setups[0] };
    const before = await groups();
    const id = crypto.randomUUID();
    const changes = placeIconChanges(records(), view, 'grip/c-stand', { x: 0, y: 0 }, id);
    expect(changes.map((c) => c.kind)).toEqual(['create', 'create']);
    await store.getState().apply(changes);
    expect(await groups()).toBe(before + 1);
    const plan = setupPlanOf(records(), setups[0]);
    expect(records()[id]?.parentId).toBe(plan?.id);
    expect(iconFields(records()[id]?.props ?? {})).toMatchObject({ width: 0.9, height: 0.9, x: -0.45, y: -0.45 });
    // A second one goes into the plan already there.
    const second = placeIconChanges(records(), view, 'sound/boom', { x: 1, y: 1 });
    expect(second.map((c) => c.kind)).toEqual(['create']);
    await store.getState().undo();
    expect(records()[id]).toBeUndefined();
    expect(setupPlanOf(records(), setups[0])).toBeNull();
  });

  it('refuses a setup’s icon with only the scene shown, an icon not yet placeable, a tool’s icon, and anything without a room', async () => {
    const { sceneId, setups } = await scene();
    expect(iconRefusal(records(), { sceneId, setupId: null }, 'grip/c-stand')).toBe('noSetup');
    expect(iconRefusal(records(), { sceneId, setupId: null }, 'set-art/table')).toBeNull();
    // Cameras are placed from 6.4: lights still come later in the phase, and the field of view is never an item.
    expect(iconRefusal(records(), { sceneId, setupId: setups[0] }, 'lighting/fresnel')).toBe('coming');
    expect(iconRefusal(records(), { sceneId, setupId: setups[0] }, 'camera/field-of-view')).toBe('shown');
    expect(iconRefusal(records(), { sceneId, setupId: setups[0] }, 'set-art/wall')).toBe('tool');
    expect(placeIconChanges(records(), { sceneId, setupId: null }, 'grip/c-stand', { x: 0, y: 0 })).toEqual([]);
    expect(placeIconChanges(records(), { sceneId, setupId: setups[0] }, 'lighting/fresnel', { x: 0, y: 0 })).toEqual([]);
    const bare = crypto.randomUUID();
    await store.getState().apply([{ kind: 'create', record: { id: bare, type: 'scene', parentId: project.projectId, sortKey: 'z', props: { number: '9' } } }]);
    expect(iconRefusal(records(), { sceneId: bare, setupId: null }, 'set-art/table')).toBe('noRoom');
    expect(iconRefusal(records(), null, 'set-art/table')).toBe('noScene');
  });

  it('shows a set piece in every setup and in another scene set in the room; a setup’s icon only in its setup', async () => {
    const { sceneId, roomId, setups } = await scene();
    const sofa = crypto.randomUUID();
    const stand = crypto.randomUUID();
    await store.getState().apply(placeIconChanges(records(), { sceneId, setupId: setups[0] }, 'set-art/sofa', { x: 0, y: 0 }, sofa));
    await store.getState().apply(placeIconChanges(records(), { sceneId, setupId: setups[0] }, 'grip/c-stand', { x: 2, y: 0 }, stand));
    const ids = (setupId: string | null, scene = sceneId) => shownItems(records(), scene, setupId).map((i) => i.record.id);
    expect(ids(setups[0])).toEqual([sofa, stand]);
    expect(ids(setups[1])).toEqual([sofa]);
    expect(ids(null)).toEqual([sofa]);
    // A second scene set in the same room sees the sofa.
    const other = crypto.randomUUID();
    await store.getState().apply([{ kind: 'create', record: { id: other, type: 'scene', parentId: project.projectId, sortKey: '7', props: { number: '7' } } }]);
    await store.getState().apply(setRoomChanges(records(), other, roomId));
    expect(ids(null, other)).toEqual([sofa]);
    // "This setup only" takes the sofa out of the other setup and the other scene; off, it's back.
    await store.getState().apply(setupOnlyChanges(records(), sceneId, setups[0], [sofa], true));
    expect(ids(setups[1])).toEqual([]);
    expect(ids(null, other)).toEqual([]);
    expect(ids(setups[0])).toContain(sofa);
    await store.getState().apply(setupOnlyChanges(records(), sceneId, setups[0], [sofa], false));
    expect(records()[sofa]?.parentId).toBe(roomId);
    // A setup's own icon has no level to go back to: off changes nothing.
    expect(setupOnlyChanges(records(), sceneId, setups[0], [stand], false)).toEqual([]);
  });
});

describe('an icon on the canvas', () => {
  it('is drawn at its real size, keeps its proportions but for a zone and a note, and is named aloud', async () => {
    const { sceneId, setups } = await scene();
    const sofa = crypto.randomUUID();
    const zone = crypto.randomUUID();
    await store.getState().apply(placeIconChanges(records(), { sceneId, setupId: setups[0] }, 'set-art/sofa', { x: 0, y: 0 }, sofa));
    await store.getState().apply(placeIconChanges(records(), { sceneId, setupId: setups[0] }, 'production/zone', { x: 3, y: 3 }, zone));
    const items = planCanvasItems(records(), sceneId, setups[0], 'metres', '#16150F');
    expect(items.find((i) => i.id === sofa)).toMatchObject({ x: -100, y: -45, width: 200, height: 90, rotation: 0, keepRatio: true, label: 'Sofa, 2.00 m by 0.90 m' });
    expect(items.find((i) => i.id === zone)?.keepRatio).toBeUndefined();
  });

  it('is made again only when its own record changes', async () => {
    const { sceneId, setups } = await scene();
    const sofa = crypto.randomUUID();
    const table = crypto.randomUUID();
    const view = { sceneId, setupId: setups[0] };
    await store.getState().apply(placeIconChanges(records(), view, 'set-art/sofa', { x: 0, y: 0 }, sofa));
    await store.getState().apply(placeIconChanges(records(), view, 'set-art/table', { x: 3, y: 0 }, table));
    const build = planItemsBuilder();
    const first = build(shownItems(records(), sceneId, setups[0]), 'metres', '#16150F');
    await store.getState().apply(iconPatchChanges(records(), [sofa], { name: 'Hero couch' }));
    const second = build(shownItems(records(), sceneId, setups[0]), 'metres', '#16150F');
    expect(second.find((i) => i.id === table)).toBe(first.find((i) => i.id === table));
    expect(second.find((i) => i.id === sofa)).not.toBe(first.find((i) => i.id === sofa));
    expect(second.find((i) => i.id === sofa)?.label).toBe('Hero couch, Sofa, 2.00 m by 0.90 m');
  });

  it('moves, turns and resizes in metres; nudges by a centimetre; and a typed size keeps its middle', async () => {
    const { sceneId, setups } = await scene();
    const id = crypto.randomUUID();
    await store.getState().apply(placeIconChanges(records(), { sceneId, setupId: setups[0] }, 'set-art/table', { x: 0, y: 0 }, id));
    const fields = () => iconFields(records()[id]?.props ?? {});
    expect(planGeometryChanges(records(), [{ id, x: -75, y: -40, width: 150, height: 80, rotation: 0 }])).toEqual([]);
    await store.getState().apply(planGeometryChanges(records(), [{ id, x: 25, y: -40, width: 150, height: 80, rotation: 90 }]));
    expect(fields()).toMatchObject({ x: 0.25, y: -0.4, rotation: 90 });
    await store.getState().apply(planNudgeChanges(records(), [id], 1, 0));
    expect(fields()?.x).toBe(0.26);
    await store.getState().apply(iconPatchChanges(records(), [id], { width: 2, depth: 1 }));
    // Its middle (1.01, 0) stays.
    expect(fields()).toMatchObject({ x: 0.01, y: -0.5, width: 2, height: 1 });
    await store.getState().apply(iconPatchChanges(records(), [id], { centreX: 3, heightM: 0.75, rotation: 45 }));
    expect(fields()).toMatchObject({ x: 2, heightM: 0.75, rotation: 45 });
    expect(iconPatchChanges(records(), [id], { centreX: 3, heightM: 0.75 })).toEqual([]);
  });

  it('keeps an icon this version doesn’t know: drawn as an outline, its record untouched by a view or a copy', async () => {
    const { sceneId, roomId, setups } = await scene();
    const id = crypto.randomUUID();
    const props = { kind: 'icon', icon: 'set-art/grand-piano', x: 0, y: 0, width: 1.6, height: 1.5, rotation: 0, finish: 'gloss' };
    await store.getState().apply([{ kind: 'create', record: { id, type: 'plan_item', parentId: roomId, sortKey: 'm', props } }]);
    const item = planCanvasItems(records(), sceneId, setups[0], 'metres', '#16150F').find((i) => i.id === id);
    expect(item).toMatchObject({ width: 160, height: 150, label: 'Unknown plan item (set-art/grand-piano), 1.60 m by 1.50 m' });
    expect(item?.keepRatio).toBeUndefined();
    expect(records()[id]?.props).toEqual(props);
    const clip = planClipOf(records(), [id]);
    expect(clip[0]?.props).toEqual(props);
    expect(anIcon('set-art/grand-piano')).toBe('a plan item');
  });
});

describe('copies and the Trash', () => {
  it('pastes a set piece back into the room and a grip item into the setup shown, its plan made with the paste', async () => {
    const { sceneId, roomId, setups } = await scene();
    const sofa = crypto.randomUUID();
    const stand = crypto.randomUUID();
    await store.getState().apply(placeIconChanges(records(), { sceneId, setupId: setups[0] }, 'set-art/sofa', { x: 0, y: 0 }, sofa));
    await store.getState().apply(placeIconChanges(records(), { sceneId, setupId: setups[0] }, 'grip/c-stand', { x: 2, y: 0 }, stand));
    const clip = planClipOf(records(), [sofa, stand]);
    // Into the other setup, which has no plan of its own yet.
    const pasted = planPasteInView(records(), { sceneId, setupId: setups[1] }, clip, null);
    expect(pasted.leftOut).toBe(0);
    await store.getState().apply(pasted.changes);
    const [sofaCopy = '', standCopy = ''] = pasted.ids;
    expect(records()[sofaCopy]?.parentId).toBe(roomId);
    expect(records()[standCopy]?.parentId).toBe(setupPlanOf(records(), setups[1])?.id);
    expect(iconFields(records()[sofaCopy]?.props ?? {})?.x).toBeCloseTo(-0.84, 6);
    // With only the scene shown, the C-stand has nowhere to go and is left out, said.
    const scenePaste = planPasteInView(records(), { sceneId, setupId: null }, clip, null);
    expect(scenePaste.leftOut).toBe(1);
    expect(scenePaste.ids).toHaveLength(1);
  });

  it('go to the Trash, listed by what they are and where, and come back', async () => {
    const { sceneId, setups } = await scene();
    const sofa = crypto.randomUUID();
    const stand = crypto.randomUUID();
    await store.getState().apply(placeIconChanges(records(), { sceneId, setupId: setups[0] }, 'set-art/sofa', { x: 0, y: 0 }, sofa));
    await store.getState().apply(placeIconChanges(records(), { sceneId, setupId: setups[0] }, 'grip/c-stand', { x: 2, y: 0 }, stand));
    await store.getState().apply(trashPlanItemsChanges(records(), [sofa, stand]));
    expect(shownItems(records(), sceneId, setups[0])).toEqual([]);
    const listed = trashItems(records(), project.projectId).map((row) => row.name).sort();
    expect(listed).toEqual(['C-stand', 'Sofa in Diner']);
    await store.getState().apply(restoreChanges(records(), project.projectId, sofa));
    expect(shownItems(records(), sceneId, setups[1]).map((i) => i.record.id)).toEqual([sofa]);
    expect(plansShown(records(), sceneId, setups[0]).setup).not.toBeNull();
  });
});

describe('the Library', () => {
  it('lists the icons by department in call-sheet order, and narrows them by name in the app’s language', () => {
    expect(libraryGroups('').map((g) => g.group)).toEqual(['camera', 'lighting', 'grip', 'set-art', 'sound', 'production', 'cast']);
    expect(libraryGroups('').flatMap((g) => g.entries)).toHaveLength(68);
    expect(libraryGroups('sofa').flatMap((g) => g.entries.map((e) => e.icon.id))).toEqual(['set-art/sofa']);
    expect(libraryGroups('STAND').flatMap((g) => g.entries.map((e) => e.icon.id))).toEqual(['grip/c-stand', 'grip/combo-stand']);
    expect(libraryGroups('nothing called this')).toEqual([]);
    setLocale('es');
    expect(iconLabel('set-art/sofa')).toBe('Sofá');
    // Accents aside, and the kit's English title still finds it.
    expect(libraryGroups('sofa').flatMap((g) => g.entries.map((e) => e.icon.id))).toEqual(['set-art/sofa']);
    expect(libraryGroups('mesa').flatMap((g) => g.entries.map((e) => e.icon.id))).toEqual(['set-art/table']);
    expect(libraryGroups('table').flatMap((g) => g.entries.map((e) => e.icon.id))).toEqual(['set-art/table']);
  });

  it('says when nothing is shown, when the scene has no room, and when no setup is picked', async () => {
    expect(libraryState(records(), null)).toEqual({ kind: 'noView' });
    const bare = crypto.randomUUID();
    await store.getState().apply([{ kind: 'create', record: { id: bare, type: 'scene', parentId: project.projectId, sortKey: 'z', props: { number: '9' } } }]);
    expect(libraryState(records(), { sceneId: bare, setupId: null })).toEqual({ kind: 'noRoom', scene: 'SC 09' });
    const { sceneId, setups } = await scene();
    expect(libraryState(records(), { sceneId, setupId: null })).toEqual({ kind: 'noSetup' });
    expect(libraryState(records(), { sceneId, setupId: setups[0] })).toEqual({ kind: 'ready' });
  });

  it('lands a dropped icon at its real size under the pointer, pulled onto the grid', () => {
    const view = { cx: 0, cy: 0, zoom: 1, width: 800, height: 600 };
    const { grid } = planScale('metres');
    // The pointer 3 px off the middle: the sofa's left edge (-97 cm) pulls onto the -100 cm line, its top (-45) onto -50.
    const spot = dropAt('set-art/sofa', { x: 403, y: 300 }, view, grid, 'magnet');
    expect(spot?.centre).toEqual({ x: 0, y: -0.05 });
    expect(spot?.screen).toMatchObject({ width: 200, height: 90 });
    expect(dropAt('set-art/sofa', { x: 403, y: 300 }, view, grid, 'off')?.centre).toEqual({ x: 0.03, y: 0 });
    expect(dropAt('lighting/fresnel', { x: 400, y: 300 }, view, grid, 'magnet')).toBeNull();
  });
});

// 6.3 review.
describe('a drop and the project it began in', () => {
  const sofasIn = (list: readonly SbdRecord[]) => list.filter((r) => r.type === 'plan_item' && r.trashedAt === null && r.props.kind === 'icon').length;

  it('writes nothing to either file when it ends after a switch to a copy with the same ids', async () => {
    const { sceneId, setups } = await scene();
    const madeIn = store.getState().project;
    // A copy keeps every id, as Open version and Open backup do; opened, it replaces the original.
    const copyPath = folder.path('Bey County (copy).sbd');
    await project.file.saveCopy(copyPath);
    const copy = await openProject(copyPath, { driver: nodeDriver, backups: false });
    await store.getState().open(copy);
    const copyGroups = (await log(copy.file)).length;
    // The drag began in the original and is let go now.
    expect(await placeIcon({ sceneId, setupId: setups[0] }, 'set-art/sofa', { x: 0, y: 0 }, madeIn, store)).toBe('otherProject');
    expect(sofasIn(Object.values(store.getState().records))).toBe(0);
    expect((await log(copy.file)).length).toBe(copyGroups);
    await store.getState().close();
    const original = await openProject(project.file.path, { driver: nodeDriver, backups: false });
    try {
      expect(sofasIn(await loadRecords(original.file))).toBe(0);
    } finally {
      await original.close();
    }
  });

  it('writes the icon in the project it began in, in one step', async () => {
    const { sceneId, setups } = await scene();
    const before = await groups();
    expect(await placeIcon({ sceneId, setupId: setups[0] }, 'set-art/sofa', { x: 0, y: 0 }, store.getState().project, store)).toBeNull();
    expect(await groups()).toBe(before + 1);
    expect(sofasIn(Object.values(records()))).toBe(1);
    // With no project open when the press began, nothing.
    expect(await placeIcon({ sceneId, setupId: setups[0] }, 'set-art/sofa', { x: 0, y: 0 }, null, store)).toBe('otherProject');
  });
});

describe('reading an icon (6.3 review)', () => {
  const base: Props = { kind: 'icon', icon: 'set-art/sofa', x: 0, y: 0, width: 2, height: 0.9, rotation: 0 };
  const without = (prop: string): Props => Object.fromEntries(Object.entries(base).filter(([key]) => key !== prop));

  it('needs a place and a size above nothing, as numbers', () => {
    expect(iconFields(base)).not.toBeNull();
    for (const prop of ['x', 'y', 'width', 'height']) {
      expect(iconFields(without(prop)), `missing ${prop}`).toBeNull();
      expect(iconFields({ ...base, [prop]: '1' }), `text ${prop}`).toBeNull();
      expect(iconFields({ ...base, [prop]: null }), `null ${prop}`).toBeNull();
    }
    for (const prop of ['width', 'height']) {
      expect(iconFields({ ...base, [prop]: 0 }), `zero ${prop}`).toBeNull();
      expect(iconFields({ ...base, [prop]: -1 }), `negative ${prop}`).toBeNull();
    }
    // A place may be negative or nought; a missing rotation is none.
    expect(iconFields({ ...without('rotation'), x: -3, y: 0 })).toMatchObject({ x: -3, y: 0, rotation: 0 });
    expect(iconFields({ ...base, icon: '  ' })).toBeNull();
  });

  it('takes its icon id trimmed everywhere: its drawing, its level and its layer', () => {
    const spaced = { ...base, icon: ' set-art/sofa ' };
    expect(iconFields(spaced)?.icon).toBe('set-art/sofa');
    expect(itemHome(spaced)).toBe('room');
    expect(planItemLayer(spaced)).toBe('set-art');
    expect(itemHome({ ...base, icon: ' grip/c-stand' })).toBe('setup');
  });

  it('names an id this version doesn’t have as an unknown plan item, in the app’s language', () => {
    expect(iconLabel('set-art/grand-piano')).toBe('Unknown plan item (set-art/grand-piano)');
    setLocale('es');
    expect(iconLabel('set-art/grand-piano')).toBe('Elemento de la planta desconocido (set-art/grand-piano)');
  });

  it('keeps an item placed or sized past the plan’s reach unread and untouched, and Fit still finds a view', async () => {
    const { sceneId, roomId, setups } = await scene();
    const far = crypto.randomUUID();
    const huge = crypto.randomUUID();
    const wall = crypto.randomUUID();
    const door = crypto.randomUUID();
    const sofa = crypto.randomUUID();
    const good = crypto.randomUUID();
    const farProps = { ...base, x: 1e308 };
    const hugeProps = { ...base, width: 1e308 };
    const wallProps = { kind: 'wall', x: 0, y: 0, width: 2000, height: 0.1, rotation: 0 };
    await store.getState().apply([
      { kind: 'create', record: { id: far, type: 'plan_item', parentId: roomId, sortKey: 'm', props: farProps } },
      { kind: 'create', record: { id: huge, type: 'plan_item', parentId: roomId, sortKey: 'n', props: hugeProps } },
      { kind: 'create', record: { id: wall, type: 'plan_item', parentId: roomId, sortKey: 'o', props: wallProps } },
      { kind: 'create', record: { id: sofa, type: 'plan_item', parentId: roomId, sortKey: 'p', props: base } },
      { kind: 'create', record: { id: good, type: 'plan_item', parentId: roomId, sortKey: 'q', props: { kind: 'wall', x: 0, y: 5, width: 4, height: 0.1, rotation: 0 } } },
      // A door far along a wall that reads.
      { kind: 'create', record: { id: door, type: 'plan_item', parentId: roomId, sortKey: 'r', props: { kind: 'door', wall_id: good, along_m: 1e308, width_m: 0.9 } } },
    ]);
    expect(iconFields(farProps)).toBeNull();
    expect(iconFields({ ...base, y: -10001 })).toBeNull();
    expect(iconFields({ ...base, x: 9999 })).not.toBeNull();
    expect(iconFields(hugeProps)).toBeNull();
    expect(iconFields({ ...base, height: 1000.5 })).toBeNull();
    expect(planItemFields(wallProps)).toBeNull();
    expect(planItemFields({ ...wallProps, width: 4, height: 1e300 })).toBeNull();
    expect(openingFields({ kind: 'window', wall_id: good, along_m: 1, width_m: 5000 })).toBeNull();
    expect(shownItems(records(), sceneId, setups[0]).map((i) => i.record.id).sort()).toEqual([sofa, good].sort());
    // Fit to view over the plan: a finite view.
    const items = planCanvasItems(records(), sceneId, setups[0], 'metres', '#16150F');
    const fit = fitBounds(unionBounds(items.map(boundsOf)), { width: 800, height: 600 }, 48, PLAN_ZOOM.fitMax, PLAN_ZOOM);
    for (const value of [fit.cx, fit.cy, fit.zoom]) expect(Number.isFinite(value)).toBe(true);
    // Kept as they are, and nothing changes them: a nudge, a copy.
    expect(records()[far]?.props).toEqual(farProps);
    expect(planNudgeChanges(records(), [far, huge, wall, door], 1, 0)).toEqual([]);
    expect(planClipOf(records(), [far, huge, wall])).toEqual([]);
  });
});

describe('typed sizes (6.3 review)', () => {
  it('refuse a width or depth under a centimetre, or past the plan’s size, writing nothing', async () => {
    const { sceneId, setups } = await scene();
    const id = crypto.randomUUID();
    await store.getState().apply(placeIconChanges(records(), { sceneId, setupId: setups[0] }, 'set-art/table', { x: 0, y: 0 }, id));
    expect(iconPatchRefused(records(), [id], { width: 0.005 })).toBe(true);
    expect(iconPatchChanges(records(), [id], { width: 0.005 })).toEqual([]);
    expect(iconPatchChanges(records(), [id], { depth: 0.009 })).toEqual([]);
    expect(iconPatchChanges(records(), [id], { width: 2000 })).toEqual([]);
    expect(iconPatchChanges(records(), [id], { centreX: 20000 })).toEqual([]);
    // A centimetre is taken, its middle kept.
    expect(iconPatchRefused(records(), [id], { width: 0.01 })).toBe(false);
    await store.getState().apply(iconPatchChanges(records(), [id], { width: 0.01 }));
    expect(iconFields(records()[id]?.props ?? {})).toMatchObject({ width: 0.01, x: -0.005 });
  });

  it('go to every selected icon in one step', async () => {
    const { sceneId, setups } = await scene();
    const view = { sceneId, setupId: setups[0] };
    const table = crypto.randomUUID();
    const sofa = crypto.randomUUID();
    await store.getState().apply(placeIconChanges(records(), view, 'set-art/table', { x: 0, y: 0 }, table));
    await store.getState().apply(placeIconChanges(records(), view, 'set-art/sofa', { x: 4, y: 0 }, sofa));
    const before = await groups();
    const changes = iconPatchChanges(records(), [table, sofa], { width: 3, rotation: 30 });
    expect(changes).toHaveLength(2);
    await store.getState().apply(changes);
    expect(await groups()).toBe(before + 1);
    expect(iconFields(records()[table]?.props ?? {})).toMatchObject({ width: 3, x: -1.5, rotation: 30 });
    expect(iconFields(records()[sofa]?.props ?? {})).toMatchObject({ width: 3, x: 2.5, rotation: 30 });
    // One that refuses refuses the step for all.
    expect(iconPatchChanges(records(), [table, sofa], { depth: 0 })).toEqual([]);
    await store.getState().undo();
    expect(iconFields(records()[sofa]?.props ?? {})?.width).toBe(2);
  });
});
