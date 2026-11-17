import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProjectStore } from '../../../app/projectStore';
import { signMinute } from '../../../app/shell/savedSign';
import { setLocale } from '../../../core/i18n';
import { scenesOf } from '../../../app/shell/sidebar/scenes';
import { projectGear } from '../../../core/model/gear';
import { shownFields, shownItems, shownItemsMade, startRoomChanges, wallsAlong, sceneRoomId } from '../../../core/model/plan';
import { blockingReadingsMade, PLAIN_MARK_SIZE, placeMarkChanges, viewBlocking } from '../../../core/model/planBlocking';
import { setupReadingsMade } from '../../../core/model/planCamera';
import { compassModel, compassModelsMade, sameCompassModel } from '../../../core/model/planCompass';
import { openingHeights } from '../../../core/model/planHeights';
import { ALL_SHOWN, layerCounts, layeredItemsKeeper, layerOfItem, pickableIds } from '../../../core/model/planLayers';
import { planLegend } from '../../../core/model/planLegend';
import { FLAG_ICONS, lightWatts, liveGear } from '../../../core/model/planLight';
import { alsoInRoom, homeOf } from '../../../core/model/planRooms';
import { roomNorthItem, sunReadingsMade, sunTimeChanges } from '../../../core/model/planSun';
import type { SbdRecord } from '../../../core/model/record';
import { recordsTypeIndexed, unchangedComparisons, unchangedToken } from '../../../core/model/recordIndex';
import { framesWithoutSetup, sceneSetups, setupFrames } from '../../../core/model/setup';
import { sunReadingOf, sunReadingsOfMade, sunRecordsToken, sunZonePointOf } from '../../../core/model/sunSources';
import { viewSunZonePoint, windowSunOf, windowSunsMade, windowSunsOf, type WindowSunOf } from '../../../core/model/windowSun';
import type { Change } from '../../../core/ops/ops';
import { nodeDriver } from '../../../core/storage/nodeDriver';
import { createProject, type Project } from '../../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../../core/storage/testFolder';
import { INK } from '../../../ui/canvas/paperColours';
import { cameraLooks } from './cameraLooks';
import { framesReadingKeeper } from './framesReading';
import { iconLabel } from './iconWords';
import { libraryReadingKeeper } from './library';
import { lightLooks } from './lightLooks';
import { liveSights } from './liveSights';
import { blockingLooks } from './markLooks';
import { openingSpotInWall, placeIconChanges, placeOpeningChanges, planItemsBuilder, shownItemsKeeper, turnChanges } from './planItems';
import { sightsKeeper } from './planSights';
import { sunLooks, sunLooksMade } from './sunLooks';
import { roomUnderlays, underlayPictures, unscaledIn } from './underlayEdits';

// What one edit costs a 300-item plan, counted (6.26, Kevin Nov 16). The held turn key on the 300-item plan drifted past
// its budget over eight milestones, a little at each, and only a stopwatch saw it (e2e/perf.spec.ts, run on request).
// Each key repeat is a whole edit: a new records object, and every reader the Setup workspace keeps reads it. So this
// pins, for a selected light turned 5°, exactly how many times those readers read the records whole and how many times
// the readings that never look at a light are worked out: the sun path's reading and its look, the setup's sun, the
// compass and the sun through the windows. A reader added to a per-edit path, or one keyed on the records object where it
// should be keyed on what it reads, fails here with a number, not there with a slow frame. The readers run are listed at
// setupWorkspaceReader below, by component: that list must follow PlanTile.tsx and the tiles beside it (PlanCompass,
// SelectionTile with LightSelection and WindowSelection, FramesTile, SetupsTile, LayersTile, LibraryTile, LegendView).

type Records = Readonly<Record<string, SbdRecord>>;

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
  vi.restoreAllMocks();
  await store.getState().close();
  folder.remove();
});

const records = () => store.getState().records;
const zones = new Map<string, string | null>();

/**
 * SC 1 at the Diner (its place and zone), Setup 1 with 1A and 1B on a dated day, and 300 items in its view: 40 walls, 150
 * set pieces, 60 lights, 30 flags, 6 cameras, 12 marks, the room's north and the setup's sun path.
 */
async function plan300() {
  const sceneId = crypto.randomUUID();
  const setupId = crypto.randomUUID();
  await store.getState().apply([
    { kind: 'create', record: { id: 'diner', type: 'location', parentId: project.projectId, sortKey: 'a', props: { name: 'Diner', latitude: 40.7128, longitude: -74.006, map_name: 'Diner', time_zone: 'America/New_York' } } },
    { kind: 'create', record: { id: sceneId, type: 'scene', parentId: project.projectId, sortKey: '1', props: { number: '1', name: 'Diner', location_id: 'diner' } } },
    { kind: 'create', record: { id: setupId, type: 'setup', parentId: sceneId, sortKey: 'a', props: { name: '' } } },
    { kind: 'create', record: { id: 'd1', type: 'shoot_day', parentId: project.projectId, sortKey: 'a', props: { date: '2026-06-21' } } },
    { kind: 'create', record: { id: 'a', type: 'shot', parentId: sceneId, sortKey: 'a', props: { number: '1A', setup_id: setupId, shoot_day_id: 'd1', lens_mm: 35 } } },
    { kind: 'create', record: { id: 'b', type: 'shot', parentId: sceneId, sortKey: 'b', props: { number: '1B', setup_id: setupId, shoot_day_id: 'd1', lens_mm: 85 } } },
    { kind: 'create', record: { id: 'fx3', type: 'gear_item', parentId: project.projectId, sortKey: 'a', props: { name: 'FX3', kind: 'camera_body', sensor_width_mm: 35.6, sensor_height_mm: 20 } } },
  ]);
  await store.getState().apply(startRoomChanges(records(), project.projectId, sceneId));
  const view = { sceneId, setupId };
  const roomId = sceneRoomId(records(), records()[sceneId]) ?? '';
  // 40 walls round a closed room 24 m by 16 m, a wall every 2 m, and a window in the first of them: an outside wall.
  const corners = [
    ...Array.from({ length: 12 }, (_, i) => ({ x: i * 2, y: 0 })),
    ...Array.from({ length: 8 }, (_, i) => ({ x: 24, y: i * 2 })),
    ...Array.from({ length: 12 }, (_, i) => ({ x: 24 - i * 2, y: 16 })),
    ...Array.from({ length: 8 }, (_, i) => ({ x: 0, y: 16 - i * 2 })),
    { x: 0, y: 0 },
  ];
  const walls = wallsAlong(records(), roomId, corners);
  await store.getState().apply(walls.changes);
  const windowId = crypto.randomUUID();
  const spot = openingSpotInWall(shownItems(records(), sceneId, setupId), walls.ids[0] ?? '', 'window');
  if (!spot) throw new Error('no room for a window');
  await store.getState().apply(placeOpeningChanges(records(), spot, 'window', windowId, view));
  // The 259 other items in one step: each is made by the app's own edit code from the records as they will be once the
  // ones before it are written (a new object after each, as the store makes), then all are written together.
  let local: Record<string, SbdRecord> = { ...records() };
  const built: Change[] = [];
  const take = (changes: readonly Change[]) => {
    const next = { ...local };
    for (const change of changes) {
      built.push(change);
      if (change.kind === 'create') {
        const id = change.record.id ?? '';
        next[id] = { id, type: change.record.type, parentId: change.record.parentId, sortKey: change.record.sortKey, props: change.record.props ?? {}, trashedAt: null, trashedBy: null, createdAt: '', updatedAt: '' };
      } else if (change.kind === 'update') {
        const was = next[change.id];
        if (was) next[change.id] = { ...was, props: { ...was.props, ...change.set } };
      }
    }
    local = next;
  };
  const place = (icon: string, centre: { x: number; y: number }, extra: Record<string, unknown> = {}) => {
    const id = crypto.randomUUID();
    const changes = placeIconChanges(local, view, icon, centre, id);
    const made = changes.find((c) => c.kind === 'create' && c.record.id === id);
    if (made?.kind !== 'create') throw new Error(`could not place ${icon}`);
    made.record.props = { ...made.record.props, ...extra } as SbdRecord['props'];
    take(changes);
    return id;
  };
  const at = (i: number) => ({ x: 1 + (i % 23), y: 2 + Math.floor(i / 23) * 1.1 });
  for (let i = 0; i < 149; i += 1) place(i % 2 === 0 ? 'set-art/chair' : 'set-art/sofa', at(i));
  const lights: string[] = [];
  for (let i = 0; i < 60; i += 1) lights.push(place(i % 2 === 0 ? 'lighting/fresnel' : 'lighting/led-panel', at(149 + i), { rotation: (i * 41) % 360, ...(i % 4 === 0 ? { watts: 650 } : {}) }));
  for (let i = 0; i < 30; i += 1) place(FLAG_ICONS[0], at(209 + i), { rotation: (i * 23) % 360 });
  for (let i = 0; i < 6; i += 1) place('camera/camera', at(239 + i), i === 0 ? { shot_ids: ['a', 'b'] } : {});
  for (let i = 0; i < 12; i += 1) take(placeMarkChanges(local, view, at(245 + i), PLAIN_MARK_SIZE));
  const north = place('production/north', { x: 1.5, y: 1 }, { rotation: 20 });
  const sun = place('lighting/sun-path', { x: 12, y: 8 }, { time: '16:30' });
  await store.getState().apply(built);
  return { view, roomId, light: lights[1] ?? '', north, sun, windowId };
}

/**
 * What the Setup workspace works out on an edit, with `selection` selected on the plan. THIS LIST FOLLOWS THE CODE: a
 * reader added to one of these on its per-edit path is added here, or the counts below guard nothing.
 * - PlanCanvas (PlanTile.tsx): useLiveView, the shown and layered items, the cameras', lights', sun paths' and marks'
 *   looks, the sun paths' zone points, the underlays' pictures, the sights and the live sights, the canvas items, what
 *   its `data` reads (each sun path's reading, the view's blocking, each item's layer), the room's underlays and scenes.
 * - PlanCompass (PlanCompass.tsx): the compass's model and the room's north.
 * - The Selection tile (SelectionTile.tsx): what can be picked, each selected item's fields and home; for one light
 *   (LightSelection.tsx) its watts, its gear and the project's gear; for one window (WindowSelection.tsx) its heights
 *   and its sun (the view's zone point, windowSunOf).
 * - The Frames tile (FramesTile.tsx): its reading. The Setups tile (SetupsTile.tsx): the scenes, each scene's setups,
 *   the picked setup's frames and the frames in none. The Layers tile (LayersTile.tsx): the counts. The Library
 *   (LibraryTile.tsx): its reading. The legend (LegendView.tsx): planLegend.
 * Each reader is kept between edits as its component keeps it.
 */
function setupWorkspaceReader(view: { sceneId: string; setupId: string }, roomId: string, projectId: string, selection: readonly string[]) {
  const keepShown = shownItemsKeeper();
  const keepLayered = layeredItemsKeeper();
  const keepSights = sightsKeeper();
  const build = planItemsBuilder();
  const keepFrames = framesReadingKeeper();
  const keepLibrary = libraryReadingKeeper();
  return (now: Records) => {
    // PlanCanvas.
    const setups = sceneSetups(now, view.sceneId);
    const shown = keepShown(now, view.sceneId, view.setupId);
    const layered = keepLayered(now, shown, ALL_SHOWN);
    const visible = layered.visible;
    const looks = cameraLooks(now, shown, 'metres', selection);
    const lights = lightLooks(now, shown, 'metres', selection);
    for (const item of shown) if (item.fields.kind === 'sun') sunZonePointOf(now, item.record.id);
    const suns = sunLooks(now, shown, zones, selection);
    const blocking = blockingLooks(now, view, shown, 'metres', selection);
    const pictures = underlayPictures(now, visible);
    const sights = keepSights(shown, visible, looks, lights, blocking.marks);
    const items = build(visible, 'metres', INK, 'en', looks, lights, suns, blocking, layered.looks, pictures, sights);
    liveSights({ records: now, view, blocking: shown, items: visible, built: items, looks, lights, marks: blocking });
    for (const item of visible) {
      if (item.fields.kind === 'sun') sunReadingOf(now, item.record.id, zones);
      if (item.fields.kind === 'mark') viewBlocking(now, view.sceneId, view.setupId);
      layerOfItem(now, item.record);
    }
    roomUnderlays(now, roomId);
    unscaledIn(now, roomId);
    alsoInRoom(now, view.sceneId);
    // PlanCompass.
    const compass = compassModel(now, view, zones);
    roomNorthItem(now, sceneRoomId(now, now[view.sceneId]));
    // The Selection tile.
    let windowSun: WindowSunOf | null = null;
    for (const id of pickableIds(now, selection, ALL_SHOWN)) {
      const record = now[id];
      if (!record) continue;
      const fields = shownFields(record.props);
      homeOf(now, record);
      if (fields?.kind === 'light' && selection.length === 1) {
        lightWatts(now, id);
        liveGear(now, fields.gearId);
        projectGear(now, projectId);
      }
      if (fields?.kind === 'window' && selection.length === 1) {
        openingHeights(record.props);
        viewSunZonePoint(now, view);
        windowSun = windowSunOf(now, view, id, zones);
      }
    }
    // The Frames, Setups, Layers and Library tiles and the legend.
    const setup = setups.find((s) => s.record.id === view.setupId);
    if (setup) keepFrames(now, projectId, setup.record, setup.number);
    for (const scene of scenesOf(now, projectId)) sceneSetups(now, scene.id);
    setupFrames(now, view.setupId);
    framesWithoutSetup(now, view.sceneId);
    layerCounts(now, shownItems(now, view.sceneId, view.setupId));
    keepLibrary(now, view);
    planLegend(now, view.sceneId, view.setupId, iconLabel);
    return { items, compass, suns, windowSun };
  };
}

/** How many times a run read these records whole (Object.values, entries or keys on them), as recordIndex.test.ts counts it. */
function scansOf(now: Records, run: () => void): number {
  const spies = [vi.spyOn(Object, 'values'), vi.spyOn(Object, 'entries'), vi.spyOn(Object, 'keys')];
  try {
    run();
    return spies.reduce((sum, spy) => sum + spy.mock.calls.filter(([read]) => read === now).length, 0);
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
}

const counters = () => ({
  typeIndexes: recordsTypeIndexed(),
  comparisons: unchangedComparisons(),
  shown: shownItemsMade(),
  setups: setupReadingsMade(),
  blocking: blockingReadingsMade(),
  sunReadings: sunReadingsOfMade(),
  setupSuns: sunReadingsMade(),
  compasses: compassModelsMade(),
  sunLooks: sunLooksMade(),
  windowSuns: windowSunsMade(),
});

const since = (before: ReturnType<typeof counters>) => {
  const now = counters();
  return Object.fromEntries(Object.entries(now).map(([name, value]) => [name, value - before[name as keyof typeof now]]));
};

describe('one light turned on a 300-item plan (6.26)', () => {
  it('reads the records whole once, and works out no sun path, no setup’s sun and no window’s sun again', async () => {
    const { view, roomId, light, windowId } = await plan300();
    expect(shownItems(records(), view.sceneId, view.setupId)).toHaveLength(300);
    // The light being turned is selected, as the held key has it: the Selection tile shows it.
    const read = setupWorkspaceReader(view, roomId, project.projectId, [light]);
    const first = read(records());
    expect(first.items).toHaveLength(300);
    // The sun path is drawn, and the plan has a window in an outside wall with hours of sun: there is a reading, a look
    // and a window's sun that could be worked out again.
    expect(first.compass.sun).not.toBeNull();
    expect([...first.suns.values()].map((look) => look.kind)).toEqual(['drawn']);
    const windows = windowSunsOf(records(), view, zones);
    expect(windows.map((w) => [w.windowId, w.wall, w.missing])).toEqual([[windowId, 'outside', null]]);

    await store.getState().apply(turnChanges(records(), [light], 5));
    const now = records();
    const before = counters();
    let second = first;
    const scans = scansOf(now, () => {
      second = read(now);
      // Asked twice, as two tiles ask: nothing is read again.
      read(now);
    });
    // One pass over all the records, the index by type every reader shares (recordIndex.ts), and nothing else.
    expect(scans).toBe(1);
    expect(since(before)).toEqual({
      typeIndexes: 1,
      // One comparison of the records a sun path reads with the last ones: what keeps its reading.
      comparisons: 1,
      // What the view shows, the setup's frames and cameras, the scene's blocking: once each for the new records.
      shown: 1,
      setups: 1,
      blocking: 1,
      // Nothing a sun path reads changed: no reading, no setup's sun.
      sunReadings: 0,
      setupSuns: 0,
      // The compass's model is kept per records object (planCompass.test.ts), so it is made once, from the kept reading
      // with no sun worked out; it says what the last one said, so the compass is not drawn again.
      compasses: 1,
      // The sun path's look is kept by its reading: its arc is not made again.
      sunLooks: 0,
      // With a light selected nothing asks for a window's sun: the Selection tile asks only with a window selected (below).
      windowSuns: 0,
    });
    expect(second.compass.reading).toBe(first.compass.reading);
    expect(sameCompassModel(first.compass, second.compass)).toBe(true);
    expect([...second.suns.values()]).toEqual([...first.suns.values()]);
    expect([...second.suns.values()][0]).toBe([...first.suns.values()][0]);
    // And only the light is a new item on the canvas.
    const was = new Map(first.items.map((item) => [item.id, item]));
    expect(second.items.filter((item) => item !== was.get(item.id)).map((item) => item.id)).toEqual([light]);
  });

  it('with a window selected, works its sun out once per records object: the one reader here still kept by the records object', async () => {
    const { view, roomId, light, windowId } = await plan300();
    const read = setupWorkspaceReader(view, roomId, project.projectId, [windowId]);
    const first = read(records());
    expect(first.windowSun).toMatchObject({ wall: 'outside', missing: null });
    // A light turned from another tile while the window stays selected.
    await store.getState().apply(turnChanges(records(), [light], 5));
    const now = records();
    const before = counters();
    let second = first;
    const scans = scansOf(now, () => {
      second = read(now);
      read(now);
    });
    expect(scans).toBe(1);
    // As for a selected light, but for the window's sun: windowSunsOf is kept per records object (windowSun.test.ts), so
    // the view's windows are worked out once for the new records, from the kept sun reading (no sun reading is made).
    // The held turn key never pays this: a light and a window are never the one selection.
    expect(since(before)).toEqual({ typeIndexes: 1, comparisons: 1, shown: 1, setups: 1, blocking: 1, sunReadings: 0, setupSuns: 0, compasses: 1, sunLooks: 0, windowSuns: 1 });
    expect(second.windowSun).toEqual(first.windowSun);
  });

  it('works the sun out again when something a sun path reads changes: its time, the room’s north, the day’s date, the location’s place', async () => {
    const { view, roomId, north, sun } = await plan300();
    const read = setupWorkspaceReader(view, roomId, project.projectId, []);
    let last = read(records());
    const edits: [string, () => Promise<void>][] = [
      ['the sun path’s time', () => store.getState().apply(sunTimeChanges(records(), [sun], '09:15'))],
      ['the room’s north', () => store.getState().apply(turnChanges(records(), [north], 5))],
      ['the day’s date', () => store.getState().apply([{ kind: 'update', id: 'd1', set: { date: '2026-12-21' } }])],
      ['the location’s place', () => store.getState().apply([{ kind: 'update', id: 'diner', set: { latitude: 34.0522, longitude: -118.2437 } }])],
      ['a frame taken off the day', () => store.getState().apply([{ kind: 'update', id: 'a', unset: ['shoot_day_id'] }, { kind: 'update', id: 'b', unset: ['shoot_day_id'] }])],
    ];
    for (const [name, edit] of edits) {
      const token = sunRecordsToken(records());
      const before = sunReadingsOfMade();
      await edit();
      expect(sunRecordsToken(records()), name).not.toBe(token);
      const next = read(records());
      expect(next.compass.reading, name).not.toBe(last.compass.reading);
      expect(sameCompassModel(last.compass, next.compass), name).toBe(false);
      // The last edit leaves the setup's frames with no day: nothing to work out, and the reading says what is missing.
      if (name === 'a frame taken off the day') expect(next.compass.reading, name).toMatchObject({ missing: 'noDay' });
      else expect(sunReadingsOfMade() - before, name).toBe(1);
      last = next;
    }
  });
});

describe('the token for the records a reader depends on (6.26)', () => {
  const record = (id: string, type: SbdRecord['type'], props: SbdRecord['props'] = {}): SbdRecord => ({ id, type, parentId: null, sortKey: id, props, trashedAt: null, trashedBy: null, createdAt: '', updatedAt: '' });
  const part = { type: 'plan_item' as const, counts: (r: SbdRecord) => r.props.kind === 'sun' };

  it('stays the same object while the records named are the same, whatever else changes, and is compared once per records object', () => {
    const scene = record('s', 'scene');
    const sun = record('sun', 'plan_item', { kind: 'sun' });
    const light = record('light', 'plan_item', { kind: 'light', rotation: 0 });
    const first: Records = { s: scene, sun, light };
    const before = unchangedComparisons();
    const token = unchangedToken(first, 'test.token', ['scene'], part);
    expect(unchangedToken(first, 'test.token', ['scene'], part)).toBe(token);
    expect(unchangedComparisons() - before).toBe(1);
    // A light turned, a stroke added: neither is named.
    const turned: Records = { s: scene, sun, light: { ...light, props: { kind: 'light', rotation: 5 } }, stroke: record('stroke', 'stroke') };
    expect(unchangedToken(turned, 'test.token', ['scene'], part)).toBe(token);
    expect(unchangedComparisons() - before).toBe(2);
  });

  it('is a new object when a record named changed, was added, went or moved in the order, and when a part’s record did', () => {
    const scene = record('s', 'scene');
    const other = record('t', 'scene');
    const sun = record('sun', 'plan_item', { kind: 'sun' });
    const light = record('light', 'plan_item', { kind: 'light' });
    const tokenOf = (now: Records) => unchangedToken(now, 'test.changes', ['scene'], part);
    const base: Records = { s: scene, t: other, sun, light };
    const changes: [string, Records][] = [
      ['a scene changed', { s: { ...scene, props: { name: 'Diner' } }, t: other, sun, light }],
      ['a scene went', { s: scene, sun, light }],
      ['a scene added', { s: scene, t: other, u: record('u', 'scene'), sun, light }],
      ['the scenes in another order', { t: other, s: scene, sun, light }],
      ['the sun path changed', { s: scene, t: other, sun: { ...sun, props: { kind: 'sun', time: '09:00' } }, light }],
      ['a light became a sun path', { s: scene, t: other, sun, light: { ...light, props: { kind: 'sun' } } }],
    ];
    for (const [name, changed] of changes) {
      // From the base each time: the token is compared with the last one given under its key.
      const token = tokenOf({ ...base });
      expect(tokenOf(changed), name).not.toBe(token);
    }
  });

  it('never mixes two keys', () => {
    const now: Records = { s: record('s', 'scene') };
    expect(unchangedToken(now, 'test.one', ['scene'])).not.toBe(unchangedToken(now, 'test.other', ['scene']));
  });
});

describe('the Saved sign’s time, to the minute (6.26)', () => {
  it('is the same text for every edit within a minute, so the sign reads the store and is drawn once a minute', () => {
    expect(signMinute('2026-11-16T14:32:05.123Z')).toBe('2026-11-16T14:32:00.000Z');
    expect(signMinute('2026-11-16T14:32:59.999Z')).toBe(signMinute('2026-11-16T14:32:00.000Z'));
    expect(signMinute('2026-11-16T14:33:00.000Z')).not.toBe(signMinute('2026-11-16T14:32:59.999Z'));
  });

  it('leaves no time and a time that can’t be read as they are', () => {
    expect(signMinute(null)).toBeNull();
    expect(signMinute('not a time')).toBe('not a time');
  });
});
