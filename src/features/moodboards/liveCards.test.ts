import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import { COMPANY_LOGO_ROLE } from '../../app/company/companyEdits';
import { setLocale } from '../../core/i18n';
import type { PreparedImage } from '../../core/media/store';
import { emptyPalette, paletteChange, type Palette } from '../../core/model/palette';
import type { SbdRecord } from '../../core/model/record';
import { shotFields } from '../../core/model/storyboard';
import { log } from '../../core/ops/ops';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { loadSteps } from '../history/steps';
import { lineText } from '../history/summary';
import { addShot, board, trashScene, trashShot } from '../storyboard/board';
import { setPicture } from '../storyboard/framePictures';
import { addStroke } from '../storyboard/sketch/strokes';
import { restoreChanges, trashItems } from '../trash/trash';
import { boardLinks, boardsLinkedTo, linkedLine, linkedRecords, newBoard, openDepartmentBoard, setLinksChange } from './boards';
import { clipOf, itemFields, itemsOf, pasteChanges, propsFor, styleChanges, trashItemsChanges } from './items';
import { cardChanges } from './liveAdd';
import { designSize, drawScale, letterbox, liveCardData, liveLabel, pickScenes, projectIdOf, stateWords, type LiveCardData, type LiveRef } from './liveCards';

// Live cards (5.4): shots, scenes, palettes and the brand kit shown on a board from the project as it is now, and a board's
// links. Cards store only which record they show; everything else is read each time.

let folder: TestFolder;
let project: Project;
let store = createProjectStore();
let sceneId = '';
let shotIds: string[] = [];
let boardId = '';

beforeEach(async () => {
  setLocale('en');
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  store = createProjectStore();
  await store.getState().open(project);
  sceneId = 'sc4';
  await store.getState().apply([
    { kind: 'create', record: { id: sceneId, type: 'scene', parentId: project.projectId, sortKey: 'V', props: { number: '4', name: 'Kitchen', int_ext: 'INT', day_night: 'NIGHT' } } },
  ]);
  shotIds = [];
  for (let i = 0; i < 3; i += 1) {
    const added = addShot(records(), project.projectId, sceneId);
    await store.getState().apply(added.changes);
    shotIds.push(added.shotId);
  }
  const opened = openDepartmentBoard(records(), project.projectId, 'camera');
  await store.getState().apply(opened.changes);
  boardId = opened.id;
});
afterEach(async () => {
  await store.getState().close();
  folder.remove();
});

const records = () => store.getState().records;
const groups = async () => (await log(project.file)).length;
const refOf = (id: string): LiveRef => {
  const fields = itemFields(records()[id]?.props ?? {});
  if (!fields || !['shot_card', 'scene_card', 'palette_card', 'brand_card'].includes(fields.kind)) throw new Error('not a live card');
  return { kind: fields.kind as LiveRef['kind'], shotId: fields.shotId, sceneId: fields.sceneId };
};
const dataOf = (id: string): LiveCardData => liveCardData(records(), projectIdOf(records(), id), refOf(id));
const shot = (data: LiveCardData) => {
  if (data.kind !== 'shot_card') throw new Error('a shot card');
  return data;
};

async function addCards(targets: Parameters<typeof cardChanges>[2], centre = { x: 0, y: 0 }) {
  const made = cardChanges(records(), boardId, targets, centre);
  await store.getState().apply(made.changes);
  return made.ids;
}

describe('a shot card', () => {
  it('stores only the frame it shows, and reads the frame as it is now: no op on the card', async () => {
    const [a] = shotIds as [string];
    const [card] = await addCards([{ kind: 'shot_card', shotId: a }]);
    if (!card) throw new Error('the card');
    expect(Object.keys(records()[card]?.props ?? {}).sort()).toEqual(['height', 'kind', 'rotation', 'shot_id', 'width', 'x', 'y']);
    expect(records()[card]?.props).toMatchObject({ kind: 'shot_card', width: 320, rotation: 0, shot_id: a });
    expect(shot(dataOf(card))).toMatchObject({ state: 'live', size: '', lens: '' });
    const before = records()[card];
    const groupsBefore = await groups();
    await store.getState().apply([{ kind: 'update', id: a, set: { size: 'MCU', lens_mm: 50, move: 'push in', status: 'have' } }]);
    // The move as the storyboard's shot list shows it, in the app's language, never its stored key.
    expect(shot(dataOf(card))).toMatchObject({ state: 'live', size: 'MCU', lens: '50MM', lensMm: 50, move: 'Push in', status: 'have' });
    setLocale('es');
    expect(shot(dataOf(card))).toMatchObject({ move: 'Acercamiento' });
    setLocale('en');
    // Only the frame's edit was written; the card's record is the very one it was.
    expect(await groups()).toBe(groupsBefore + 1);
    expect(records()[card]).toBe(before);
    await store.getState().apply([{ kind: 'update', id: a, set: { lens_mm: 85 } }]);
    expect(shot(dataOf(card)).lens).toBe('85MM');
    expect(records()[card]).toBe(before);
  });

  it('shows the number exactly as the storyboard has it, and follows a renumber', async () => {
    const targets = shotIds.map((shotId) => ({ kind: 'shot_card' as const, shotId }));
    const cards = await addCards(targets);
    const numbers = board(records(), project.projectId)[0]?.shots.map((s) => s.fields.number);
    expect(numbers).toEqual(['4A', '4B', '4C']);
    expect(cards.map((id) => shot(dataOf(id)).number)).toEqual(numbers);
    // The first frame trashed: the letters close up on the board, so 4B becomes 4A and 4C becomes 4B, and the cards show them.
    await store.getState().applyWith((now, slate) => ({ changes: trashShot(now, project.projectId, shotIds[0] ?? '', slate) }));
    expect(cards.map((id) => shot(dataOf(id)).number)).toEqual(['4A', '4A', '4B']);
    expect(shot(dataOf(cards[0] ?? '')).state).toBe('trash');
    expect(shotFields(records()[shotIds[1] ?? '']?.props ?? {}).number).toBe('4A');
  });

  it('is announced as "Shot card 4A, MCU, 50 mm", and says when its frame is in the Trash', async () => {
    const [a] = shotIds as [string];
    const [card] = await addCards([{ kind: 'shot_card', shotId: a }]);
    await store.getState().apply([{ kind: 'update', id: a, set: { size: 'MCU', lens_mm: 50 } }]);
    expect(liveLabel(dataOf(card ?? ''))).toBe('Shot card 4A, MCU, 50 mm');
    await store.getState().apply([{ kind: 'update', id: a, set: { move: 'track' } }]);
    expect(liveLabel(dataOf(card ?? ''))).toBe('Shot card 4A, MCU, 50 mm, Track');
    await store.getState().applyWith((now, slate) => ({ changes: trashShot(now, project.projectId, a, slate) }));
    expect(liveLabel(dataOf(card ?? ''))).toContain('In the Trash');
    setLocale('es');
    expect(stateWords('shot_card', 'trash')).toBe('En la papelera');
    expect(stateWords('shot_card', 'gone')).toBe('Plano eliminado');
  });

  it('draws the frame’s picture when it has one, and its sketch when it hasn’t', async () => {
    const [a, b] = shotIds as [string, string];
    const cards = await addCards([
      { kind: 'shot_card', shotId: a },
      { kind: 'shot_card', shotId: b },
    ]);
    expect(shot(dataOf(cards[0] ?? '')).sha256).toBeNull();
    const bytes = new Uint8Array(2000).map((_, i) => (i * 7) % 256);
    const image: PreparedImage = {
      original: { sha256: createHash('sha256').update(bytes).digest('hex'), bytes, mime: 'image/jpeg', width: 2560, height: 1440, colorSpace: 'srgb' },
      thumbnail: { bytes: bytes.slice(0, 300), mime: 'image/jpeg', width: 640, height: 360, longEdge: 640 },
    };
    const edit = setPicture(records(), a, { image, source: { name: 'kitchen.jpg' } }, project.file.path);
    await store.getState().apply(edit.changes);
    expect(shot(dataOf(cards[0] ?? '')).sha256).toBe(image.original.sha256);
    // The card shows the picture the frame shows, not a copy: the card holds nothing of it.
    expect(JSON.stringify(records()[cards[0] ?? '']?.props)).not.toContain(image.original.sha256);
    await store.getState().apply([addStroke(records(), b, { tool: 'pen', points: [0.1, 0.1, 0.5, 0.5], width: 0.008, pressures: null })]);
    expect(shot(dataOf(cards[1] ?? '')).strokes).toHaveLength(1);
    expect(shot(dataOf(cards[1] ?? '')).sha256).toBeNull();
  });

  it('draws dimmed in the Trash and stays on the board, then reads "Shot removed" once deleted for good', async () => {
    const [a] = shotIds as [string];
    const [card] = await addCards([{ kind: 'shot_card', shotId: a }]);
    await store.getState().applyWith((now, slate) => ({ changes: trashShot(now, project.projectId, a, slate) }));
    const trashed = shot(dataOf(card ?? ''));
    expect(trashed.state).toBe('trash');
    expect(stateWords('shot_card', trashed.state)).toBe('In the Trash');
    // The card itself is untouched and still on the board.
    expect(itemsOf(records(), boardId).map((r) => r.id)).toContain(card);
    expect(records()[card ?? '']?.trashedAt).toBeNull();
    await store.getState().apply(restoreChanges(records(), project.projectId, a));
    expect(shot(dataOf(card ?? '')).state).toBe('live');
    // Gone for good (Empty Trash): the record isn't there at all.
    const without = Object.fromEntries(Object.entries(records()).filter(([id]) => id !== a));
    const gone = liveCardData(without, project.projectId, refOf(card ?? ''));
    expect(gone).toMatchObject({ kind: 'shot_card', state: 'gone', number: '' });
    expect(stateWords('shot_card', 'gone')).toBe('Shot removed');
    expect(liveLabel(gone)).toBe('Shot card: Shot removed');
    // Neither is an error: a size can still be worked out to draw it in.
    expect(designSize(gone.kind).width).toBe(320);
  });
});

describe('a scene card', () => {
  it('reads the heading as the board shows it, how many frames, and the first four', async () => {
    const [card] = await addCards([{ kind: 'scene_card', sceneId }]);
    const data = dataOf(card ?? '');
    if (data.kind !== 'scene_card') throw new Error('a scene card');
    expect(data).toMatchObject({ state: 'live', label: 'SC 04', heading: 'INT. KITCHEN — NIGHT', frames: 3 });
    expect(data.first.map((f) => f.number)).toEqual(['4A', '4B', '4C']);
    for (let i = 0; i < 3; i += 1) {
      const added = addShot(records(), project.projectId, sceneId);
      await store.getState().apply(added.changes);
    }
    const six = dataOf(card ?? '');
    if (six.kind !== 'scene_card') throw new Error('a scene card');
    expect(six.frames).toBe(6);
    expect(six.first.map((f) => f.number)).toEqual(['4A', '4B', '4C', '4D']);
    expect(liveLabel(six)).toBe('Scene card SC 04 INT. KITCHEN — NIGHT, 6 frames');
  });

  it('draws dimmed in the Trash, and says the scene is removed when it is gone', async () => {
    const [card] = await addCards([{ kind: 'scene_card', sceneId }]);
    await store.getState().apply(trashScene(records(), sceneId));
    expect(dataOf(card ?? '')).toMatchObject({ kind: 'scene_card', state: 'trash' });
    const without = Object.fromEntries(Object.entries(records()).filter(([id]) => id !== sceneId));
    const gone = liveCardData(without, project.projectId, refOf(card ?? ''));
    expect(gone).toMatchObject({ state: 'gone', frames: 0 });
    expect(stateWords('scene_card', 'gone')).toBe('Scene removed');
  });
});

describe('a palette card', () => {
  const palette = (hexes: string[]): Palette => ({ ...emptyPalette(), colors: hexes.map((hex) => ({ hex, locked: false, raw: {} })) });

  it('reads the scene’s palette as it is now, in its order, and says when there is none', async () => {
    const [card] = await addCards([{ kind: 'palette_card', sceneId }]);
    expect(dataOf(card ?? '')).toMatchObject({ kind: 'palette_card', state: 'live', colors: [], label: 'SC 04' });
    await store.getState().apply([{ kind: 'update', id: sceneId, ...paletteChange(palette(['#A35139', '#1F2F4D', '#EEE9DF'])) }]);
    expect(dataOf(card ?? '')).toMatchObject({ colors: ['#A35139', '#1F2F4D', '#EEE9DF'] });
    await store.getState().apply([{ kind: 'update', id: sceneId, ...paletteChange(palette(['#1F2F4D'])) }]);
    expect(dataOf(card ?? '')).toMatchObject({ colors: ['#1F2F4D'] });
    // The card has no colours of its own.
    expect(JSON.stringify(records()[card ?? '']?.props)).not.toContain('1F2F4D');
    expect(liveLabel(dataOf(card ?? ''))).toBe('Palette card SC 04 INT. KITCHEN — NIGHT, 1 colour');
  });

  it('is drawn at scale 1 whether the palette has 1 colour or 16: the box never depends on the content', async () => {
    const [card] = await addCards([{ kind: 'palette_card', sceneId }]);
    const box = () => itemFields(records()[card ?? '']?.props ?? {}) as NonNullable<ReturnType<typeof itemFields>>;
    const scale = () => drawScale('palette_card', box().width, box().height);
    const before = { width: box().width, height: box().height };
    await store.getState().apply([{ kind: 'update', id: sceneId, ...paletteChange(palette(['#111111'])) }]);
    expect(scale()).toBe(1);
    await store.getState().apply([{ kind: 'update', id: sceneId, ...paletteChange(palette(Array.from({ length: 16 }, (_, i) => `#0000${i.toString(16).padStart(2, '0')}`))) }]);
    expect((dataOf(card ?? '') as { colors: string[] }).colors).toHaveLength(16);
    expect(scale()).toBe(1);
    // Nothing was written to the card, and sixteen colours is four rows of the room it has.
    expect({ width: box().width, height: box().height }).toEqual(before);
    expect(Math.ceil(16 / 4) * 88 + 64).toBeLessThanOrEqual(before.height);
  });

  it('is drawn at scale 1 for a shot card when the project’s aspect changes, and a scene card too', async () => {
    const cards = await addCards([
      { kind: 'shot_card', shotId: shotIds[0] ?? '' },
      { kind: 'scene_card', sceneId },
    ]);
    const scales = () => cards.map((id) => {
      const f = itemFields(records()[id]?.props ?? {});
      return f ? drawScale(f.kind as 'shot_card', f.width, f.height) : 0;
    });
    expect(scales()).toEqual([1, 1]);
    await store.getState().apply([{ kind: 'update', id: project.projectId, set: { aspect_ratio: '2.39:1' } }]);
    expect(shot(dataOf(cards[0] ?? '')).aspect).toBeCloseTo(2.39);
    expect(scales()).toEqual([1, 1]);
    await store.getState().apply([{ kind: 'update', id: project.projectId, set: { aspect_ratio: '9:16' } }]);
    expect(scales()).toEqual([1, 1]);
    // The frame is letterboxed inside the fixed 16:9 area, tall or wide, never outside it.
    for (const aspect of [2.39, 16 / 9, 9 / 16, 1]) {
      const box = letterbox(aspect, 320, 180);
      expect(box.width).toBeLessThanOrEqual(320);
      expect(box.height).toBeLessThanOrEqual(180 + 1e-9);
      expect(box.width / box.height).toBeCloseTo(aspect);
      expect(box.x * 2 + box.width).toBeCloseTo(320);
    }
  });
});

describe('a brand-kit card', () => {
  const company = (extra: Record<string, unknown> = {}) => ({
    profile_id: 'co1',
    name: 'Zima Blue Pictures',
    logo_id: null,
    brand_colors: ['#DF5E27', '#16150F'],
    brand_fonts: ['Jost', 'Outfit'],
    ...extra,
  });

  it('says so with no company attached, then reads the project’s own copy of the kit', async () => {
    const [card] = await addCards([{ kind: 'brand_card' }]);
    expect(dataOf(card ?? '')).toMatchObject({ kind: 'brand_card', company: null, colors: [], fonts: [] });
    expect(liveLabel(dataOf(card ?? ''))).toBe('Brand kit, no company attached');
    await store.getState().apply([{ kind: 'update', id: project.projectId, set: { company: company() } }]);
    expect(dataOf(card ?? '')).toMatchObject({ company: { name: 'Zima Blue Pictures' }, colors: ['#DF5E27', '#16150F'], fonts: ['Jost', 'Outfit'], logoSha256: null });
    expect(liveLabel(dataOf(card ?? ''))).toBe('Brand kit, Zima Blue Pictures');
    // The card stores nothing of it.
    expect(records()[card ?? '']?.props).not.toHaveProperty('brand_colors');
    // Edited in the project: the card follows. The kit is limited to eight colours and three fonts, hex only.
    await store.getState().apply([{ kind: 'update', id: project.projectId, set: { company: company({ brand_colors: ['#112233', 'nope', ...Array.from({ length: 9 }, (_, i) => `#00000${String(i)}`)], brand_fonts: ['a', 'b', 'c', 'd'] }) } }]);
    const read = dataOf(card ?? '');
    if (read.kind !== 'brand_card') throw new Error('a brand card');
    expect(read.colors).toHaveLength(8);
    expect(read.colors[0]).toBe('#112233');
    expect(read.fonts).toEqual(['a', 'b', 'c']);
  });

  it('is drawn at scale 1 when a company with a full kit is attached after the card was added', async () => {
    const [card] = await addCards([{ kind: 'brand_card' }]);
    const fields = itemFields(records()[card ?? '']?.props ?? {});
    if (!fields) throw new Error('the card');
    expect(drawScale('brand_card', fields.width, fields.height)).toBe(1);
    await store.getState().apply([
      { kind: 'update', id: project.projectId, set: { company: company({ brand_colors: Array.from({ length: 8 }, (_, i) => `#00000${String(i)}`), brand_fonts: ['Jost', 'Outfit', 'Bodoni Moda'] }) } },
    ]);
    expect(dataOf(card ?? '')).toMatchObject({ fonts: ['Jost', 'Outfit', 'Bodoni Moda'] });
    expect((dataOf(card ?? '') as { colors: string[] }).colors).toHaveLength(8);
    const after = itemFields(records()[card ?? '']?.props ?? {});
    expect(after).toMatchObject({ width: fields.width, height: fields.height });
    expect(drawScale('brand_card', fields.width, fields.height)).toBe(1);
    // Eight colours (two rows), three fonts and the logo fit the design.
    expect(designSize('brand_card').height).toBeGreaterThanOrEqual(12 + 84 + 8 + 36 + 2 * 88 + 8 + 3 * 34 + 8);
  });

  it('shows the company’s logo picture from the project, and no other media', async () => {
    const logo: SbdRecord['props'] = { kind: 'image', role: COMPANY_LOGO_ROLE, file: 'a'.repeat(64), mime: 'image/png', width: 100, height: 40, color_space: 'srgb', source_name: 'logo.png' };
    await store.getState().apply([
      { kind: 'create', record: { id: 'logo1', type: 'media', parentId: project.projectId, sortKey: 'a', props: logo } },
      { kind: 'update', id: project.projectId, set: { company: company({ logo_id: 'logo1' }) } },
    ]);
    const [card] = await addCards([{ kind: 'brand_card' }]);
    const read = dataOf(card ?? '');
    expect(read).toMatchObject({ kind: 'brand_card', logoSha256: 'a'.repeat(64) });
    // A logo_id naming something that isn't the company's logo shows no logo.
    await store.getState().apply([{ kind: 'update', id: project.projectId, set: { company: company({ logo_id: sceneId }) } }]);
    expect(dataOf(card ?? '')).toMatchObject({ logoSha256: null });
  });
});

describe('adding cards from the storyboard', () => {
  it('lands a tidied row at the view’s middle in one op group, selected by the caller, and leaves out what isn’t live', async () => {
    const before = await groups();
    const ids = await addCards(
      [
        { kind: 'scene_card', sceneId },
        { kind: 'shot_card', shotId: shotIds[0] ?? '' },
        { kind: 'shot_card', shotId: shotIds[1] ?? '' },
        { kind: 'shot_card', shotId: 'gone-for-good' },
      ],
      { x: 1000, y: 500 },
    );
    expect(await groups()).toBe(before + 1);
    expect(ids).toHaveLength(3);
    const boxes = ids.map((id) => itemFields(records()[id]?.props ?? {}));
    // A row: tops level, 24 units apart, in the order given, centred on the point.
    const [scene, one, two] = boxes;
    expect(scene && one && two).toBeTruthy();
    if (!scene || !one || !two) return;
    expect(one.x).toBe(scene.x + scene.width + 24);
    expect(two.x).toBe(one.x + one.width + 24);
    const left = scene.x;
    const right = two.x + two.width;
    expect((left + right) / 2).toBeCloseTo(1000, 0);
    const tallest = Math.max(scene.height, one.height, two.height);
    expect(scene.y + tallest / 2).toBeCloseTo(500, 0);
    // One undo takes them all back.
    await store.getState().undo();
    expect(itemsOf(records(), boardId)).toHaveLength(0);
  });

  it('puts nothing on a board that went to the Trash, and nothing for a frame in the Trash', async () => {
    await store.getState().applyWith((now, slate) => ({ changes: trashShot(now, project.projectId, shotIds[0] ?? '', slate) }));
    const ids = await addCards([{ kind: 'shot_card', shotId: shotIds[0] ?? '' }]);
    expect(ids).toEqual([]);
  });

  it('copies and pastes a card within the project, still naming its frame', async () => {
    const [card] = await addCards([{ kind: 'shot_card', shotId: shotIds[0] ?? '' }]);
    const clip = clipOf(records(), boardId, [card ?? '']);
    expect(clip).toHaveLength(1);
    const pasted = pasteChanges(records(), boardId, clip, null);
    await store.getState().apply(pasted.changes);
    const copy = itemFields(records()[pasted.ids[0] ?? '']?.props ?? {});
    expect(copy).toMatchObject({ kind: 'shot_card', shotId: shotIds[0] });
    // A card takes no style from the strip.
    expect(styleChanges(records(), [card ?? ''], { fill: '#FFFFFF', textColor: '#000000' })).toEqual([]);
  });

  it('writes a card’s props as its record and nothing it draws', () => {
    const base = { x: 0, y: 0, width: 10, height: 10, rotation: 0 };
    expect(propsFor({ ...base, kind: 'shot_card', shotId: 's' })).toMatchObject({ kind: 'shot_card', shot_id: 's' });
    expect(propsFor({ ...base, kind: 'scene_card', sceneId: 'c' })).toMatchObject({ kind: 'scene_card', scene_id: 'c' });
    expect(propsFor({ ...base, kind: 'palette_card', sceneId: 'c' })).toMatchObject({ kind: 'palette_card', scene_id: 'c' });
    expect(Object.keys(propsFor({ ...base, kind: 'brand_card' })).sort()).toEqual(['height', 'kind', 'rotation', 'width', 'x', 'y']);
  });
});

describe('the picker’s search', () => {
  it('lists the scenes in order with their frames, and finds by scene number, heading or shot number', async () => {
    const second = { kind: 'create' as const, record: { id: 'sc5', type: 'scene' as const, parentId: project.projectId, sortKey: 'W', props: { number: '5', name: 'Rooftop', int_ext: 'EXT', day_night: 'DAY' } } };
    await store.getState().apply([second]);
    const added = addShot(records(), project.projectId, 'sc5');
    await store.getState().apply(added.changes);
    const scenes = board(records(), project.projectId);
    const all = pickScenes(scenes, '');
    expect(all.map((s) => [s.label, s.frames.map((f) => f.number)])).toEqual([
      ['SC 04', ['4A', '4B', '4C']],
      ['SC 05', ['5A']],
    ]);
    expect(pickScenes(scenes, '5').map((s) => s.label)).toEqual(['SC 05']);
    expect(pickScenes(scenes, 'sc 05').map((s) => s.id)).toEqual(['sc5']);
    expect(pickScenes(scenes, 'kitchen').map((s) => s.id)).toEqual([sceneId]);
    expect(pickScenes(scenes, 'rooftop')[0]?.frames.map((f) => f.number)).toEqual(['5A']);
    // A shot number lists that frame alone, under its scene.
    expect(pickScenes(scenes, '4b')).toEqual([expect.objectContaining({ id: sceneId, frames: [expect.objectContaining({ number: '4B' })] })]);
    expect(pickScenes(scenes, 'zzz')).toEqual([]);
  });
});

describe('a board’s links', () => {
  async function withPeople() {
    const rooftop = { kind: 'create' as const, record: { id: 'loc1', type: 'location' as const, parentId: project.projectId, sortKey: 'a', props: { name: 'Rooftop' } } };
    const maya = { kind: 'create' as const, record: { id: 'ch1', type: 'character' as const, parentId: project.projectId, sortKey: 'a', props: { name: 'MAYA' } } };
    await store.getState().apply([rooftop, maya]);
  }

  it('links scenes, characters and locations in one edit, and shows them as "SC 04, MAYA, Rooftop"', async () => {
    await withPeople();
    const before = await groups();
    const changes = setLinksChange(records(), boardId, { sceneIds: [sceneId], characterIds: ['ch1'], locationIds: ['loc1'] });
    await store.getState().apply(changes);
    expect(await groups()).toBe(before + 1);
    const board = records()[boardId];
    if (!board) throw new Error('the board');
    expect(board.props).toMatchObject({ scene_ids: [sceneId], character_ids: ['ch1'], location_ids: ['loc1'] });
    expect(linkedLine(records(), board)).toBe('SC 04, MAYA, Rooftop');
    // Setting the same links writes nothing; emptying one list takes it off the record.
    expect(setLinksChange(records(), boardId, { sceneIds: [sceneId], characterIds: ['ch1'], locationIds: ['loc1'] })).toEqual([]);
    await store.getState().apply(setLinksChange(records(), boardId, { sceneIds: [sceneId], characterIds: [], locationIds: ['loc1'] }));
    expect(records()[boardId]?.props).not.toHaveProperty('character_ids');
    expect(linkedLine(records(), records()[boardId] as SbdRecord)).toBe('SC 04, Rooftop');
  });

  it('drops a linked record in the Trash from the line, and brings the link back with a restore', async () => {
    await withPeople();
    await store.getState().apply(setLinksChange(records(), boardId, { sceneIds: [sceneId], characterIds: ['ch1'], locationIds: ['loc1'] }));
    await store.getState().apply(trashScene(records(), sceneId));
    await store.getState().apply([{ kind: 'trash', id: 'loc1' }]);
    const board = records()[boardId] as SbdRecord;
    expect(linkedLine(records(), board)).toBe('MAYA');
    expect(linkedRecords(records(), board).scenes).toEqual([]);
    // The id stays in the list, and a save from the picker with the trashed ones unseen keeps them.
    expect(boardLinks(board.props).sceneIds).toEqual([sceneId]);
    await store.getState().apply(setLinksChange(records(), boardId, { sceneIds: [], characterIds: ['ch1'], locationIds: [] }));
    expect(boardLinks(records()[boardId]?.props ?? {})).toEqual({ sceneIds: [sceneId], characterIds: ['ch1'], locationIds: ['loc1'] });
    await store.getState().apply(restoreChanges(records(), project.projectId, 'loc1'));
    expect(linkedLine(records(), records()[boardId] as SbdRecord)).toBe('MAYA, Rooftop');
  });

  it('writes no step for the same links in another order, and drops an id whose record is gone for good', async () => {
    await withPeople();
    const second = { kind: 'create' as const, record: { id: 'ch2', type: 'character' as const, parentId: project.projectId, sortKey: 'b', props: { name: 'JUNE' } } };
    await store.getState().apply([second]);
    await store.getState().apply(setLinksChange(records(), boardId, { sceneIds: [sceneId], characterIds: ['ch1', 'ch2'], locationIds: ['loc1'] }));
    const before = await groups();
    // The same links, the characters the other way round: nothing to write.
    expect(setLinksChange(records(), boardId, { sceneIds: [sceneId], characterIds: ['ch2', 'ch1'], locationIds: ['loc1'] })).toEqual([]);
    await store.getState().apply(setLinksChange(records(), boardId, { sceneIds: [sceneId], characterIds: ['ch2', 'ch1'], locationIds: ['loc1'] }));
    expect(await groups()).toBe(before);
    expect(boardLinks(records()[boardId]?.props ?? {}).characterIds).toEqual(['ch1', 'ch2']);
    // The location is deleted for good: the next save drops its id, and the other lists stay.
    await store.getState().apply([{ kind: 'trash', id: 'loc1' }]);
    expect(await store.getState().emptyTrash()).not.toBeNull();
    expect(records().loc1).toBeUndefined();
    await store.getState().apply(setLinksChange(records(), boardId, { sceneIds: [sceneId], characterIds: ['ch1', 'ch2'], locationIds: [] }));
    expect(boardLinks(records()[boardId]?.props ?? {})).toEqual({ sceneIds: [sceneId], characterIds: ['ch1', 'ch2'], locationIds: [] });
    expect(records()[boardId]?.props).not.toHaveProperty('location_ids');
  });

  it('is read the other way: the live boards that link to a scene, character or location', async () => {
    await withPeople();
    const other = newBoard(records(), project.projectId, 'Look book');
    await store.getState().apply(other.changes);
    await store.getState().apply(setLinksChange(records(), boardId, { sceneIds: [sceneId], characterIds: ['ch1'], locationIds: [] }));
    await store.getState().apply(setLinksChange(records(), other.id, { sceneIds: [sceneId], characterIds: [], locationIds: ['loc1'] }));
    const titles = (kind: 'scene' | 'character' | 'location', id: string) => boardsLinkedTo(records(), project.projectId, kind, id).map((b) => b.id);
    expect(titles('scene', sceneId)).toEqual([boardId, other.id]);
    expect(titles('character', 'ch1')).toEqual([boardId]);
    expect(titles('location', 'loc1')).toEqual([other.id]);
    expect(titles('location', 'nowhere')).toEqual([]);
    // A board in the Trash isn't listed.
    await store.getState().apply([{ kind: 'trash', id: other.id }]);
    expect(titles('scene', sceneId)).toEqual([boardId]);
    expect(titles('location', 'loc1')).toEqual([]);
  });

  it('links nothing to a record of another kind, or to a board in the Trash', async () => {
    expect(setLinksChange(records(), boardId, { sceneIds: [shotIds[0] ?? ''], characterIds: ['nope'], locationIds: [sceneId] })).toEqual([]);
    await store.getState().apply(trashItemsChanges(records(), []));
    await store.getState().apply([{ kind: 'trash', id: boardId }]);
    expect(setLinksChange(records(), boardId, { sceneIds: [sceneId], characterIds: [], locationIds: [] })).toEqual([]);
  });
});

describe('History and the Trash name live cards', () => {
  it('names them in History and in the Trash, in both languages', async () => {
    const [card, scene] = await addCards([
      { kind: 'shot_card', shotId: shotIds[0] ?? '' },
      { kind: 'scene_card', sceneId },
    ]);
    const lines = async () => (await loadSteps(project.file, Number.MAX_SAFE_INTEGER)).steps.map((s) => lineText(s.line));
    expect((await lines())[0]).toBe('Added 2 items');
    await store.getState().apply(trashItemsChanges(records(), [card ?? '']));
    expect((await lines())[0]).toBe('Deleted shot card 4A');
    expect(trashItems(records(), project.projectId).map((r) => r.name)).toEqual(['Shot card 4A on Camera board']);
    await store.getState().apply(restoreChanges(records(), project.projectId, card ?? ''));
    expect((await lines())[0]).toBe('Restored shot card 4A');
    await store.getState().apply(trashItemsChanges(records(), [scene ?? '']));
    expect(trashItems(records(), project.projectId).map((r) => r.name)).toEqual(['Scene card SC 04 on Camera board']);
    setLocale('es');
    expect(trashItems(records(), project.projectId).map((r) => r.name)).toEqual(['Tarjeta de escena ESC 04 en el tablero Cámara']);
  });

  it('names a card as it was then: added on 4B, and 4A trashed since, History still says 4B', async () => {
    await addCards([{ kind: 'shot_card', shotId: shotIds[1] ?? '' }]);
    await store.getState().applyWith((now, slate) => ({ changes: trashShot(now, project.projectId, shotIds[0] ?? '', slate) }));
    // 4B is 4A on the board now.
    expect(shotFields(records()[shotIds[1] ?? '']?.props ?? {}).number).toBe('4A');
    const lines = (await loadSteps(project.file, Number.MAX_SAFE_INTEGER)).steps.map((s) => lineText(s.line));
    expect(lines).toContain('Added shot card 4B');
  });

  it('names a card added alone, and a board’s links changed', async () => {
    const [card] = await addCards([{ kind: 'palette_card', sceneId }]);
    const lines = async () => (await loadSteps(project.file, Number.MAX_SAFE_INTEGER)).steps.map((s) => lineText(s.line));
    expect((await lines())[0]).toBe('Added palette card SC 04');
    expect(card).toBeTruthy();
    await store.getState().apply(setLinksChange(records(), boardId, { sceneIds: [sceneId], characterIds: [], locationIds: [] }));
    expect((await lines())[0]).toBe('Camera: scenes — → 1 scene');
  });
});
