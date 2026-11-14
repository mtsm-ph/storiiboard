import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setPlanUnitsChoice } from '../../../app/planUnits';
import { createProjectStore } from '../../../app/projectStore';
import { setLocale } from '../../../core/i18n';
import { readOriginal, type PreparedImage } from '../../../core/media/store';
import { MEASURE_THICKNESS, measureFields, planItemLayer, scaledUnderlay, sceneRoomId, shownItems, startRoomChanges, underlayFields, wallEnds, type Point } from '../../../core/model/plan';
import { ALL_SHOWN, layeredItems, layerOfItem, layerPickable, pickableIds, soloStates, UNDERLAY_ROW, UNDERLAY_START } from '../../../core/model/planLayers';
import { kindHome, separateCopyChanges, setupOnlyChanges } from '../../../core/model/planRooms';
import type { SbdRecord } from '../../../core/model/record';
import { importProjectJson, projectJsonBytes, readProjectJson } from '../../../core/storage/projectJson';
import { nodeDriver } from '../../../core/storage/nodeDriver';
import { createProject, openProject, type Project } from '../../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../../core/storage/testFolder';
import { nextPoint, NO_MODS, runClick, runKey, runStart } from '../../../ui/canvas/pathRun';
import { loadSteps } from '../../history/steps';
import { lineText } from '../../history/summary';
import { restoreChanges, trashItems } from '../../trash/trash';
import { layersStore, layerStatesNow, setLayerLocked, showAllLayers, soloLayer } from './layersStore';
import {
  drawMeasuresChanges,
  drawWallsChanges,
  measureItem,
  measurePatchChanges,
  measurePatchRefused,
  planClipOf,
  planGeometryChanges,
  planItemsBuilder,
  planPasteInView,
  trashPlanItemsChanges,
  unreadableAfter,
} from './planItems';
import { planScale, toCanvas } from './planScale';
import { planStore } from './planStore';
import { addUnderlayChanges, scaleTarget, setScaleChanges, underlayPictures, underlaySize, unscaledIn } from './underlayEdits';

// The room's underlays and measures (6.9, docs/PHASE6_DECISIONS.md 12): the set-scale maths, the underlay drawn beneath
// everything, dimmed and locked by its own row until it is unlocked, its picture stored as a board's, a room copy giving
// its copy a picture record of its own naming the same stored picture; measures drawn point to point as walls are, their
// fields, History in both languages, the Trash and the lossless JSON round trip.

function image(seed: number, width = 2000, height = 1000): PreparedImage {
  const bytes = new Uint8Array(3000).map((_, i) => (i * seed) % 256);
  return {
    original: { sha256: createHash('sha256').update(bytes).digest('hex'), bytes, mime: 'image/jpeg', width, height, colorSpace: 'srgb' },
    thumbnail: { bytes: bytes.slice(0, 300), mime: 'image/jpeg', width: 640, height: Math.round((640 * height) / width), longEdge: 640 },
  };
}

let folder: TestFolder;
let project: Project;
let store = createProjectStore();
beforeEach(async () => {
  setLocale('en');
  setPlanUnitsChoice('metres');
  layersStore.setState({ saved: null, solo: null });
  planStore.setState({ selections: {}, clipboard: [] });
  folder = makeTestFolder();
  project = await createProject(folder.path('Diner.sbd'), { driver: nodeDriver, backups: false });
  store = createProjectStore();
  await store.getState().open(project);
});
afterEach(async () => {
  layersStore.setState({ saved: null, solo: null });
  setPlanUnitsChoice('region');
  await store.getState().close();
  folder.remove();
});

const records = () => store.getState().records;

/** Scene 1 with a setup and its room, named Diner. */
async function scene(number = '1') {
  const sceneId = crypto.randomUUID();
  const setupId = crypto.randomUUID();
  await store.getState().apply([
    { kind: 'create', record: { id: sceneId, type: 'scene', parentId: project.projectId, sortKey: number, props: { number, name: 'Diner' } } },
    { kind: 'create', record: { id: setupId, type: 'setup', parentId: sceneId, sortKey: 'a', props: { name: '' } } },
  ]);
  await store.getState().apply(startRoomChanges(records(), project.projectId, sceneId));
  return { sceneId, setupId, view: { sceneId, setupId }, roomId: sceneRoomId(records(), records()[sceneId]) ?? '' };
}

/** A picture 2000 × 1000 added under the scene's room, its middle at the origin. */
async function addUnderlay(sceneId: string, seed = 3) {
  const made = addUnderlayChanges(records(), sceneId, { image: image(seed), source: { name: `plan-${String(seed)}.jpg`, path: folder.path(`refs/plan-${String(seed)}.jpg`) } }, { x: 0, y: 0 }, project.file.path);
  await store.getState().apply(made.changes, { alsoWrite: made.alsoWrite });
  return made.id;
}

const fieldsOf = (id: string) => underlayFields(records()[id]?.props ?? {});
const lines = async () => (await loadSteps(project.file, Number.MAX_SAFE_INTEGER)).steps.map((s) => lineText(s.line)).reverse();

describe('set scale (the maths)', () => {
  const box = { x: -5, y: -2.5, width: 10, height: 5, rotation: 0 };
  // The picture drawn 10 m wide; two points 200 px apart on a 2000 px picture are 1 m apart on the plan.
  const a = { x: -5 + 10 * (400 / 2000), y: 0 };
  const b = { x: -5 + 10 * (600 / 2000), y: 0 };

  it('scales about the first point so the typed distance is true', () => {
    const next = scaledUnderlay(box, a, b, 3.5);
    expect(next?.width).toBeCloseTo(35, 4);
    expect(next?.height).toBeCloseTo(17.5, 4);
    expect(next?.rotation).toBe(0);
    // The first point is where it was on the plan, and at the same place on the picture (a fifth of its width in).
    if (!next) throw new Error('no scale');
    expect(next.x + next.width * (400 / 2000)).toBeCloseTo(a.x, 3);
    expect(next.y + next.height / 2).toBeCloseTo(a.y, 3);
    // The second is now the typed distance from it.
    expect(next.width * (200 / 2000)).toBeCloseTo(3.5, 4);
  });

  it('keeps a turned underlay turned, its first point still', () => {
    const turned = { ...box, rotation: 30 };
    // A point on the picture, turned with it about its middle.
    const local = (u: number, v: number, g: typeof box): Point => {
      const cx = g.x + g.width / 2;
      const cy = g.y + g.height / 2;
      const dx = (u - 0.5) * g.width;
      const dy = (v - 0.5) * g.height;
      const r = (g.rotation * Math.PI) / 180;
      return { x: cx + dx * Math.cos(r) - dy * Math.sin(r), y: cy + dx * Math.sin(r) + dy * Math.cos(r) };
    };
    const p = local(0.2, 0.3, turned);
    const q = local(0.6, 0.3, turned);
    const next = scaledUnderlay(turned, p, q, 2);
    if (!next) throw new Error('no scale');
    expect(next.rotation).toBe(30);
    const after = local(0.2, 0.3, next);
    expect(after.x).toBeCloseTo(p.x, 3);
    expect(after.y).toBeCloseTo(p.y, 3);
    const other = local(0.6, 0.3, next);
    expect(Math.hypot(other.x - after.x, other.y - after.y)).toBeCloseTo(2, 3);
  });

  it('refuses a zero distance, points on top of each other, and what would be past the plan’s size', () => {
    expect(scaledUnderlay(box, a, b, 0)).toBeNull();
    expect(scaledUnderlay(box, a, b, -1)).toBeNull();
    expect(scaledUnderlay(box, a, b, Number.NaN)).toBeNull();
    expect(scaledUnderlay(box, a, a, 3)).toBeNull();
    expect(scaledUnderlay(box, a, b, 1e9)).toBeNull();
  });

  it('is one op group writing `scaled` and the distance, and refuses an unreadable length', async () => {
    const { sceneId, roomId } = await scene();
    const id = await addUnderlay(sceneId);
    expect(unscaledIn(records(), roomId)).toBe(true);
    // An unreadable length reads as nothing (the Plan tile's question refuses it in words), so nothing is written.
    const { parse } = planScale('metres');
    expect(parse('four metres')).toBeNull();
    expect(setScaleChanges(records(), id, a, b, 0)).toEqual([]);
    const changes = setScaleChanges(records(), id, a, b, 3.5);
    await store.getState().apply(changes);
    expect(fieldsOf(id)).toMatchObject({ scaled: true, scaleM: 3.5 });
    expect(fieldsOf(id)?.width).toBeCloseTo(35, 4);
    expect(unscaledIn(records(), roomId)).toBe(false);
    await store.getState().undo();
    expect(fieldsOf(id)).toMatchObject({ scaled: false, width: 10 });
  });
});

describe('an underlay', () => {
  it('is added under the room with its picture stored as a board’s, its longer side 10 m', async () => {
    const { sceneId, roomId, setupId } = await scene();
    const id = await addUnderlay(sceneId);
    const record = records()[id];
    expect(record?.parentId).toBe(roomId);
    expect(fieldsOf(id)).toMatchObject({ kind: 'underlay', x: -5, y: -2.5, width: 10, height: 5, rotation: 0, scaled: false });
    expect(underlaySize(0.5)).toEqual({ width: 5, height: 10 });
    const mediaId = fieldsOf(id)?.mediaId ?? '';
    const media = records()[mediaId];
    expect(media?.parentId).toBe(id);
    expect(media?.props).toMatchObject({ kind: 'image', file: image(3).original.sha256, source_name: 'plan-3.jpg', source_path: 'refs/plan-3.jpg' });
    expect((await readOriginal(project.file, image(3).original.sha256))?.bytes.length).toBe(3000);
    // Shown in every view of the room: the scene's, its setup's.
    expect(shownItems(records(), sceneId, null).map((i) => i.record.id)).toContain(id);
    expect(shownItems(records(), sceneId, setupId).find((i) => i.record.id === id)?.level).toBe('room');
    expect(underlayPictures(records(), shownItems(records(), sceneId, setupId)).get(mediaId)).toBe(image(3).original.sha256);
  });

  it('is the room’s, on its own row, never a department’s layer', () => {
    expect(kindHome('underlay')).toBe('room');
    expect(kindHome('measure')).toBe('room');
    expect(planItemLayer({ kind: 'underlay' })).toBeNull();
    expect(planItemLayer({ kind: 'measure' })).toBe('production');
  });

  it('draws beneath everything, dimmed and locked by default, editable once its row is unlocked', async () => {
    const { sceneId, setupId, view } = await scene();
    const walls = drawWallsChanges(records(), sceneId, [
      { x: -100, y: 0 },
      { x: 100, y: 0 },
    ]);
    await store.getState().apply(walls.changes);
    const id = await addUnderlay(sceneId);
    const shown = shownItems(records(), sceneId, setupId);
    const record = records()[id] as SbdRecord;
    expect(layerOfItem(records(), record)).toBe(UNDERLAY_ROW);
    expect(ALL_SHOWN.underlay).toEqual(UNDERLAY_START);
    expect(UNDERLAY_START).toEqual({ show: 'dimmed', locked: true });
    const layered = layeredItems(records(), shown, ALL_SHOWN);
    expect(layered.looks.get(id)).toEqual({ dim: true, locked: true });
    const items = planItemsBuilder()(layered.visible, 'metres', '#000', 'en', new Map(), new Map(), new Map(), undefined, layered.looks, underlayPictures(records(), shown));
    // Under the wall drawn before it, dimmed and never picked.
    expect(items[0]?.id).toBe(id);
    expect(items[0]).toMatchObject({ dim: true, locked: true, keepRatio: true });
    expect(pickableIds(records(), [id, walls.ids[0] ?? ''], ALL_SHOWN)).toEqual([walls.ids[0]]);
    // Unlocked in the Layers tile: picked, moved and resized as a box, deleted to the Trash.
    setLayerLocked(UNDERLAY_ROW, false);
    expect(layerPickable(layerStatesNow(), UNDERLAY_ROW)).toBe(true);
    expect(pickableIds(records(), [id], layerStatesNow())).toEqual([id]);
    await store.getState().apply(planGeometryChanges(records(), [{ id, x: 100, y: 50, width: 2000, height: 1000, rotation: 15 }]));
    expect(fieldsOf(id)).toMatchObject({ x: 1, y: 0.5, width: 20, height: 10, rotation: 15 });
    await store.getState().apply(trashPlanItemsChanges(records(), [id]));
    expect(shownItems(records(), sceneId, setupId).some((i) => i.record.id === id)).toBe(false);
    expect(trashItems(records(), project.projectId).map((r) => r.name)).toEqual(['Underlay in Diner']);
    await store.getState().apply(restoreChanges(records(), project.projectId, id));
    expect(records()[id]?.trashedAt).toBeNull();
    expect(view.setupId).toBe(setupId);
  });

  it('keeps its own lock through Show all, and a solo dims and locks it', () => {
    setLayerLocked(UNDERLAY_ROW, false);
    expect(layerStatesNow().underlay.locked).toBe(false);
    setLayerLocked(UNDERLAY_ROW, true);
    setLayerLocked('camera', true);
    showAllLayers();
    expect(layerStatesNow().camera).toEqual({ show: 'shown', locked: false });
    expect(layerStatesNow().underlay).toEqual({ show: 'dimmed', locked: true });
    setLayerLocked(UNDERLAY_ROW, false);
    showAllLayers();
    // Never locked again, nor unlocked, by Show all: its own state.
    expect(layerStatesNow().underlay.locked).toBe(false);
    soloLayer('camera');
    expect(layerStatesNow().underlay).toEqual({ show: 'dimmed', locked: true });
    expect(soloStates(ALL_SHOWN, 'camera').underlay).toEqual({ show: 'dimmed', locked: true });
    soloLayer('camera');
    expect(layerStatesNow().underlay.locked).toBe(false);
  });

  it('is copied with its room, the copy a picture record of its own naming the same stored picture', async () => {
    const one = await scene('1');
    const id = await addUnderlay(one.sceneId);
    const two = crypto.randomUUID();
    await store.getState().apply([{ kind: 'create', record: { id: two, type: 'scene', parentId: project.projectId, sortKey: '2', props: { number: '2', room_id: one.roomId } } }]);
    await store.getState().apply(separateCopyChanges(records(), project.projectId, two));
    const copyRoom = sceneRoomId(records(), records()[two]);
    expect(copyRoom).not.toBe(one.roomId);
    const copy = Object.values(records()).find((r) => r.parentId === copyRoom && r.props.kind === 'underlay');
    const copyFields = underlayFields(copy?.props ?? {});
    expect(copyFields?.mediaId).not.toBe(fieldsOf(id)?.mediaId);
    const copyMedia = records()[copyFields?.mediaId ?? ''];
    expect(copyMedia?.parentId).toBe(copy?.id);
    expect(copyMedia?.props.file).toBe(records()[fieldsOf(id)?.mediaId ?? '']?.props.file);
    const stored = await project.file.query('SELECT count(*) AS n FROM media_files');
    expect(Number(stored[0]?.n)).toBe(1);
    // The original deleted for good: the copy's picture stays.
    await store.getState().apply(trashPlanItemsChanges(records(), [id]));
    await store.getState().emptyTrash();
    expect(records()[copyFields?.mediaId ?? '']).toBeDefined();
    expect(await readOriginal(project.file, image(3).original.sha256)).not.toBeNull();
    // A room copied with its underlay reads as the room copied, its picture record no news of its own.
    expect(await lines()).toContain('Made a separate copy of the room for SC 02: room “Diner (SC 02)”');
  });

  it('stays the room’s: "This setup only" leaves it where it is, and Set scale picks the selected one, else the frontmost', async () => {
    const { sceneId, setupId, roomId } = await scene();
    const a = await addUnderlay(sceneId, 3);
    const b = await addUnderlay(sceneId, 5);
    expect(setupOnlyChanges(records(), sceneId, setupId, [a], true)).toEqual([]);
    expect(scaleTarget(records(), roomId, [a])).toBe(a);
    expect(scaleTarget(records(), roomId, [])).toBe(b);
    expect(scaleTarget(records(), null, [])).toBeNull();
  });

  it('pastes as a copy with its own picture record, and refuses geometry it couldn’t read', async () => {
    const { sceneId, setupId, view } = await scene();
    const id = await addUnderlay(sceneId);
    setLayerLocked(UNDERLAY_ROW, false);
    const pasted = planPasteInView(records(), view, planClipOf(records(), [id], view), null);
    await store.getState().apply(pasted.changes);
    const [copyId] = pasted.ids;
    expect(records()[copyId ?? '']?.parentId).toBe(records()[id]?.parentId);
    expect(underlayFields(records()[copyId ?? '']?.props ?? {})?.mediaId).not.toBe(fieldsOf(id)?.mediaId);
    expect(unreadableAfter(records(), [{ kind: 'update', id, set: { x: 1e308 } }])).toBe(true);
    expect(unreadableAfter(records(), [{ kind: 'update', id, set: { width: -3 } }])).toBe(true);
    expect(planGeometryChanges(records(), [{ id, x: 1e9, y: 0, width: 1000, height: 500, rotation: 0 }])).toEqual([]);
    expect(setupId).toBeTruthy();
  });
});

describe('a measure', () => {
  it('reads as a wall’s box, a centimetre deep', () => {
    expect(measureFields({ kind: 'measure', x: 0, y: 0, width: 3.5, rotation: 90 })).toEqual({ kind: 'measure', x: 0, y: 0, width: 3.5, height: MEASURE_THICKNESS, rotation: 90, name: '' });
    expect(measureFields({ kind: 'measure', x: 0, y: 0 })).toBeNull();
    expect(measureFields({ kind: 'measure', x: 1e308, y: 0, width: 1 })).toBeNull();
    expect(measureFields({ kind: 'wall', x: 0, y: 0, width: 1 })).toBeNull();
  });

  it('is drawn as a chain, one a segment, into the room, its length its label', async () => {
    const { sceneId, setupId, roomId } = await scene();
    const made = drawMeasuresChanges(records(), sceneId, [
      { x: 0, y: 0 },
      { x: 350, y: 0 },
      { x: 350, y: 200 },
      { x: 350, y: 200 },
    ]);
    expect(made.ids).toHaveLength(2);
    await store.getState().apply(made.changes);
    const [first, second] = made.ids.map((id) => measureFields(records()[id]?.props ?? {}));
    expect(records()[made.ids[0] ?? '']?.parentId).toBe(roomId);
    expect(first).toMatchObject({ width: 3.5, rotation: 0 });
    expect(second).toMatchObject({ width: 2, rotation: 90 });
    if (!first) throw new Error('no measure');
    const [start, end] = wallEnds(first);
    expect(start).toEqual({ x: 0, y: 0 });
    expect(end.x).toBeCloseTo(3.5, 6);
    const item = measureItem(made.ids[0] ?? '', first, 'metres');
    expect(item.label).toBe('Measure, 3.50 m');
    expect(item.pickThickness).toBe(8);
    expect(item.snapPoints).toEqual([
      { x: 0, y: 0 },
      { x: 350, y: 0 },
    ]);
    expect(item.beyond).toBeDefined();
    // On the production layer, shown in the setup's view.
    expect(layerOfItem(records(), records()[made.ids[0] ?? ''] as SbdRecord)).toBe('production');
    expect(shownItems(records(), sceneId, setupId).filter((i) => i.fields.kind === 'measure')).toHaveLength(2);
  });

  it('snaps its ends to a wall’s, and its typed length keeps its start', async () => {
    const { sceneId } = await scene();
    const walls = drawWallsChanges(records(), sceneId, [
      { x: 0, y: 0 },
      { x: 420, y: 0 },
    ]);
    await store.getState().apply(walls.changes);
    // The canvas's run: a click 6 px from the wall's end lands on it (a wall's ends are its snap points).
    const snap = { ends: [{ x: 0, y: 0 }, { x: 420, y: 0 }], grid: planScale('metres').grid, zoom: 1 };
    const run = runStart('host:measure', nextPoint({ x: 4, y: 3 }, NO_MODS, null, snap));
    expect(run.points[0]).toEqual({ x: 0, y: 0 });
    const clicked = runClick(run, nextPoint({ x: 418, y: -4 }, NO_MODS, run, snap), 1, { time: 0, x: 0, y: 0 });
    if (clicked === 'double') throw new Error('double');
    expect(clicked.points[1]).toEqual({ x: 420, y: 0 });
    // A length typed from the keyboard, read in the unit shown.
    const typed = runKey({ ...clicked, typed: '1.5m', cursor: null, angle: Math.PI / 2 }, { key: 'Enter', metaKey: false, ctrlKey: false }, planScale('metres').parse);
    expect(typed?.kind).toBe('taken');
    const made = drawMeasuresChanges(records(), sceneId, clicked.points);
    await store.getState().apply(made.changes);
    const id = made.ids[0] ?? '';
    expect(measureFields(records()[id]?.props ?? {})?.width).toBeCloseTo(4.2, 6);
    // The Selection tile's length: the start stays.
    await store.getState().apply(measurePatchChanges(records(), [id], { length: 2.5 }));
    const after = measureFields(records()[id]?.props ?? {});
    if (!after) throw new Error('no measure');
    expect(after.width).toBe(2.5);
    expect(wallEnds(after)[0].x).toBeCloseTo(0, 6);
    expect(wallEnds(after)[0].y).toBeCloseTo(0, 6);
    expect(after.height).toBe(MEASURE_THICKNESS);
    // Turned about its start, moved by its start.
    await store.getState().apply(measurePatchChanges(records(), [id], { rotation: 90, startX: 1 }));
    const turned = measureFields(records()[id]?.props ?? {});
    if (!turned) throw new Error('no measure');
    expect(turned.rotation).toBe(90);
    expect(wallEnds(turned)[0].x).toBeCloseTo(1, 6);
    expect(measurePatchRefused(records(), [id], { length: 0.001 })).toBe(true);
    expect(measurePatchRefused(records(), [id], { length: 5000 })).toBe(true);
    expect(measurePatchChanges(records(), [id], { startX: 1e9 })).toEqual([]);
    expect(toCanvas(after.width)).toBe(250);
  });
});

describe('History, the Trash and the JSON round trip', () => {
  it('says each step, in English and Spanish', async () => {
    const { sceneId, view } = await scene();
    const id = await addUnderlay(sceneId);
    const mid = { x: 0, y: 0 };
    await store.getState().apply(setScaleChanges(records(), id, mid, { x: 1, y: 0 }, 3.5));
    setLayerLocked(UNDERLAY_ROW, false);
    const box = fieldsOf(id);
    if (!box) throw new Error('no underlay');
    await store.getState().apply(planGeometryChanges(records(), [{ id, x: toCanvas(box.x) + 100, y: toCanvas(box.y), width: toCanvas(box.width), height: toCanvas(box.height), rotation: 0 }]));
    await store.getState().apply(trashPlanItemsChanges(records(), [id]));
    const measures = drawMeasuresChanges(records(), sceneId, [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
    ]);
    await store.getState().apply(measures.changes);
    await store.getState().apply(measurePatchChanges(records(), measures.ids, { length: 2 }));
    await store.getState().apply(trashPlanItemsChanges(records(), measures.ids));
    expect((await lines()).slice(-7)).toEqual([
      'Added an underlay in Diner',
      'Set the underlay’s scale: 3.50 m between the points',
      'Moved the underlay',
      'Deleted an underlay',
      'Drew a measure',
      'Changed a measure',
      'Deleted a measure',
    ]);
    setLocale('es');
    expect((await lines()).slice(-7)).toEqual([
      'Se agregó una imagen de fondo en Diner',
      'Se fijó la escala de la imagen de fondo: 3.50 m entre los puntos',
      'Se movió la imagen de fondo',
      'Se eliminó una imagen de fondo',
      'Se dibujó una medida',
      'Se cambió una medida',
      'Se eliminó una medida',
    ]);
    setLocale('en');
    expect(view.sceneId).toBe(sceneId);
  });

  it('carries underlays, their pictures and measures out and back', async () => {
    const { sceneId } = await scene();
    const id = await addUnderlay(sceneId);
    await store.getState().apply(setScaleChanges(records(), id, { x: 0, y: 0 }, { x: 1, y: 0 }, 4));
    await store.getState().apply(
      drawMeasuresChanges(records(), sceneId, [
        { x: 0, y: 0 },
        { x: 250, y: 0 },
      ]).changes,
    );
    const at = new Date('2026-11-14T12:00:00.000Z');
    const text = new TextDecoder().decode(await projectJsonBytes(project.file, at));
    const copy = folder.path('Diner (imported).sbd');
    await importProjectJson(nodeDriver, copy, readProjectJson(text), at);
    const imported = await openProject(copy, { driver: nodeDriver, backups: false });
    try {
      const rows = (file: Project['file']) => file.query("SELECT * FROM records WHERE type IN ('plan_item', 'media') ORDER BY id");
      const was = await rows(project.file);
      expect(was.length).toBe(3);
      expect(await rows(imported.file)).toEqual(was);
      expect(await readOriginal(imported.file, image(3).original.sha256)).not.toBeNull();
    } finally {
      await imported.close();
    }
  });
});
