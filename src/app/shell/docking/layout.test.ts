import { describe, expect, it } from 'vitest';
import { edgePreviewBox, previewBox, snap, windowEdgeAt, zoneAt } from './geometry';
import {
  dockToEdge,
  dropTile,
  EDGE_SHARE,
  evenOut,
  isLayout,
  openTile,
  removeTile,
  resizeSplit,
  sameLayout,
  split,
  stack,
  stackOf,
  stacks,
  tilesIn,
  toggleMaximize,
  type Layout,
  type LayoutNode,
} from './layout';

// The Storyboard workspace's shape: scenes | (board over player) | inspector.
function storyboard(): Layout {
  return {
    root: split(
      'row',
      [stack(['scenes'], 's-scenes'), split('column', [stack(['board'], 's-board'), stack(['player'], 's-player')], [3, 1], 'col'), stack(['inspector'], 's-inspector')],
      [1, 3, 1],
      'root',
    ),
    maximized: null,
  };
}

/** The tree as nested arrays of tile names, so a test reads like the layout. */
function shape(node: LayoutNode): unknown {
  return node.kind === 'stack' ? node.tiles.join('+') : { [node.direction]: node.children.map(shape) };
}

const total = (sizes: number[]) => sizes.reduce((a, b) => a + b, 0);

describe('docking a tile', () => {
  it('splits the target when dropped on an edge, taking half its space', () => {
    const next = dropTile(storyboard(), 'inspector', 's-board', 'left');
    expect(shape(next.root)).toEqual({ row: ['scenes', { column: [{ row: ['inspector', 'board'] }, 'player'] }] });
    const inner = next.root.kind === 'split' ? next.root.children[1] : undefined;
    expect(inner?.kind === 'split' && inner.children[0]?.kind === 'split' ? inner.children[0].sizes : null).toEqual([0.5, 0.5]);
  });

  it('adds it as the open tab when dropped on the centre', () => {
    const next = dropTile(storyboard(), 'player', 's-board', 'center');
    const board = stackOf(next, 'board');
    expect(board?.tiles).toEqual(['board', 'player']);
    expect(board?.active).toBe('player');
    expect(shape(next.root)).toEqual({ row: ['scenes', 'board+player', 'inspector'] });
  });

  it('folds a split with one child left into its parent, keeping shares', () => {
    const next = dropTile(storyboard(), 'player', 's-scenes', 'bottom');
    expect(shape(next.root)).toEqual({ row: [{ column: ['scenes', 'player'] }, 'board', 'inspector'] });
    if (next.root.kind !== 'split') throw new Error('root should stay a split');
    expect(total(next.root.sizes)).toBeCloseTo(1);
  });

  it('merges a split into a parent running the same way', () => {
    const next = dropTile(storyboard(), 'inspector', 's-scenes', 'right');
    expect(shape(next.root)).toEqual({ row: ['scenes', 'inspector', { column: ['board', 'player'] }] });
  });

  it('changes nothing when a lone tile is dropped on itself', () => {
    const layout = storyboard();
    expect(dropTile(layout, 'board', 's-board', 'left')).toBe(layout);
  });

  it('can pull a tab out of its own stack to an edge', () => {
    const tabbed = dropTile(storyboard(), 'player', 's-board', 'center');
    const out = dropTile(tabbed, 'player', 's-board', 'right');
    expect(shape(out.root)).toEqual({ row: ['scenes', 'board', 'player', 'inspector'] });
  });
});

describe('closing a tile', () => {
  it('gives its space to the neighbour before it', () => {
    const next = removeTile(storyboard(), 'inspector');
    expect(shape(next.root)).toEqual({ row: ['scenes', { column: ['board', 'player'] }] });
    if (next.root.kind !== 'split') throw new Error('root should stay a split');
    expect(next.root.sizes[1]).toBeCloseTo(4 / 5);
  });

  it('gives a first tile’s space to the one after it', () => {
    const next = removeTile(storyboard(), 'scenes');
    if (next.root.kind !== 'split') throw new Error('root should stay a split');
    expect(next.root.sizes[0]).toBeCloseTo(4 / 5);
  });

  it('never closes the last tile in a workspace', () => {
    const lone: Layout = { root: stack(['board']), maximized: null };
    expect(removeTile(lone, 'board')).toBe(lone);
  });

  it('restores normal view when the maximized tile closes', () => {
    const maximized = toggleMaximize(storyboard(), 's-player');
    expect(removeTile(maximized, 'player').maximized).toBeNull();
  });
});

describe('splitters', () => {
  it('resize both neighbours together and keep each above a minimum', () => {
    const layout = storyboard();
    const next = resizeSplit(layout, 'root', 0, 0.5);
    if (next.root.kind !== 'split') throw new Error('root should stay a split');
    expect(next.root.sizes.map((s) => Number(s.toFixed(3)))).toEqual([0.5, 0.3, 0.2]);
    const squeezed = resizeSplit(layout, 'root', 0, 0.99);
    if (squeezed.root.kind !== 'split') throw new Error('root should stay a split');
    expect(squeezed.root.sizes[1]).toBeCloseTo(0.05);
  });

  it('even out the two tiles either side on a double-click', () => {
    const next = evenOut(storyboard(), 'root', 1);
    if (next.root.kind !== 'split') throw new Error('root should stay a split');
    expect(next.root.sizes[1]).toBeCloseTo(next.root.sizes[2] ?? 0);
  });

  it('snap to another line within 8px, and only then', () => {
    expect(snap(103, [96, 300])).toEqual({ position: 96, snappedTo: 96 });
    expect(snap(110, [96, 300])).toEqual({ position: 110, snappedTo: null });
  });
});

describe('drop zones', () => {
  const box = { left: 0, top: 0, width: 400, height: 200 };
  it('are the four edges and the centre', () => {
    expect(zoneAt(box, 20, 100)).toBe('left');
    expect(zoneAt(box, 390, 100)).toBe('right');
    expect(zoneAt(box, 200, 10)).toBe('top');
    expect(zoneAt(box, 200, 190)).toBe('bottom');
    expect(zoneAt(box, 200, 100)).toBe('center');
  });

  it('preview the half a split would take', () => {
    expect(previewBox(box, 'right')).toEqual({ left: 200, top: 0, width: 200, height: 200 });
    expect(previewBox(box, 'center')).toEqual(box);
  });
});

describe('layouts', () => {
  it('open a tile beside everything, or bring an open one to the front', () => {
    const opened = openTile(storyboard(), 'calendar');
    expect(tilesIn(opened)).toContain('calendar');
    const tabbed = dropTile(storyboard(), 'player', 's-board', 'center');
    expect(stackOf(openTile(tabbed, 'board'), 'board')?.active).toBe('board');
  });

  it('maximize and restore without touching anything else', () => {
    const layout = storyboard();
    const max = toggleMaximize(layout, 's-board');
    expect(max.maximized).toBe('s-board');
    expect(toggleMaximize(max, 's-board')).toEqual(layout);
  });

  it('check a saved layout before it is used', () => {
    expect(isLayout(storyboard())).toBe(true);
    expect(isLayout({ root: { kind: 'split', id: 'x', direction: 'row', children: [], sizes: [] }, maximized: null })).toBe(false);
    expect(isLayout({ root: { kind: 'stack', id: 'x', tiles: [], active: 'a' }, maximized: null })).toBe(false);
    expect(isLayout('nonsense')).toBe(false);
  });

  it('compare by shape, so new ids alone never count as an unsaved change', () => {
    expect(sameLayout(storyboard(), storyboard())).toBe(true);
    expect(sameLayout(storyboard(), removeTile(storyboard(), 'player'))).toBe(false);
    expect(stacks(storyboard().root)).toHaveLength(4);
  });
});

describe('docking along a window edge (polish 4)', () => {
  it('spans the whole bottom, under every other tile, at a quarter of the height', () => {
    const next = dockToEdge(storyboard(), 'inspector', 'bottom');
    expect(next.root.kind).toBe('split');
    if (next.root.kind !== 'split') return;
    expect(next.root.direction).toBe('column');
    expect(next.root.children.at(-1)).toMatchObject({ kind: 'stack', tiles: ['inspector'] });
    expect(next.root.sizes.at(-1)).toBeCloseTo(EDGE_SHARE);
    // The rest keeps its shape: scenes | (board over player) side by side above.
    expect(tilesIn(next)).toEqual(['scenes', 'board', 'player', 'inspector']);
  });

  it('spans the whole top, above everything', () => {
    const next = dockToEdge(storyboard(), 'player', 'top');
    if (next.root.kind !== 'split') throw new Error('expected a split');
    expect(next.root.direction).toBe('column');
    expect(next.root.children[0]).toMatchObject({ kind: 'stack', tiles: ['player'] });
    expect(next.root.sizes[0]).toBeCloseTo(EDGE_SHARE);
  });

  it('along the right, merges into a row of tiles rather than nesting, each keeping its share of the rest', () => {
    const next = dockToEdge(storyboard(), 'scenes', 'right');
    if (next.root.kind !== 'split') throw new Error('expected a split');
    expect(next.root.direction).toBe('row');
    expect(stacks(next.root).map((s) => s.tiles[0])).toEqual(['board', 'player', 'inspector', 'scenes']);
    expect(next.root.sizes.at(-1)).toBeCloseTo(EDGE_SHARE);
    expect(next.root.sizes.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it('takes one tab out of a stack, leaving the others', () => {
    const tabbed = dropTile(storyboard(), 'player', 's-board', 'center');
    const next = dockToEdge(tabbed, 'player', 'bottom');
    expect(stackOf(next, 'board')?.tiles).toEqual(['board']);
    expect(stackOf(next, 'player')?.tiles).toEqual(['player']);
  });

  it('leaves a workspace’s only tile where it is, and restores a maximized layout', () => {
    const one: Layout = { root: stack(['team'], 's-team'), maximized: null };
    expect(dockToEdge(one, 'team', 'bottom')).toBe(one);
    const max = toggleMaximize(storyboard(), 's-board');
    expect(dockToEdge(max, 'inspector', 'right').maximized).toBeNull();
  });

  it('finds the edge band near the top, right and bottom, never the left', () => {
    const panel = { left: 248, top: 44, width: 1192, height: 832 };
    expect(windowEdgeAt(panel, 600, 44 + 10)).toBe('top');
    expect(windowEdgeAt(panel, 248 + 1192 - 5, 400)).toBe('right');
    expect(windowEdgeAt(panel, 600, 44 + 832 - 20)).toBe('bottom');
    expect(windowEdgeAt(panel, 248 + 5, 400)).toBeNull();
    expect(windowEdgeAt(panel, 600, 400)).toBeNull();
    expect(windowEdgeAt(panel, 100, 400)).toBeNull();
    expect(edgePreviewBox(panel, 'right')).toEqual({ left: 248 + 1192 * 0.75, top: 44, width: 1192 * 0.25, height: 832 });
  });
});
