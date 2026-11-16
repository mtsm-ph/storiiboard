import { createHash } from 'node:crypto';
import { isValidElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import type { PreparedImage } from '../../core/media/store';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { setLocale } from '../../core/i18n';
import { displayOps, type PrintNode } from '../export/deckDisplay';
import { croppedPrint } from '../export/deckPictures';
import { loadSteps } from '../history/steps';
import { lineText } from '../history/summary';
import { wholePicture, WHOLE } from '../../ui/canvas/cropping';
import { PAPER_COLOURS } from '../../ui/canvas/paperColours';
import { canvasPalette } from '../../ui/canvas/canvasPalette';
import { duplicateSelection, pasteClipboard } from './boardActions';
import { boardFileChanges } from './boardFiles';
import { openDepartmentBoard } from './boards';
import { pictureBorder, withDrawing } from './drawing';
import { borderChanges, canvasItems, clipOf, cropChanges, cropEdgeChanges, cropEdgesOf, cropOf, geometryChanges, itemFields, itemsOf, resetCropChanges, BOARD_INK } from './items';
import { moodboardStore } from './moodboardStore';
import { PictureNode } from './PictureNode';

// A board picture's crop and border (6.5.7b) as the board stores and draws them: the readers refuse odd values, a crop
// and Reset crop are each one update of the box and the kept part, a resize keeps the fractions, the fields' percents,
// the border's bounds, the drawing's clip and picture rectangle, and Duplicate and Paste keep all of it.

function image(seed: number, width = 2000, height = 1500): PreparedImage {
  const bytes = new Uint8Array(3000).map((_, i) => (i * seed) % 256);
  return {
    original: { sha256: createHash('sha256').update(bytes).digest('hex'), bytes, mime: 'image/jpeg', width, height, colorSpace: 'srgb' },
    thumbnail: { bytes: bytes.slice(0, 300), mime: 'image/jpeg', width: 640, height: 480, longEdge: 640 },
  };
}

let folder: TestFolder;
let project: Project;
let store = createProjectStore();
let boardId = '';

beforeEach(async () => {
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  store = createProjectStore();
  await store.getState().open(project);
  const opened = openDepartmentBoard(store.getState().records, project.projectId, 'camera');
  await store.getState().apply(opened.changes);
  boardId = opened.id;
});
afterEach(async () => {
  await store.getState().close();
  folder.remove();
});

const records = () => store.getState().records;
const items = () => itemsOf(records(), boardId);

/** A picture dropped on the board, put at 100, 50, 400 by 300. */
async function picture(): Promise<string> {
  await store.getState().applyWith((now) => boardFileChanges(now, boardId, [{ kind: 'picture', picture: { image: image(3), source: { name: 'IMG_3.JPG', path: folder.path('refs/IMG_3.JPG') } } }], { x: 0, y: 0 }, project.file.path));
  const id = items()[0]?.id ?? '';
  await store.getState().apply([{ kind: 'update', id, set: { x: 100, y: 50, width: 400, height: 300, rotation: 0 } }]);
  return id;
}

const fields = (id: string) => itemFields(records()[id]?.props ?? {});

describe('the readers', () => {
  it('read a crop only when it is four numbers within the picture; anything else is the whole picture', () => {
    expect(cropOf({ x: 0.1, y: 0.2, width: 0.5, height: 0.6 })).toEqual({ x: 0.1, y: 0.2, width: 0.5, height: 0.6 });
    for (const odd of [null, undefined, 'crop', 3, [0, 0, 1, 1], {}, { x: 0, y: 0, width: 1 }, { x: '0', y: 0, width: 1, height: 1 }, { x: -0.1, y: 0, width: 0.5, height: 0.5 }, { x: 0, y: 0, width: 0, height: 0.5 }, { x: 0.6, y: 0, width: 0.5, height: 1 }, { x: 0, y: 0.5, width: 1, height: 0.6 }, { x: Number.NaN, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: 1, height: 1 }]) {
      expect(cropOf(odd)).toBeNull();
    }
    const props = { kind: 'picture', x: 0, y: 0, width: 100, height: 100, rotation: 0 };
    expect(itemFields({ ...props, crop: { x: 2, y: 0, width: 1, height: 1 } })?.crop).toBeNull();
    // Less than 1% of the picture either way is no crop.
    expect(cropOf({ x: 0, y: 0, width: 0.009, height: 1 })).toBeNull();
    expect(cropOf({ x: 0, y: 0.5, width: 1, height: 0.0099 })).toBeNull();
    expect(cropOf({ x: 0, y: 0, width: 0.01, height: 1 })).toEqual({ x: 0, y: 0, width: 0.01, height: 1 });
    // A crop on another kind is not read.
    expect(itemFields({ ...props, kind: 'video', crop: { x: 0.1, y: 0, width: 0.5, height: 1 } })?.crop).toBeNull();
  });

  it('read a border: on only when true, its colour a hex (missing: the ink), its width 1 to 40 (missing: 2)', () => {
    const props = { kind: 'picture', x: 0, y: 0, width: 100, height: 100, rotation: 0 };
    expect(itemFields(props)).toMatchObject({ border: false, borderColor: null, borderWidth: 2 });
    expect(itemFields({ ...props, border: true, border_color: '#a35139', border_width: 6 })).toMatchObject({ border: true, borderColor: '#A35139', borderWidth: 6 });
    expect(itemFields({ ...props, border: 'yes', border_color: 'red', border_width: 'wide' })).toMatchObject({ border: false, borderColor: null, borderWidth: 2 });
    expect(itemFields({ ...props, border_width: 0 })?.borderWidth).toBe(1);
    expect(itemFields({ ...props, border_width: 400 })?.borderWidth).toBe(40);
    expect(itemFields({ ...props, kind: 'rect', border: true })?.border).toBe(false);
  });
});

describe('cropping and resetting', () => {
  it('writes the box and the crop in one update, one undo restoring both', async () => {
    const id = await picture();
    const changes = cropChanges(records(), id, { x: 100, y: 50, width: 360, height: 300, rotation: 0 }, { x: 0, y: 0, width: 0.9, height: 1 });
    expect(changes).toEqual([{ kind: 'update', id, set: { x: 100, y: 50, width: 360, height: 300, rotation: 0, crop: { x: 0, y: 0, width: 0.9, height: 1 } } }]);
    await store.getState().apply(changes);
    expect(fields(id)).toMatchObject({ width: 360, crop: { x: 0, y: 0, width: 0.9, height: 1 } });
    // The canvas is told the kept part, and the same again is no step.
    expect(canvasItems(records(), boardId)[0]?.crop).toEqual({ x: 0, y: 0, width: 0.9, height: 1 });
    expect(cropChanges(records(), id, { x: 100, y: 50, width: 360, height: 300, rotation: 0 }, { x: 0, y: 0, width: 0.9, height: 1 })).toEqual([]);
    await store.getState().undo();
    expect(fields(id)).toMatchObject({ width: 400, crop: null });
    expect(records()[id]?.props.crop).toBeUndefined();
  });

  it('resets to the whole picture, the part that showed where it was, and Reset is undone too', async () => {
    const id = await picture();
    await store.getState().apply(cropChanges(records(), id, { x: 140, y: 80, width: 200, height: 180, rotation: 0 }, { x: 0.1, y: 0.1, width: 0.5, height: 0.6 }));
    const reset = resetCropChanges(records(), id);
    expect(reset).toEqual([{ kind: 'update', id, set: { x: 100, y: 50, width: 400, height: 300, rotation: 0 }, unset: ['crop'] }]);
    await store.getState().apply(reset);
    expect(fields(id)).toMatchObject({ x: 100, y: 50, width: 400, height: 300, crop: null });
    expect(resetCropChanges(records(), id)).toEqual([]);
    await store.getState().undo();
    expect(fields(id)?.crop).toEqual({ x: 0.1, y: 0.1, width: 0.5, height: 0.6 });
  });

  it('changes only the side typed, from the stored fractions, never the others’ rounded percents', async () => {
    const id = await picture();
    // A third cut off the left: 33.33% in the field, 0.333333 stored.
    await store.getState().apply(cropChanges(records(), id, { x: 233.33, y: 50, width: 266.67, height: 300, rotation: 0 }, { x: 0.333333, y: 0, width: 0.666667, height: 1 }));
    expect(cropEdgesOf(fields(id)?.crop ?? null).left).toBe(33.33);
    await store.getState().apply(cropEdgeChanges(records(), id, 'right', 10));
    expect(fields(id)?.crop).toEqual({ x: 0.333333, y: 0, width: 0.566667, height: 1 });
    expect(fields(id)?.x).toBe(233.33);
    await store.getState().apply(cropEdgeChanges(records(), id, 'top', 20));
    expect(fields(id)?.crop).toEqual({ x: 0.333333, y: 0.2, width: 0.566667, height: 0.8 });
  });

  it('says in History which it was: a crop, or a reset, in both languages', async () => {
    const id = await picture();
    await store.getState().apply(cropEdgeChanges(records(), id, 'left', 10));
    await store.getState().apply(resetCropChanges(records(), id));
    const lines = async () => (await loadSteps(project.file, Number.MAX_SAFE_INTEGER)).steps.map((s) => lineText(s.line)).slice(0, 2).reverse();
    expect(await lines()).toEqual(['Cropped 1 item', 'Reset the crop of 1 item']);
    setLocale('es');
    try {
      expect(await lines()).toEqual(['Recortado: 1 elemento', 'Recorte quitado: 1 elemento']);
    } finally {
      setLocale('en');
    }
  });

  it('keeps the crop’s fractions when a cropped picture is resized as a whole', async () => {
    const id = await picture();
    await store.getState().apply(cropChanges(records(), id, { x: 100, y: 50, width: 360, height: 300, rotation: 0 }, { x: 0, y: 0, width: 0.9, height: 1 }));
    const resize = geometryChanges(records(), [{ id, x: 100, y: 50, width: 180, height: 150, rotation: 0 }]);
    expect(resize).toEqual([{ kind: 'update', id, set: { x: 100, y: 50, width: 180, height: 150, rotation: 0 } }]);
    await store.getState().apply(resize);
    expect(fields(id)?.crop).toEqual({ x: 0, y: 0, width: 0.9, height: 1 });
  });

  it('shows the crop in percent, and a typed side crops by it with the picture left in place', async () => {
    const id = await picture();
    expect(cropEdgesOf(null)).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
    const left = cropEdgeChanges(records(), id, 'left', 10);
    expect(left).toEqual([{ kind: 'update', id, set: { x: 140, y: 50, width: 360, height: 300, rotation: 0, crop: { x: 0.1, y: 0, width: 0.9, height: 1 } } }]);
    await store.getState().apply(left);
    expect(cropEdgesOf(fields(id)?.crop ?? null)).toEqual({ left: 10, top: 0, right: 0, bottom: 0 });
    await store.getState().apply(cropEdgeChanges(records(), id, 'bottom', 25));
    expect(fields(id)).toMatchObject({ x: 140, y: 50, width: 360, height: 225, crop: { x: 0.1, y: 0, width: 0.9, height: 0.75 } });
    // Outside 0 to 100, or a cut that leaves less than the least size, is refused.
    expect(cropEdgeChanges(records(), id, 'top', 101)).toEqual([]);
    expect(cropEdgeChanges(records(), id, 'top', -1)).toEqual([]);
    expect(cropEdgeChanges(records(), id, 'right', 90)).toEqual([]);
    // Nor is a crop under 1% of the picture ever written, by the fields or by a drag's release.
    expect(cropChanges(records(), id, { x: 140, y: 50, width: 8, height: 225, rotation: 0 }, { x: 0.1, y: 0, width: 0.005, height: 0.75 })).toEqual([]);
    // Back to 0 on every side is the whole picture: no crop stored.
    await store.getState().apply(cropEdgeChanges(records(), id, 'left', 0));
    await store.getState().apply(cropEdgeChanges(records(), id, 'bottom', 0));
    expect(records()[id]?.props.crop).toBeUndefined();
    expect(fields(id)).toMatchObject({ x: 100, y: 50, width: 400, height: 300 });
  });
});

describe('the border', () => {
  it('is switched, coloured and sized, each one update of what changed', async () => {
    const id = await picture();
    expect(borderChanges(records(), id, { border: true })).toEqual([{ kind: 'update', id, set: { border: true } }]);
    expect(borderChanges(records(), id, { border: false })).toEqual([]);
    expect(borderChanges(records(), id, { color: '#2c5f8a' })).toEqual([{ kind: 'update', id, set: { border_color: '#2C5F8A' } }]);
    expect(borderChanges(records(), id, { color: 'blue' })).toEqual([]);
    expect(borderChanges(records(), id, { width: 0 })).toEqual([{ kind: 'update', id, set: { border_width: 1 } }]);
    expect(borderChanges(records(), id, { width: 99 })).toEqual([{ kind: 'update', id, set: { border_width: 40 } }]);
    expect(borderChanges(records(), id, { width: 2 })).toEqual([]);
    // Default takes a chosen colour off; with none chosen it is no step.
    expect(borderChanges(records(), id, { color: null })).toEqual([]);
    await store.getState().apply(borderChanges(records(), id, { color: '#2C5F8A' }));
    expect(borderChanges(records(), id, { color: null })).toEqual([{ kind: 'update', id, unset: ['border_color'] }]);
  });

  it('is drawn on the box’s edge, inside it, never wider than half its short side', () => {
    expect(pictureBorder({ border: false, borderWidth: 6 }, 400, 300)).toBeNull();
    expect(pictureBorder({ border: true, borderWidth: 6 }, 400, 300)).toEqual({ x: 3, y: 3, width: 394, height: 294, strokeWidth: 6 });
    expect(pictureBorder({ border: true, borderWidth: 40 }, 30, 60)).toEqual({ x: 7.5, y: 7.5, width: 15, height: 45, strokeWidth: 15 });
  });
});

/** The children of a drawing, as React elements. */
const childrenOf = (node: unknown): ReactElement<Record<string, unknown>>[] => {
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: unknown };
  const list = Array.isArray(props.children) ? (props.children as unknown[]) : [props.children];
  return list.filter((child): child is ReactElement<Record<string, unknown>> => isValidElement(child));
};

describe('the drawing and the export’s display list', () => {
  it('draws the picture with its crop and a border in its colour, or the palette’s ink with none', async () => {
    const id = await picture();
    await store.getState().apply(cropChanges(records(), id, { x: 100, y: 50, width: 360, height: 300, rotation: 0 }, { x: 0, y: 0, width: 0.9, height: 1 }));
    await store.getState().apply(borderChanges(records(), id, { border: true }));
    await store.getState().apply(borderChanges(records(), id, { width: 6 }));
    const draw = (colours: typeof PAPER_COLOURS) => {
      const [item] = withDrawing(canvasItems(records(), boardId), (itemId) => itemFields(records()[itemId]?.props ?? {}), () => ({ sha256: 'abc', name: 'p.jpg', duration: '', missing: false, videoId: null }), () => null, null, 0);
      return childrenOf(item?.draw?.({ width: 360, height: 300, colours, zoom: 1, inView: true }));
    };
    const [node, border] = draw(PAPER_COLOURS);
    expect(node?.type).toBe(PictureNode);
    expect(node?.props).toMatchObject({ width: 360, height: 300, crop: { x: 0, y: 0, width: 0.9, height: 1 } });
    expect(node?.props.cutAway).toBeUndefined();
    expect(border?.props).toMatchObject({ x: 3, y: 3, width: 354, height: 294, strokeWidth: 6, stroke: BOARD_INK });
    // Past the box during a crop drag: the cut part alone, with no border.
    const [item] = withDrawing(canvasItems(records(), boardId), (itemId) => itemFields(records()[itemId]?.props ?? {}), () => ({ sha256: 'abc', name: 'p.jpg', duration: '', missing: false, videoId: null }), () => null, null, 0);
    const cut = item?.draw?.({ width: 360, height: 300, colours: PAPER_COLOURS, zoom: 1, inView: true, cutAway: true });
    expect(isValidElement(cut) && cut.type === PictureNode && (cut.props as { cutAway?: boolean }).cutAway).toBe(true);
    // The Dark view: a default border takes the light ink, a chosen colour stays.
    const dark = canvasPalette('dark');
    expect(draw(dark)[1]?.props.stroke).toBe(dark.ink);
    expect(dark.ink).not.toBe(BOARD_INK);
    await store.getState().apply(borderChanges(records(), id, { color: '#2C5F8A' }));
    expect(draw(dark)[1]?.props.stroke).toBe('#2C5F8A');
    expect(draw(PAPER_COLOURS)[1]?.props.stroke).toBe('#2C5F8A');
  });

  // The canvas's own nodes are read back in e2e/boardCrop.spec.ts (deckRender): here, the read-back of a node as
  // PictureNode makes one, and how the PDF sizes what it embeds.
  it('reads a cropped picture node back as one image of the box with its kept part, and an odd crop as none', () => {
    const border = pictureBorder({ border: true, borderWidth: 4 }, 360, 300);
    if (!border) throw new Error('no border');
    const node = (kind: PrintNode['kind'], attrs: Record<string, unknown>, children: PrintNode[] = [], at = { x: 0, y: 0 }): PrintNode => ({ kind, matrix: [1, 0, 0, 1, at.x, at.y], opacity: 1, visible: true, attrs, children });
    const crop = { x: 0.1, y: 0.2, width: 0.8, height: 0.6 };
    const item = node('group', {}, [node('image', { sbSha: 'abc', width: 360, height: 300, sbCrop: crop }), node('rect', { width: border.width, height: border.height, stroke: '#2C5F8A', strokeWidth: border.strokeWidth }, [], border)], { x: 100, y: 50 });
    const ops = displayOps(item);
    expect(ops.filter((op) => op.op === 'image')).toEqual([{ op: 'image', sha256: 'abc', width: 360, height: 300, crop }]);
    expect(ops.some((op) => op.op === 'clip')).toBe(false);
    expect(ops).toContainEqual({ op: 'shape', path: [{ m: [0, 0] }, { l: [356, 0] }, { l: [356, 296] }, { l: [0, 296] }, { z: true }], fill: null, stroke: '#2C5F8A', strokeWidth: 4, fixedStroke: false, dash: [], cap: 'butt', join: 'miter' });
    expect(displayOps(node('image', { sbSha: 'abc', width: 360, height: 300, sbCrop: { x: 0.5, y: 0, width: 0.8, height: 1 } }))).toContainEqual({ op: 'image', sha256: 'abc', width: 360, height: 300 });
  });

  it('embeds only the kept part, at the density the uncropped picture would print at', () => {
    // A 4000 by 3000 picture asked for at 2048 on the whole picture's long edge: 0.512 of its pixels each way, so the
    // kept 80% by 60% (3200 by 1800 of its own pixels) is 1638 by 922.
    expect(croppedPrint(4000, 3000, 2048, { x: 0.1, y: 0.2, width: 0.8, height: 0.6 })).toEqual({ part: { x: 400, y: 600, width: 3200, height: 1800 }, width: 1638, height: 922 });
    // Small enough already: its own pixels.
    expect(croppedPrint(400, 300, 1024, { x: 0.1, y: 0, width: 0.9, height: 1 })).toEqual({ part: { x: 40, y: 0, width: 360, height: 300 }, width: 360, height: 300 });
    expect(wholePicture(360, 300, { x: 0.1, y: 0, width: 0.9, height: 1 }).width).toBe(400);
  });
});

describe('copies', () => {
  async function croppedWithBorder(): Promise<string> {
    const id = await picture();
    await store.getState().apply(cropChanges(records(), id, { x: 140, y: 50, width: 320, height: 300, rotation: 0 }, { x: 0.1, y: 0, width: 0.8, height: 1 }));
    await store.getState().apply(borderChanges(records(), id, { border: true, color: '#A35139', width: 5 }));
    return id;
  }
  const look = (id: string) => {
    const f = fields(id);
    return f ? { crop: f.crop, border: f.border, borderColor: f.borderColor, borderWidth: f.borderWidth, width: f.width, height: f.height } : null;
  };

  it('Duplicate keeps the crop and the border', async () => {
    const id = await croppedWithBorder();
    moodboardStore.getState().select(boardId, [id]);
    await duplicateSelection(boardId, store);
    const copy = items().find((r) => r.id !== id);
    expect(copy && look(copy.id)).toEqual(look(id));
    expect(copy?.props).toMatchObject({ crop: { x: 0.1, y: 0, width: 0.8, height: 1 }, border: true, border_color: '#A35139', border_width: 5 });
  });

  it('Copy and Paste keep them too', async () => {
    const id = await croppedWithBorder();
    moodboardStore.getState().copy(clipOf(records(), boardId, [id]), { projectId: project.projectId, path: project.file.path });
    await pasteClipboard(boardId, null, moodboardStore.getState().clipboard, store);
    const copy = items().find((r) => r.id !== id);
    expect(copy && look(copy.id)).toEqual(look(id));
  });

  it('an uncropped picture with no border copies with none of the new props', async () => {
    const id = await picture();
    moodboardStore.getState().select(boardId, [id]);
    await duplicateSelection(boardId, store);
    const copy = items().find((r) => r.id !== id);
    expect(Object.keys(copy?.props ?? {}).sort()).toEqual(['height', 'kind', 'rotation', 'width', 'x', 'y']);
    expect(fields(copy?.id ?? '')?.crop).toBeNull();
    expect(WHOLE).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });
});
