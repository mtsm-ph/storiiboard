import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { noticeStore } from '../../app/notice';
import { projectStore } from '../../app/projectStore';
import { setLocale } from '../../core/i18n';
import { paletteChange, paletteOf, type Palette } from '../../core/model/palette';
import type { SbdRecord } from '../../core/model/record';
import type { Change } from '../../core/ops/ops';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { hex, parseHex, rgbToLab, type Lab } from '../../ui/theme/generator/color';
import { addShot } from '../storyboard/board';
import { boardChoices, boardPictures, boardScenes, makePaletteFromBoard } from './boardPalette';
import { deckBoardChange, newBoard, openDepartmentBoard, setLinksChange } from './boards';

// A scene's palette from a moodboard (5.6b): the board's pictures, video posters and shot cards' frames, each weighing the same.
// Reading a picture needs the webview's canvas, so a picture's pixels come from its hash here (a flat patch of one colour);
// everything else, the clustering and the edit, is the real code.

let colour: Record<string, string> = {};
const patch = (hexColour: string, count = 200): Lab[] => Array.from({ length: count }, () => rgbToLab(parseHex(hexColour)));
const readFrame = vi.hoisted(() => vi.fn());

vi.mock('../storyboard/palette/read', async (original) => ({ ...(await original<typeof import('../storyboard/palette/read')>()), readFrame }));

const sha = (n: number) => String(n).repeat(64).slice(0, 64);

let folder: TestFolder;
let project: Project;
let boardId = '';
const records = () => projectStore.getState().records;
let nextItem = 0;

beforeEach(async () => {
  setLocale('en');
  readFrame.mockReset();
  readFrame.mockImplementation((_file: unknown, file: string) => Promise.resolve(colour[file] ? patch(colour[file]) : null));
  colour = {};
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  await projectStore.getState().open(project);
  await projectStore.getState().apply([
    { kind: 'create', record: { id: 'sc4', type: 'scene', parentId: project.projectId, sortKey: 'V', props: { number: '4', name: 'Kitchen' } } },
    { kind: 'create', record: { id: 'sc5', type: 'scene', parentId: project.projectId, sortKey: 'W', props: { number: '5', name: 'Hall' } } },
  ]);
  const made = newBoard(records(), project.projectId, 'Camera');
  await projectStore.getState().apply(made.changes);
  boardId = made.id;
  nextItem = 0;
});
afterEach(async () => {
  await projectStore.getState().close();
  folder.remove();
});

const image = (id: string, file: string, parentId: string | null = null): Change => ({
  kind: 'create',
  record: { id, type: 'media', parentId, sortKey: id, props: { kind: 'image', file, width: 1600, height: 900 } },
});

/** A picture item on the board with its image. */
async function addPicture(file: string, hexColour: string) {
  colour[file] = hexColour;
  const id = `pic${String((nextItem += 1))}`;
  await projectStore.getState().apply([
    { kind: 'create', record: { id, type: 'board_item', parentId: boardId, sortKey: id, props: { kind: 'picture', x: 0, y: 0, width: 200, height: 100, rotation: 0 } } },
    image(`${id}-media`, file, id),
  ]);
}

async function addVideoCard(file: string, hexColour: string) {
  colour[file] = hexColour;
  const id = `vid${String((nextItem += 1))}`;
  await projectStore.getState().apply([
    { kind: 'create', record: { id: `${id}-poster`, type: 'media', parentId: null, sortKey: 'a', props: { kind: 'image', file, width: 1600, height: 900 } } },
    { kind: 'create', record: { id, type: 'board_item', parentId: boardId, sortKey: id, props: { kind: 'video', x: 0, y: 0, width: 200, height: 100, rotation: 0 } } },
    { kind: 'create', record: { id: `${id}-media`, type: 'media', parentId: id, sortKey: 'a', props: { kind: 'video', poster: `${id}-poster` } } },
  ]);
}

async function addShotCard(file: string, hexColour: string) {
  colour[file] = hexColour;
  const added = addShot(records(), project.projectId, 'sc5');
  await projectStore.getState().apply(added.changes);
  const id = `card${String((nextItem += 1))}`;
  await projectStore.getState().apply([
    image(`${id}-media`, file),
    { kind: 'update', id: added.shotId, set: { media_id: `${id}-media` } },
    { kind: 'create', record: { id, type: 'board_item', parentId: boardId, sortKey: id, props: { kind: 'shot_card', shot_id: added.shotId, x: 0, y: 0, width: 320, height: 240, rotation: 0 } } },
  ]);
  return added.shotId;
}

const link = (...scenes: string[]) => projectStore.getState().apply(setLinksChange(records(), boardId, { sceneIds: scenes, characterIds: [], locationIds: [] }));
const palette = (id = 'sc4'): Palette | null => paletteOf((records()[id] as SbdRecord).props);
const hexes = () => (palette()?.colors ?? []).map((c) => c.hex);
const near = (a: string, b: string) => {
  const [r1, g1, b1] = parseHex(a);
  const [r2, g2, b2] = parseHex(b);
  return Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2) < 30;
};

describe('a palette from a board', () => {
  it('reads three pictures, one weight each, in one op group that undo takes back', async () => {
    await addPicture(sha(1), '#C0392B');
    await addPicture(sha(2), '#2E8B57');
    await addPicture(sha(3), '#2C5F8A');
    await link('sc4');
    // Another palette before: undo brings this one back.
    const old = paletteChange({ size: 3, colors: [{ hex: '#111111', locked: false, raw: {} }], raw: {}, unread: [] });
    await projectStore.getState().apply([{ kind: 'update', id: 'sc4', ...old }]);
    const before = JSON.stringify(records()['sc4']?.props.palette);
    const groupsBefore = (await projectStore.getState().project?.file.query('SELECT COUNT(*) AS n FROM op_groups'))?.[0]?.n as number;

    expect(await makePaletteFromBoard(boardId, 'sc4')).toBe(true);
    expect(palette()?.size).toBe(3);
    expect(hexes()).toHaveLength(3);
    for (const wanted of ['#C0392B', '#2E8B57', '#2C5F8A']) expect(hexes().some((h) => near(h, wanted))).toBe(true);
    const groupsAfter = (await projectStore.getState().project?.file.query('SELECT COUNT(*) AS n FROM op_groups'))?.[0]?.n as number;
    expect(groupsAfter).toBe(groupsBefore + 1);

    await projectStore.getState().undo();
    expect(JSON.stringify(records()['sc4']?.props.palette)).toBe(before);
  });

  it('weighs each picture the same however big it is read', async () => {
    await addPicture(sha(1), '#C0392B');
    await addPicture(sha(2), '#2C5F8A');
    // Picture A is read at 700 points, 650 red and 50 yellow; picture B at 40, all blue. Each counts once: red and blue come,
    // the little yellow does not.
    const red = patch('#C0392B', 650);
    const yellow = patch('#F4E04D', 50);
    readFrame.mockImplementation((_file: unknown, file: string) => Promise.resolve(file === sha(1) ? [...red, ...yellow] : patch('#2C5F8A', 40)));
    await link('sc4');
    await projectStore.getState().apply([{ kind: 'update', id: 'sc4', ...paletteChange({ size: 2, colors: [], raw: {}, unread: [] }) }]);
    await makePaletteFromBoard(boardId, 'sc4');
    expect(hexes()).toHaveLength(2);
    expect(hexes().some((h) => near(h, '#C0392B'))).toBe(true);
    expect(hexes().some((h) => near(h, '#2C5F8A'))).toBe(true);
    expect(hexes().some((h) => near(h, '#F4E04D'))).toBe(false);
  });

  it('keeps the board main colour even when it is near an unlocked colour already there, and gives the same palette twice', async () => {
    await addPicture(sha(1), '#C0392B');
    await addPicture(sha(2), '#2C5F8A');
    await link('sc4');
    // The red already in the palette, unlocked and very near the board's red.
    await projectStore.getState().apply([{ kind: 'update', id: 'sc4', ...paletteChange({ size: 2, colors: [{ hex: '#C23A2C', locked: false, raw: {} }], raw: {}, unread: [] }) }]);
    await makePaletteFromBoard(boardId, 'sc4');
    const first = hexes();
    expect(first).toHaveLength(2);
    expect(first.some((h) => near(h, '#C0392B'))).toBe(true);
    await makePaletteFromBoard(boardId, 'sc4');
    expect(hexes()).toEqual(first);
  });

  it('writes one op group when pressed twice at once', async () => {
    await addPicture(sha(1), '#C0392B');
    await link('sc4');
    const count = async () => (await projectStore.getState().project?.file.query('SELECT COUNT(*) AS n FROM op_groups'))?.[0]?.n as number;
    const before = await count();
    const results = await Promise.all([makePaletteFromBoard(boardId, 'sc4'), makePaletteFromBoard(boardId, 'sc4')]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await count()).toBe(before + 1);
  });

  it('says it in a step notice, naming a department board as the Camera board and a free board by its name', async () => {
    const opened = openDepartmentBoard(records(), project.projectId, 'camera');
    await projectStore.getState().apply(opened.changes);
    colour[sha(1)] = '#C0392B';
    await projectStore.getState().apply([
      { kind: 'create', record: { id: 'p', type: 'board_item', parentId: opened.id, sortKey: 'p', props: { kind: 'picture', x: 0, y: 0, width: 200, height: 100, rotation: 0 } } },
      image('pm', sha(1), 'p'),
      { kind: 'update', id: opened.id, set: { scene_ids: ['sc4'] } },
    ]);
    await makePaletteFromBoard(opened.id, 'sc4');
    expect(noticeStore.getState().step).toBe(true);
    expect(noticeStore.getState().message).toMatch(/^Made SC 04’s palette from the .+ board\.$/);
    await addPicture(sha(2), '#2C5F8A');
    await link('sc4');
    await makePaletteFromBoard(boardId, 'sc4');
    expect(noticeStore.getState().message).toBe('Made SC 04’s palette from Camera.');
  });

  it('keeps a locked colour in its place and the palette’s size', async () => {
    await addPicture(sha(1), '#C0392B');
    await addPicture(sha(2), '#2E8B57');
    await addPicture(sha(3), '#2C5F8A');
    await link('sc4');
    await projectStore.getState().apply([
      { kind: 'update', id: 'sc4', ...paletteChange({ size: 3, colors: [{ hex: '#F4E04D', locked: true, raw: {} }, { hex: '#111111', locked: false, raw: {} }], raw: {}, unread: [] }) },
    ]);
    await makePaletteFromBoard(boardId, 'sc4');
    expect(palette()?.size).toBe(3);
    expect(palette()?.colors).toHaveLength(3);
    expect(palette()?.colors[0]).toMatchObject({ hex: '#F4E04D', locked: true });
    expect(hexes()).not.toContain('#111111');
  });

  it('counts a video card’s poster and a shot card’s frame as pictures', async () => {
    await addPicture(sha(1), '#C0392B');
    await addVideoCard(sha(2), '#2E8B57');
    const shotId = await addShotCard(sha(3), '#2C5F8A');
    await projectStore.getState().apply([{ kind: 'update', id: shotId, set: { crop: { x: 0.3, y: 0.6, zoom: 2 } } }]);
    // Back to front is the items' sort order, whatever their ids.
    expect(boardPictures(records(), boardId).map((p) => [p.sha256, p.aspect]).sort()).toEqual([
      [sha(1), null],
      [sha(2), null],
      [sha(3), 'frame'],
    ]);
    await link('sc4');
    await makePaletteFromBoard(boardId, 'sc4');
    for (const wanted of ['#C0392B', '#2E8B57', '#2C5F8A']) expect(hexes().some((h) => near(h, wanted))).toBe(true);
    // The shot card is read in the project's frame shape with the shot's crop; a picture and a poster whole (no shape).
    const callFor = (n: number) => readFrame.mock.calls.find((call) => call[1] === sha(n)) as unknown[];
    expect(callFor(1)[3]).toBeNull();
    expect(callFor(2)[3]).toBeNull();
    expect(callFor(3)[3]).toBe(16 / 9);
    expect(callFor(3)[2]).toEqual({ x: 0.3, y: 0.6, zoom: 2 });
    // A trashed shot's card shows nothing to read.
    await projectStore.getState().apply([{ kind: 'trash', id: shotId }]);
    expect(boardPictures(records(), boardId)).toHaveLength(2);
  });

  it('says so and changes nothing for a board with no pictures', async () => {
    await link('sc4');
    await projectStore.getState().apply([{ kind: 'update', id: 'sc4', ...paletteChange({ size: 4, colors: [{ hex: '#111111', locked: false, raw: {} }], raw: {}, unread: [] }) }]);
    const before = records()['sc4'];
    const groups = (await projectStore.getState().project?.file.query('SELECT COUNT(*) AS n FROM op_groups'))?.[0]?.n;
    expect(await makePaletteFromBoard(boardId, 'sc4')).toBe(false);
    expect(records()['sc4']).toBe(before);
    expect((await projectStore.getState().project?.file.query('SELECT COUNT(*) AS n FROM op_groups'))?.[0]?.n).toBe(groups);
  });

  it('lists the scenes a board links to in board order, whatever order they were linked in, so one linked to two asks which', async () => {
    await link('sc5', 'sc4');
    const board = records()[boardId] as SbdRecord;
    expect(boardScenes(records(), board).map((s) => s.id)).toEqual(['sc4', 'sc5']);
    await projectStore.getState().apply([{ kind: 'trash', id: 'sc5' }]);
    expect(boardScenes(records(), board).map((s) => s.id)).toEqual(['sc4']);
  });

  it('leaves out a deck, and tells two boards of one title apart', async () => {
    const deck = deckBoardChange(records(), project.projectId, 'Camera', '16:9');
    const twin = newBoard(records(), project.projectId, 'Camera');
    const department = openDepartmentBoard(records(), project.projectId, 'camera');
    await projectStore.getState().apply([deck.change, ...twin.changes, ...department.changes]);
    await link('sc4');
    expect(await makePaletteFromBoard(deck.id, 'sc4')).toBe(false);
    const get = (id: string) => records()[id] as SbdRecord;
    expect(boardChoices([deck.id, boardId, twin.id].map(get)).map((b) => b.id)).toEqual([boardId, twin.id]);
    expect(boardChoices([boardId, twin.id].map(get)).map((b) => b.name)).toEqual(['Camera (board)', 'Camera (board)']);
    expect(boardChoices([boardId].map(get)).map((b) => b.name)).toEqual(['Camera']);
  });
});

describe('colours as hex', () => {
  it('round-trips the test colours', () => {
    expect(hex(parseHex('#C0392B'))).toBe('#C0392B');
  });
});
