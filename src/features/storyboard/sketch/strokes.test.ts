import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../../app/projectStore';
import { nodeDriver } from '../../../core/storage/nodeDriver';
import { createProject } from '../../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../../core/storage/testFolder';
import { addShot } from '../board';
import { addStroke, arrowHead, eraseStrokes, pressureOutline, strokesAt, strokesByShot, strokesOf, tidyPoints } from './strokes';

describe('stroke geometry', () => {
  it('thins a scribble and rounds it, keeping the last point and the pressures that go with it', () => {
    const raw = [0.1, 0.1, 0.1001, 0.1001, 0.1002, 0.1, 0.3, 0.3, 0.30001, 0.30001];
    const tidy = tidyPoints(raw, [0.2, 0.3, 0.4, 0.5, 0.6]);
    expect(tidy.points).toEqual([0.1, 0.1, 0.3, 0.3, 0.3, 0.3]);
    expect(tidy.pressures).toEqual([0.2, 0.5, 0.6]);
    expect(tidyPoints([0.5, 0.5, 0.5, 0.5], null)).toEqual({ points: [0.5, 0.5, 0.5, 0.5], pressures: null });
  });

  it('finds the strokes the eraser touches, a box by its sides only', () => {
    const line = { id: 'line', tool: 'pen' as const, points: [0.1, 0.5, 0.9, 0.5], width: 0.008, pressures: null };
    const box = { id: 'box', tool: 'box' as const, points: [0.2, 0.2, 0.4, 0.4], width: 0.008, pressures: null };
    expect(strokesAt([line, box], 0.5, 0.51, 0.015, 16 / 9)).toEqual(['line']);
    // Inside the box but away from its sides: nothing.
    expect(strokesAt([line, box], 0.3, 0.3, 0.015, 16 / 9)).toEqual([]);
    expect(strokesAt([line, box], 0.2, 0.3, 0.015, 16 / 9)).toEqual(['box']);
  });

  it('measures the eraser’s reach in the frame’s height both ways, so a wide frame doesn’t stretch it', () => {
    // A vertical line at x = 0.5 in a 2.39 frame. 0.006 across is 0.014 of the height away: in reach.
    const upright = { id: 'up', tool: 'pen' as const, points: [0.5, 0.1, 0.5, 0.9], width: 0.004, pressures: null };
    expect(strokesAt([upright], 0.506, 0.5, 0.015, 2.39)).toEqual(['up']);
    // 0.01 across is 0.024 of the height: out of reach, though it would be in reach measured across alone.
    expect(strokesAt([upright], 0.51, 0.5, 0.015, 2.39)).toEqual([]);
  });

  it('outlines a pressure stroke on both sides, and points an arrow at its end', () => {
    const outline = pressureOutline([0, 0.5, 1, 0.5], [0, 1], 100, 100, 0.1);
    expect(outline).toHaveLength(8);
    // Light at the start (40% of 10px wide), firm at the end (160%).
    expect(Math.abs((outline[1] ?? 0) - (outline[7] ?? 0))).toBeCloseTo(4);
    expect(Math.abs((outline[3] ?? 0) - (outline[5] ?? 0))).toBeCloseTo(16);
    expect(arrowHead([0, 0, 1, 0], 100, 100, 0.01).slice(0, 2)).toEqual([100, 0]);
  });
});

describe('strokes as records', () => {
  let folder: TestFolder;
  const store = createProjectStore();
  let shotId = '';
  beforeEach(async () => {
    folder = makeTestFolder();
    const project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
    await store.getState().open(project);
    await store.getState().apply([
      { kind: 'create', record: { id: 'sc4', type: 'scene', parentId: project.projectId, sortKey: 'V', props: { number: '4' } } },
    ]);
    const added = addShot(store.getState().records, project.projectId, 'sc4');
    shotId = added.shotId;
    await store.getState().apply(added.changes);
  });
  afterEach(async () => {
    await store.getState().close();
    folder.remove();
  });
  const records = () => store.getState().records;

  it('keeps each stroke as its own record, in drawing order, and one undo takes back one stroke', async () => {
    const stroke = { tool: 'pen' as const, points: [0.1, 0.1, 0.2, 0.2], width: 0.008, pressures: null };
    await store.getState().apply([addStroke(records(), shotId, stroke)]);
    await store.getState().apply([addStroke(records(), shotId, { ...stroke, tool: 'arrow', pressures: null })]);
    expect(strokesOf(records(), shotId).map((s) => s.tool)).toEqual(['pen', 'arrow']);
    expect(strokesByShot(records()).get(shotId)?.map((s) => s.tool)).toEqual(['pen', 'arrow']);
    await store.getState().undo();
    expect(strokesOf(records(), shotId).map((s) => s.tool)).toEqual(['pen']);
  });

  it('orders strokes drawn faster than they’re saved by when they were drawn', async () => {
    const stroke = (tool: 'pen' | 'arrow' | 'box') => ({ tool, points: [0.1, 0.1, 0.2, 0.2], width: 0.008, pressures: null });
    // Queued without waiting for each other, as quick strokes are.
    await Promise.all([
      store.getState().applyWith((now) => ({ changes: [addStroke(now, shotId, stroke('pen'))] })),
      store.getState().applyWith((now) => ({ changes: [addStroke(now, shotId, stroke('arrow'))] })),
      store.getState().applyWith((now) => ({ changes: [addStroke(now, shotId, stroke('box'))] })),
    ]);
    expect(strokesOf(records(), shotId).map((s) => s.tool)).toEqual(['pen', 'arrow', 'box']);
    const keys = Object.values(records()).filter((r) => r.type === 'stroke').map((r) => r.sortKey);
    expect(new Set(keys).size).toBe(3);
  });

  it('erases strokes to the Trash in one edit, and brings them all back with one undo', async () => {
    const stroke = { tool: 'pen' as const, points: [0.1, 0.1, 0.2, 0.2], width: 0.008, pressures: [0.3, 0.7] };
    await store.getState().apply([addStroke(records(), shotId, stroke)]);
    await store.getState().apply([addStroke(records(), shotId, stroke)]);
    expect(strokesOf(records(), shotId)[0]?.pressures).toEqual([0.3, 0.7]);
    await store.getState().apply(eraseStrokes(strokesOf(records(), shotId).map((s) => s.id)));
    expect(strokesOf(records(), shotId)).toEqual([]);
    await store.getState().undo();
    expect(strokesOf(records(), shotId)).toHaveLength(2);
  });
});
