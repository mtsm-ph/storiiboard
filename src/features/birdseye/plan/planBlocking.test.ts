import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { Group } from 'react-konva';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../../app/projectStore';
import { setLocale } from '../../../core/i18n';
import { blockingPlanOf, markFields, setupPlanOf, shownItems, startRoomChanges } from '../../../core/model/plan';
import { markOwner, markOwnerChanges, viewBlocking } from '../../../core/model/planBlocking';
import type { SbdRecord } from '../../../core/model/record';
import { nodeDriver } from '../../../core/storage/nodeDriver';
import { createProject, type Project } from '../../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../../core/storage/testFolder';
import { DIM_OPACITY } from '../../../ui/canvas/ItemNodes';
import { PAPER_COLOURS } from '../../../ui/canvas/paperColours';
import { restoreChanges, trashItems } from '../../trash/trash';
import { cameraLooks } from './cameraLooks';
import { iconNodes, iconNodesWith, type IconTexts } from './iconDraw';
import { blockingLooks, characterInitial } from './markLooks';
import { PathShape, segmentEnds } from './markDraw';
import { markSizes, nextPosition, placeIcon, placeMark } from './planActions';
import { cameraItem, placeIconChanges, planClipOf, planItemsBuilder, planPasteInView, trashPlanItemsChanges, turnChanges, turnsByKey, unreadableAfter } from './planItems';
import { planStore } from './planStore';

// Cast blocking and camera moves on the plan (6.7): the Mark tool and Next position as one step each (the blocking
// plan made in the same step, one undo), the Library's cast group, a camera's later positions drawn as its own icon
// dimmed with its cone's edges, the path kept on the first position, paste and duplicate of marks, the camera's marks
// to the Trash and back with it, the track's length, and the builder making a mark's or a camera's item again exactly
// when what it draws changes.

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

/** Scene 1 with ANA and BEN, its room started, two setups; a body lettered A. */
async function scene(): Promise<{ sceneId: string; setupId: string; otherId: string }> {
  const sceneId = crypto.randomUUID();
  const setupId = crypto.randomUUID();
  const otherId = crypto.randomUUID();
  await store.getState().apply([
    { kind: 'create', record: { id: 'fx3', type: 'gear_item', parentId: project.projectId, sortKey: 'a', props: { name: 'FX3', kind: 'camera_body', sensor_width_mm: 35.6, sensor_height_mm: 20, camera_letter: 'A' } } },
    { kind: 'create', record: { id: 'ana', type: 'character', parentId: project.projectId, sortKey: 'a', props: { name: 'ANA' } } },
    { kind: 'create', record: { id: 'ben', type: 'character', parentId: project.projectId, sortKey: 'b', props: { name: 'BEN' } } },
    { kind: 'create', record: { id: sceneId, type: 'scene', parentId: project.projectId, sortKey: '1', props: { number: '1', character_ids: ['ana', 'ben'] } } },
    { kind: 'create', record: { id: setupId, type: 'setup', parentId: sceneId, sortKey: 'a', props: { name: '' } } },
    { kind: 'create', record: { id: otherId, type: 'setup', parentId: sceneId, sortKey: 'b', props: { name: '' } } },
    { kind: 'create', record: { id: 'a', type: 'shot', parentId: sceneId, sortKey: 'a', props: { number: '1A', setup_id: setupId, lens_mm: 50 } } },
  ]);
  await store.getState().apply(startRoomChanges(records(), project.projectId, sceneId));
  return { sceneId, setupId, otherId };
}

const select = (view: { sceneId: string; setupId: string | null }, ids: string[]) => {
  planStore.getState().select(view.setupId ? `setup:${view.setupId}` : `scene:${view.sceneId}`, ids);
};
const selected = (view: { sceneId: string; setupId: string | null }) => planStore.getState().selections[view.setupId ? `setup:${view.setupId}` : `scene:${view.sceneId}`] ?? [];

/** A mark placed with the Mark tool, then given to ANA, then two next positions: their ids in order. */
async function anaWalks(view: { sceneId: string; setupId: string | null }): Promise<string[]> {
  expect(await placeMark(view, { x: 0, y: 0 }, project, store)).toBeNull();
  const [first] = selected(view);
  if (!first) throw new Error('no mark');
  await setMarkOwnerIn(view, first, 'ana');
  expect(await nextPosition(view, first, project, null, store)).toBeNull();
  const [second] = selected(view);
  if (!second) throw new Error('no second');
  expect(await nextPosition(view, second, project, null, store)).toBeNull();
  const [third] = selected(view);
  if (!third) throw new Error('no third');
  return [first, second, third];
}

async function setMarkOwnerIn(view: { sceneId: string; setupId: string | null }, id: string, character: string) {
  // The Selection tile's Who writes through the app's project store (setMarkOwner): here, its op list through this one.
  await store.getState().apply(markOwnerChanges(records(), view, [id], { kind: 'character', id: character }, markSizes()));
}

describe('placing marks (6.7)', () => {
  it('the Mark tool makes the blocking plan in the same step: one undo takes both off', async () => {
    const { sceneId, setupId } = await scene();
    const view = { sceneId, setupId };
    expect(blockingPlanOf(records(), sceneId)).toBeNull();
    expect(await placeMark(view, { x: 1, y: 1 }, project, store)).toBeNull();
    const [id] = selected(view);
    expect(id && records()[id]?.props).toMatchObject({ kind: 'mark', icon: 'cast/tape-mark', width: 0.3, height: 0.28 });
    expect(records()[id ?? '']?.parentId).toBe(blockingPlanOf(records(), sceneId)?.id);
    await store.getState().undo();
    expect(blockingPlanOf(records(), sceneId)).toBeNull();
    expect(records()[id ?? '']).toBeUndefined();
  });

  it('Next position follows a character’s last, and a project switch writes nothing', async () => {
    const { sceneId, setupId } = await scene();
    const view = { sceneId, setupId };
    const [first, second, third] = await anaWalks(view);
    const numbers = viewBlocking(records(), sceneId, setupId).numbers;
    expect([first, second, third].map((id) => numbers.get(id ?? '')?.number)).toEqual([1, 2, 3]);
    expect(records()[third ?? '']?.props).toMatchObject({ icon: 'cast/next-position', character_id: 'ana', x: 1.75 });
    // Begun in another project than the one open: nothing.
    expect(await nextPosition(view, third ?? '', null, null, store)).toBe('otherProject');
    expect(await placeMark(view, { x: 0, y: 0 }, null, store)).toBe('otherProject');
  });

  it('places the Library’s cast group: marks as plain marks, the eyeline and background as icons, all in the blocking', async () => {
    const { sceneId, setupId } = await scene();
    const view = { sceneId: sceneId, setupId: null };
    for (const icon of ['cast/cast-mark', 'cast/tape-mark', 'cast/eyeline', 'cast/background']) {
      const id = crypto.randomUUID();
      const changes = placeIconChanges(records(), view, icon, { x: 0, y: 0 }, id);
      expect(changes.length, icon).toBeGreaterThan(0);
      await store.getState().apply(changes);
      expect(records()[id]?.parentId, icon).toBe(blockingPlanOf(records(), sceneId)?.id);
    }
    const kinds = Object.values(records()).filter((r) => r.type === 'plan_item').map((r) => [r.props.icon, r.props.kind]);
    expect(kinds).toEqual([
      ['cast/cast-mark', 'mark'],
      ['cast/tape-mark', 'mark'],
      ['cast/eyeline', 'icon'],
      ['cast/background', 'icon'],
    ]);
    // The Library's next position follows the one selected mark or camera; with none, it says so.
    select({ sceneId, setupId }, []);
    expect(await placeIcon({ sceneId, setupId }, 'cast/next-position', { x: 0, y: 0 }, project, store)).toBe('noOwner');
  });
});

describe('a camera’s later positions (6.7)', () => {
  it('draw the camera’s icon dimmed with its cone’s edges, labelled with its letter and number, the last with the move', async () => {
    const { sceneId, setupId } = await scene();
    const view = { sceneId, setupId };
    const cam = crypto.randomUUID();
    await store.getState().apply(placeIconChanges(records(), view, 'camera/camera', { x: 0, y: 0 }, cam));
    await store.getState().apply([{ kind: 'update', id: cam, set: { shot_ids: ['a'] } }]);
    expect(await nextPosition(view, cam, project, { x: 3, y: 4 }, store)).toBeNull();
    const [m2] = selected(view);
    const shown = shownItems(records(), sceneId, setupId);
    const looks = blockingLooks(records(), view, shown, 'metres', []);
    const look = looks.marks.get(m2 ?? '');
    expect(look).toMatchObject({ icon: 'camera/camera', ghost: true, lines: ['A 2', '5.00 m move'] });
    expect(look?.cone).toBeGreaterThan(0);
    expect(looks.moves.get(cam)).toBeCloseTo(5, 6);
    // The path is the camera's: it carries it, and Fit all counts both positions.
    const path = looks.paths.get(cam);
    expect(path?.points).toEqual([
      { x: 0, y: 0 },
      { x: 300, y: 400 },
    ]);
    const items = planItemsBuilder()(shown, 'metres', PAPER_COLOURS.ink, 'en', cameraLooks(records(), shown, 'metres', []), new Map(), new Map(), looks);
    const camItem = items.find((i) => i.id === cam);
    expect(camItem?.fitExtent).toEqual(path?.fit);
    expect(camItem?.beyond?.bounds.x).toBeLessThanOrEqual(0);
    const ghost = items.find((i) => i.id === m2);
    // Its icon in a group at the core's dim.
    const drawn = ghost?.draw?.({ width: ghost.width, height: ghost.height, zoom: 1, colours: PAPER_COLOURS, inView: true });
    expect(isValidElement(drawn) && (drawn as ReactElement<{ opacity: number }>).type === Group && (drawn as ReactElement<{ opacity: number }>).props.opacity).toBe(DIM_OPACITY);
    expect(turnsByKey(markFields(records()[m2 ?? '']?.props ?? {}) ?? { kind: 'wall', x: 0, y: 0, width: 1, height: 1, rotation: 0, heightM: null, name: '' })).toBe(true);
    expect(turnChanges(records(), [m2 ?? ''], 5)).toHaveLength(1);
  });

  it('go to the Trash with their camera, out of the Trash’s list, and come back with it', async () => {
    const { sceneId, setupId } = await scene();
    const view = { sceneId, setupId };
    const cam = crypto.randomUUID();
    await store.getState().apply(placeIconChanges(records(), view, 'camera/dolly-track', { x: 0, y: 0 }, cam));
    await nextPosition(view, cam, project, null, store);
    const [m2] = selected(view);
    await store.getState().apply(trashPlanItemsChanges(records(), [cam]));
    expect(records()[m2 ?? '']?.trashedAt).not.toBeNull();
    const rows = trashItems(records(), project.projectId);
    expect(rows.map((r) => r.id)).toEqual([cam]);
    await store.getState().apply(restoreChanges(records(), project.projectId, cam));
    expect(records()[m2 ?? '']?.trashedAt).toBeNull();
    expect(markOwner(records(), records()[m2 ?? ''] as SbdRecord)).toEqual({ kind: 'camera', id: cam });
    // A mark deleted on its own is listed by whose it is.
    await store.getState().apply(trashPlanItemsChanges(records(), [m2 ?? '']));
    expect(trashItems(records(), project.projectId).find((r) => r.id === m2)?.name).toBe('Camera position');
  });

  it('a track shows its length and stretches along it; a camera keeps its proportions', async () => {
    const { sceneId, setupId } = await scene();
    const view = { sceneId, setupId };
    const track = crypto.randomUUID();
    const sticks = crypto.randomUUID();
    await store.getState().apply(placeIconChanges(records(), view, 'camera/dolly-track', { x: 0, y: 0 }, track));
    await store.getState().apply(placeIconChanges(records(), view, 'camera/sticks', { x: 3, y: 0 }, sticks));
    const shown = shownItems(records(), sceneId, setupId);
    const looks = cameraLooks(records(), shown, 'metres', []);
    expect(looks.get(track)?.lines).toContain('3.00 m track');
    expect(looks.get(sticks)?.lines.some((l) => l.endsWith('track'))).toBe(false);
    const item = (id: string) => {
      const found = shown.find((s) => s.record.id === id);
      if (found?.fields.kind !== 'camera') throw new Error('no camera');
      return cameraItem(id, found.fields, 'metres', looks.get(id) ?? { degrees: null, lines: [], selected: false });
    };
    expect(item(track).keepRatio).toBeUndefined();
    expect(item(sticks).keepRatio).toBe(true);
    expect(cameraLooks(records(), shown, 'feet', []).get(track)?.lines).toContain(`9' 10" track`);
  });
});

describe('paste and duplicate of marks (6.7)', () => {
  it('keep the character; keep the camera only when it is pasted too; else a plain mark', async () => {
    const { sceneId, setupId, otherId } = await scene();
    const view = { sceneId, setupId };
    const [first] = await anaWalks(view);
    const cam = crypto.randomUUID();
    await store.getState().apply(placeIconChanges(records(), view, 'camera/camera', { x: 0, y: 0 }, cam));
    await nextPosition(view, cam, project, null, store);
    const [m2] = selected(view);
    // Both pasted: the copy follows the camera's copy.
    const both = planPasteInView(records(), view, planClipOf(records(), [cam, m2 ?? ''], view), null);
    await store.getState().apply(both.changes);
    const pastedCam = both.ids.find((id) => records()[id]?.props.kind === 'camera');
    const pastedMark = both.ids.find((id) => records()[id]?.props.kind === 'mark');
    expect(records()[pastedMark ?? '']?.props.camera_id).toBe(pastedCam);
    expect(records()[pastedMark ?? '']?.parentId).toBe(setupPlanOf(records(), setupId)?.id);
    // The mark alone: a plain mark, in the scene's blocking.
    const alone = planPasteInView(records(), view, planClipOf(records(), [m2 ?? ''], view), null);
    await store.getState().apply(alone.changes);
    const plain = alone.ids[0] ?? '';
    expect(records()[plain]?.props.camera_id).toBeUndefined();
    expect(records()[plain]?.parentId).toBe(blockingPlanOf(records(), sceneId)?.id);
    // ANA's mark pasted into the other setup keeps her.
    const other = planPasteInView(records(), { sceneId, setupId: otherId }, planClipOf(records(), [first ?? ''], view), null);
    await store.getState().apply(other.changes);
    expect(records()[other.ids[0] ?? '']?.props.character_id).toBe('ana');
    expect(records()[other.ids[0] ?? '']?.parentId).toBe(blockingPlanOf(records(), sceneId)?.id);
  });

  it('a paste into a scene with no blocking makes one in the same step', async () => {
    const { sceneId, setupId } = await scene();
    const view = { sceneId, setupId };
    const [first] = await anaWalks(view);
    const clip = planClipOf(records(), [first ?? ''], view);
    const second = crypto.randomUUID();
    await store.getState().apply([
      { kind: 'create', record: { id: second, type: 'scene', parentId: project.projectId, sortKey: '2', props: { number: '2', room_id: records()[sceneId]?.props.room_id ?? '' } } },
    ]);
    const made = planPasteInView(records(), { sceneId: second, setupId: null }, clip, null, crypto.randomUUID(), 'blk2');
    expect(made.changes[0]).toMatchObject({ kind: 'create', record: { id: 'blk2', type: 'plan', parentId: second } });
    await store.getState().apply(made.changes);
    expect(records()[made.ids[0] ?? '']?.parentId).toBe('blk2');
  });
});

describe('every write is readable (6.7)', () => {
  it('a mark past the plan’s reach is refused, as every plan write is', async () => {
    const { sceneId, setupId } = await scene();
    const view = { sceneId, setupId };
    const [first] = await anaWalks(view);
    expect(unreadableAfter(records(), [{ kind: 'update', id: first ?? '', set: { x: 1e9 } }])).toBe(true);
    const far = await nextPosition(view, first ?? '', project, { x: 1e9, y: 0 }, store);
    expect(far).toBeNull();
    // Nothing written: still three positions.
    expect(viewBlocking(records(), sceneId, setupId).characters[0]?.positions).toHaveLength(3);
  });
});

describe('the path’s drawing (6.7)', () => {
  it('stops at each mark’s edge, dashed ink with an arrowhead at the later end', () => {
    expect(segmentEnds({ x: 0, y: 0 }, { x: 100, y: 0 }, 10, 20)).toEqual([10, 0, 80, 0]);
    expect(segmentEnds({ x: 0, y: 0 }, { x: 20, y: 0 }, 10, 20)).toBeNull();
    const drawn = PathShape({ path: { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], radii: [10, 20], fit: { x: 0, y: 0, width: 100, height: 0 } }, box: { x: -10, y: -10, width: 20, height: 20, rotation: 0 }, zoom: 1, colours: PAPER_COLOURS });
    const parts = (drawn as ReactElement<{ children: ReactNode[] }>).props.children;
    const [line, head] = parts as ReactElement<{ points: number[]; dash?: number[]; stroke?: string; fill?: string; closed?: boolean }>[];
    expect(line?.props.dash).toEqual([6, 4]);
    expect(line?.props.stroke).toBe(PAPER_COLOURS.ink);
    // In the first position's own box: its middle at (10, 10).
    expect(line?.props.points.slice(0, 2)).toEqual([20, 10]);
    expect(head?.props.closed).toBe(true);
    expect(head?.props.points.slice(0, 2)).toEqual([90, 10]);
  });
});

describe('the builder’s rebuild rule (6.7)', () => {
  it('makes a mark’s or a camera’s item again when anything it draws changes, and only then', async () => {
    const { sceneId, setupId } = await scene();
    const view = { sceneId, setupId };
    const [first, , third] = await anaWalks(view);
    const cam = crypto.randomUUID();
    await store.getState().apply(placeIconChanges(records(), view, 'camera/camera', { x: 5, y: 0 }, cam));
    await nextPosition(view, cam, project, null, store);
    const [ghost] = selected(view);
    const build = planItemsBuilder();
    const items = (unit: 'metres' | 'feet' = 'metres', locale = 'en') => {
      const shown = shownItems(records(), sceneId, setupId);
      return build(shown, unit, PAPER_COLOURS.ink, locale, cameraLooks(records(), shown, unit, []), new Map(), new Map(), blockingLooks(records(), view, shown, unit, []));
    };
    const find = (list: ReturnType<typeof items>, id: string) => list.find((i) => i.id === id);
    let was = items();
    const changed = async (what: string, id: string, edit: () => Promise<unknown>) => {
      await edit();
      const now = items();
      expect(find(now, id), what).not.toBe(find(was, id));
      was = now;
    };
    // An edit elsewhere leaves them as they were.
    await store.getState().apply([{ kind: 'update', id: 'a', set: { name: 'Ana walks in' } }]);
    expect(find(items(), first ?? '')).toBe(find(was, first ?? ''));
    expect(find(items(), cam)).toBe(find(was, cam));
    was = items();
    // Position 3 moved: the first position, which carries the path, is made again.
    await changed('a later position moved', first ?? '', () => store.getState().apply([{ kind: 'update', id: third ?? '', set: { x: 4 } }]));
    await changed('the character’s name', first ?? '', () => store.getState().apply([{ kind: 'update', id: 'ana', set: { name: 'ANNA' } }]));
    expect(find(was, first ?? '')?.label).toMatch(/^ANNA, position 1 of 3/);
    // The camera's lens: the ghost's cone is made again; its later position moved: the camera, which carries the path.
    await changed('the camera’s lens', ghost ?? '', () => store.getState().apply([{ kind: 'update', id: cam, set: { lens_mm: 24 } }]));
    await changed('the camera’s later position', cam, () => store.getState().apply([{ kind: 'update', id: ghost ?? '', set: { y: 2 } }]));
    // The unit and the language.
    const feet = items('feet');
    expect(find(feet, ghost ?? '')).not.toBe(find(was, ghost ?? ''));
    setLocale('es');
    const spanish = items('feet', 'es');
    expect(find(spanish, first ?? '')).not.toBe(find(feet, first ?? ''));
    expect(find(spanish, first ?? '')?.label).toMatch(/posición 1 de 3/);
  });
});

describe('the letter and number inside a character’s mark (6.7)', () => {
  // The kit's cast-mark and next-position drawings print "A1" and "A2": a character's mark draws its own initial and
  // number in their place, so BEN's first position never reads "A1" over a "BEN 1" label.
  it('draws the character’s first letter and the position’s real number; a camera’s later position draws its icon', async () => {
    const { sceneId, setupId } = await scene();
    const view = { sceneId, setupId };
    const [a1, , a3] = await anaWalks(view);
    expect(await placeMark(view, { x: 4, y: 4 }, project, store)).toBeNull();
    const [b1] = selected(view);
    await setMarkOwnerIn(view, b1 ?? '', 'ben');
    const cam = crypto.randomUUID();
    await store.getState().apply(placeIconChanges(records(), view, 'camera/camera', { x: 6, y: 0 }, cam));
    await nextPosition(view, cam, project, null, store);
    const [ghost] = selected(view);
    const build = planItemsBuilder();
    const looks = () => blockingLooks(records(), view, shownItems(records(), sceneId, setupId), 'metres', []);
    const items = () => {
      const shown = shownItems(records(), sceneId, setupId);
      return build(shown, 'metres', PAPER_COLOURS.ink, 'en', cameraLooks(records(), shown, 'metres', []), new Map(), new Map(), looks());
    };
    const textsOf = (id: string) => looks().marks.get(id)?.texts;
    expect(textsOf(b1 ?? '')).toBe('B1');
    expect(textsOf(a1 ?? '')).toBe('A1');
    expect(textsOf(a3 ?? '')).toBe('A3');
    expect(looks().marks.get(a3 ?? '')?.icon).toBe('cast/next-position');
    // A camera's later position is the camera's own icon, with nothing replaced.
    expect(looks().marks.get(ghost ?? '')).toMatchObject({ icon: 'camera/camera', ghost: true });
    expect(textsOf(ghost ?? '')).toBeUndefined();

    // Drawn: the icon's text part says "B1", "A3"; with no override (the Library's thumbnails), the kit's own.
    const drawnText = (icon: string, texts: IconTexts | undefined) =>
      (iconNodesWith(icon, texts) ?? []).flatMap((node) => {
        const part = (node as ReactElement<{ part?: { text: string } }>).props.part;
        return part ? [part.text] : [];
      });
    expect(drawnText('cast/cast-mark', 'B1')).toEqual(['B1']);
    expect(drawnText('cast/next-position', 'A3')).toEqual(['A3']);
    expect(drawnText('cast/cast-mark', undefined)).toEqual(['A1']);
    expect(drawnText('cast/next-position', undefined)).toEqual(['A2']);
    expect(iconNodesWith('cast/cast-mark', undefined)).toBe(iconNodes('cast/cast-mark'));
    // A map replaces only the text it names.
    expect(drawnText('cast/cast-mark', { A1: 'C1' })).toEqual(['C1']);
    expect(drawnText('cast/cast-mark', { A2: 'C1' })).toEqual(['A1']);
    const shape = (id: string) => {
      const item = items().find((i) => i.id === id);
      const drawn = item?.draw?.({ width: item.width, height: item.height, zoom: 1, colours: PAPER_COLOURS, inView: true });
      return isValidElement(drawn) ? (drawn as ReactElement<{ texts?: string }>).props.texts : null;
    };
    expect(shape(b1 ?? '')).toBe('B1');

    // Renamed, the mark is made again with the new initial; a character with no name draws "?".
    const before = items().find((i) => i.id === b1);
    await store.getState().apply([{ kind: 'update', id: 'ben', set: { name: 'zed' } }]);
    expect(items().find((i) => i.id === b1)).not.toBe(before);
    expect(shape(b1 ?? '')).toBe('Z1');
    await store.getState().apply([{ kind: 'update', id: 'ben', set: { name: '  ' } }]);
    expect(textsOf(b1 ?? '')).toBe('?1');
    expect(characterInitial(records(), 'nobody')).toBe('?');
  });
});
