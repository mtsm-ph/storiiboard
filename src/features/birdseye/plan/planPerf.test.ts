import type Konva from 'konva';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../../app/projectStore';
import { setLocale } from '../../../core/i18n';
import { shownItems, shownItemsMade, startRoomChanges, wallsAlong, sceneRoomId } from '../../../core/model/plan';
import { blockingReadingsMade } from '../../../core/model/planBlocking';
import { setupReadingsMade } from '../../../core/model/planCamera';
import { ALL_SHOWN, layerCounts, layeredItemsKeeper } from '../../../core/model/planLayers';
import { planLegend } from '../../../core/model/planLegend';
import type { SbdRecord } from '../../../core/model/record';
import { nodeDriver } from '../../../core/storage/nodeDriver';
import { createProject, type Project } from '../../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../../core/storage/testFolder';
import { INK, PAPER_COLOURS } from '../../../ui/canvas/paperColours';
import { fitScreenSized } from '../../../ui/canvas/screenSized';
import { BesideLabels, UprightLabels } from './cameraDraw';
import { cameraLooks } from './cameraLooks';
import { framesReadingKeeper } from './framesReading';
import { iconLabel } from './iconWords';
import { libraryReadingKeeper } from './library';
import { lightLooks } from './lightLooks';
import { blockingLooks } from './markLooks';
import { placeIconChanges, planItemsBuilder, shownItemsKeeper, turnChanges } from './planItems';
import { sunLooks } from './sunLooks';
import { underlayPictures } from './underlayEdits';

// A plan's work per edit (6.11, decision 15: 300 items at 60 fps). Each saving the performance run found is pinned here
// by a count or an identity: the records are read once per edit, not once per reader or per item; an edit elsewhere in
// the project rebuilds no canvas item, and an edit to one item rebuilds that item alone; and the Library and Frames
// tiles' readings stay the same objects through an edit they don't show, so neither tile draws again for it.

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

/** SC 1 at the Diner (its place and zone), Setup 1 with 1A and 1B on a dated day, its room with two walls, a sofa, a camera shooting both frames, two lights, north and a sun path; SC 2 elsewhere. */
async function furnished() {
  const sceneId = crypto.randomUUID();
  const setupId = crypto.randomUUID();
  const other = crypto.randomUUID();
  await store.getState().apply([
    { kind: 'create', record: { id: 'diner', type: 'location', parentId: project.projectId, sortKey: 'a', props: { name: 'Diner', latitude: 40.7128, longitude: -74.006, map_name: 'Diner', time_zone: 'America/New_York' } } },
    { kind: 'create', record: { id: sceneId, type: 'scene', parentId: project.projectId, sortKey: '1', props: { number: '1', name: 'Diner', location_id: 'diner' } } },
    { kind: 'create', record: { id: other, type: 'scene', parentId: project.projectId, sortKey: '2', props: { number: '2', name: 'Alley' } } },
    { kind: 'create', record: { id: setupId, type: 'setup', parentId: sceneId, sortKey: 'a', props: { name: '' } } },
    { kind: 'create', record: { id: 'd1', type: 'shoot_day', parentId: project.projectId, sortKey: 'a', props: { date: '2026-06-21' } } },
    { kind: 'create', record: { id: 'a', type: 'shot', parentId: sceneId, sortKey: 'a', props: { number: '1A', setup_id: setupId, shoot_day_id: 'd1', lens_mm: 35 } } },
    { kind: 'create', record: { id: 'b', type: 'shot', parentId: sceneId, sortKey: 'b', props: { number: '1B', setup_id: setupId, shoot_day_id: 'd1', lens_mm: 85 } } },
    { kind: 'create', record: { id: 'fx3', type: 'gear_item', parentId: project.projectId, sortKey: 'a', props: { name: 'FX3', kind: 'camera_body', sensor_width_mm: 35.6, sensor_height_mm: 20 } } },
    { kind: 'create', record: { id: 'sky', type: 'gear_item', parentId: project.projectId, sortKey: 'b', props: { name: 'Skypanel', watts: 450 } } },
  ]);
  await store.getState().apply(startRoomChanges(records(), project.projectId, sceneId));
  const view = { sceneId, setupId };
  const roomId = sceneRoomId(records(), records()[sceneId]) ?? '';
  await store.getState().apply(wallsAlong(records(), roomId, [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }]).changes);
  const place = async (icon: string, centre: { x: number; y: number }, extra: Record<string, unknown> = {}) => {
    const id = crypto.randomUUID();
    const changes = placeIconChanges(records(), view, icon, centre, id);
    const made = changes.find((c) => c.kind === 'create' && c.record.id === id);
    if (made?.kind === 'create') made.record.props = { ...made.record.props, ...extra } as SbdRecord['props'];
    await store.getState().apply(changes);
    return id;
  };
  const sofa = await place('set-art/sofa', { x: 2, y: 1 });
  const camera = await place('camera/camera', { x: 1, y: 2 }, { shot_ids: ['a', 'b'] });
  const light = await place('lighting/fresnel', { x: 3, y: 2 }, { rotation: 30, gear_id: 'sky' });
  const other2 = await place('lighting/led-panel', { x: 3, y: 1 }, { watts: 650 });
  await place('production/north', { x: 0.5, y: 0.5 });
  await place('lighting/sun-path', { x: 2, y: 2 });
  return { view, sofa, camera, light, other: other2, otherScene: other };
}

const zones = new Map<string, string | null>();

/** What the Plan tile works out for a view on an edit, as PlanCanvas does, each reader kept between edits as it keeps them. */
function planReader(view: { sceneId: string; setupId: string }) {
  const keepShown = shownItemsKeeper();
  const keepLayered = layeredItemsKeeper();
  const build = planItemsBuilder();
  return (now: Readonly<Record<string, SbdRecord>>) => {
    const shown = keepShown(now, view.sceneId, view.setupId);
    const layered = keepLayered(now, shown, ALL_SHOWN);
    const visible = layered.visible;
    return build(
      visible,
      'metres',
      INK,
      'en',
      cameraLooks(now, shown, 'metres', []),
      lightLooks(now, shown, 'metres', []),
      sunLooks(now, shown, zones, []),
      blockingLooks(now, view, shown, 'metres', []),
      layered.looks,
      underlayPictures(now, visible),
    );
  };
}

describe('a plan’s readings, once per edit (6.11)', () => {
  it('reads what a view shows once per records, however many readers ask: the plan, its blocking, the Layers tile and the legend', async () => {
    const { view, light } = await furnished();
    const read = planReader(view);
    read(records());
    await store.getState().apply(turnChanges(records(), [light], 5));
    const shownBefore = shownItemsMade();
    const setupsBefore = setupReadingsMade();
    const blockingBefore = blockingReadingsMade();
    const now = records();
    read(now);
    layerCounts(now, shownItems(now, view.sceneId, view.setupId));
    planLegend(now, view.sceneId, view.setupId, iconLabel);
    read(now);
    expect(shownItemsMade() - shownBefore).toBe(1);
    expect(setupReadingsMade() - setupsBefore).toBe(1);
    expect(blockingReadingsMade() - blockingBefore).toBe(1);
    // A new records object, a new reading: never one kept from before the edit.
    await store.getState().apply(turnChanges(records(), [light], 5));
    shownItems(records(), view.sceneId, view.setupId);
    expect(shownItemsMade() - shownBefore).toBe(2);
  });

  it('gives back the very same items for an edit elsewhere in the project, and makes again only the item an edit changed', async () => {
    const { view, light, sofa, camera, other, otherScene } = await furnished();
    const read = planReader(view);
    const first = read(records());
    expect(first.length).toBeGreaterThanOrEqual(8);
    // Another scene renamed: nothing on this plan reads it.
    await store.getState().apply([{ kind: 'update', id: otherScene, set: { name: 'Back alley' } }]);
    expect(read(records())).toBe(first);
    // One light turned: a new list, in which only that light is a new item.
    await store.getState().apply(turnChanges(records(), [light], 5));
    const turned = read(records());
    expect(turned).not.toBe(first);
    const before = new Map(first.map((item) => [item.id, item]));
    const remade = turned.filter((item) => item !== before.get(item.id)).map((item) => item.id);
    expect(remade).toEqual([light]);
    expect(turned.find((i) => i.id === sofa)).toBe(before.get(sofa));
    expect(turned.find((i) => i.id === camera)).toBe(before.get(camera));
    expect(turned.find((i) => i.id === other)).toBe(before.get(other));
  });

  it('marks every item but the underlay’s picture as drawn the same in view and out of it, so a pan never draws it again', async () => {
    const { view } = await furnished();
    const items = planReader(view)(records());
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item.sameInAndOut, item.label).toBe(true);
  });
});

describe('tiles that draw nothing again for an edit they don’t show (6.11)', () => {
  it('keeps the Library’s reading the same object through an edit to an item, and a new one when the view or its state changes', async () => {
    const { view, light } = await furnished();
    const keep = libraryReadingKeeper();
    const first = keep(records(), { ...view });
    expect(first.state).toEqual({ kind: 'ready' });
    await store.getState().apply(turnChanges(records(), [light], 5));
    expect(keep(records(), { ...view })).toBe(first);
    const noSetup = keep(records(), { sceneId: view.sceneId, setupId: null });
    expect(noSetup).not.toBe(first);
    expect(noSetup.state).toEqual({ kind: 'noSetup' });
    expect(keep(records(), null).state).toEqual({ kind: 'noView' });
  });

  it('keeps the Frames tile’s reading the same object through an edit it doesn’t show, and a new one for a lens changed on the board', async () => {
    const { view, light } = await furnished();
    const setup = () => records()[view.setupId] as SbdRecord;
    const keep = framesReadingKeeper();
    const first = keep(records(), project.projectId, setup(), 1);
    expect(first.rows.map((r) => r.number)).toEqual(['1A', '1B']);
    await store.getState().apply(turnChanges(records(), [light], 5));
    expect(keep(records(), project.projectId, setup(), 1)).toBe(first);
    await store.getState().apply([{ kind: 'update', id: 'a', set: { lens_mm: 50 } }]);
    const lens = keep(records(), project.projectId, setup(), 1);
    expect(lens).not.toBe(first);
    expect(lens.rows[0]?.spec).toContain('50 mm');
  });
});

describe('labels through a zoom under way (6.11)', () => {
  type Labels = ReactElement<{ x: number; y: number; ref: (node: Konva.Node | null) => void; children: ReactElement<{ y: number; fontSize: number }>[] }>;

  /** A label group drawn for `drawn`, as the canvas places and scales it at the view's `zoom`: its first line's top and size, on screen. */
  function onScreen(group: Labels, zoom: number): { top: number; size: number } {
    const state = { sx: 1, px: group.props.x, py: group.props.y };
    const stage = {} as Konva.Stage;
    const node = {
      getStage: () => stage,
      scaleX: () => state.sx,
      scaleY: () => state.sx,
      x: () => state.px,
      y: () => state.py,
      scale: (s: { x: number }) => {
        state.sx = s.x;
      },
      position: (p: { x: number; y: number }) => {
        state.px = p.x;
        state.py = p.y;
      },
    } as unknown as Konva.Node;
    group.props.ref(node);
    fitScreenSized(stage, zoom);
    const [line] = group.props.children;
    return { top: (state.py + state.sx * (line?.props.y ?? 0)) * zoom, size: state.sx * (line?.props.fontSize ?? 0) * zoom };
  }

  it('keeps a camera’s labels their size and their gap below it on screen, drawn for 20% and shown at 400%', () => {
    const at = (zoom: number) => UprightLabels({ width: 40, height: 40, zoom, rotation: 0, colours: PAPER_COLOURS, lines: ['A · 35 mm · 54.4°'] }) as Labels;
    const during = onScreen(at(0.2), 4);
    const settled = onScreen(at(4), 4);
    expect(during.top).toBeCloseTo(settled.top, 6);
    expect(during.size).toBeCloseTo(settled.size, 6);
  });

  it('keeps a wall’s height label its size and its gap past the wall on screen, drawn for 400% and shown at 20%', () => {
    const at = (zoom: number) => BesideLabels({ width: 300, height: 10, zoom, rotation: 0, colours: PAPER_COLOURS, spec: { lines: ['2.40 m'], side: 1, edge: 5 } }) as Labels;
    const during = onScreen(at(4), 0.2);
    const settled = onScreen(at(0.2), 0.2);
    expect(during.top).toBeCloseTo(settled.top, 6);
    expect(during.size).toBeCloseTo(settled.size, 6);
  });
});
