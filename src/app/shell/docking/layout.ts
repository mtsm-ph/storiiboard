// A workspace's layout is a tree: splits divide space between their children, and stacks hold one or more tiles as
// tabs. Everything here is a pure function from one layout to the next, so a layout change is easy to test, to undo
// and to save, and the drag code only has to pick which change to make.

export type TileId = string;

export interface Stack {
  kind: 'stack';
  id: string;
  tiles: TileId[];
  active: TileId;
}

export interface Split {
  kind: 'split';
  id: string;
  /** row: children side by side; column: stacked top to bottom. */
  direction: 'row' | 'column';
  children: LayoutNode[];
  /** Each child's share of the split, summing to 1. */
  sizes: number[];
}

export type LayoutNode = Stack | Split;

export interface Layout {
  root: LayoutNode;
  /** The stack filling the workspace, or null. Maximize changes nothing else, so restore is exact. */
  maximized: string | null;
}

/** Where a dragged tile lands on a target: an edge splits it, the centre adds a tab. */
export type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center';

let counter = 0;
/** Node ids only need to be unique within a layout; a counter plus time keeps them unique across saves too. */
export function nodeId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export function stack(tiles: TileId[], id = nodeId('stack')): Stack {
  const [first] = tiles;
  if (first === undefined) throw new Error('A stack needs at least one tile.');
  return { kind: 'stack', id, tiles, active: first };
}

export function split(direction: Split['direction'], children: LayoutNode[], sizes?: number[], id = nodeId('split')): Split {
  const even = children.map(() => 1 / children.length);
  return { kind: 'split', id, direction, children, sizes: normalise(sizes ?? even) };
}

function normalise(sizes: number[]): number[] {
  const total = sizes.reduce((sum, size) => sum + size, 0);
  return sizes.map((size) => size / total);
}

export function stacks(node: LayoutNode): Stack[] {
  return node.kind === 'stack' ? [node] : node.children.flatMap(stacks);
}

export function tilesIn(layout: Layout): TileId[] {
  return stacks(layout.root).flatMap((s) => s.tiles);
}

export function findStack(layout: Layout, id: string): Stack | undefined {
  return stacks(layout.root).find((s) => s.id === id);
}

export function stackOf(layout: Layout, tile: TileId): Stack | undefined {
  return stacks(layout.root).find((s) => s.tiles.includes(tile));
}

/** Rebuilds the tree bottom-up, dropping empty stacks and folding splits left with one child into their parent. */
function tidy(node: LayoutNode): LayoutNode | null {
  if (node.kind === 'stack') {
    if (node.tiles.length === 0) return null;
    return node.tiles.includes(node.active) ? node : { ...node, active: node.tiles[0] ?? node.active };
  }
  const kept: { child: LayoutNode; size: number }[] = [];
  node.children.forEach((child, i) => {
    const next = tidy(child);
    if (next) kept.push({ child: next, size: node.sizes[i] ?? 0 });
  });
  if (kept.length === 0) return null;
  if (kept.length === 1) return kept[0]?.child ?? null;
  // A child split running the same way as its parent merges into it, keeping every tile's share of space.
  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  for (const { child, size } of kept) {
    if (child.kind === 'split' && child.direction === node.direction) {
      child.children.forEach((grandchild, j) => {
        children.push(grandchild);
        sizes.push(size * (child.sizes[j] ?? 0));
      });
    } else {
      children.push(child);
      sizes.push(size);
    }
  }
  return { ...node, children, sizes: normalise(sizes) };
}

function map(node: LayoutNode, change: (node: LayoutNode) => LayoutNode): LayoutNode {
  const next = node.kind === 'split' ? { ...node, children: node.children.map((child) => map(child, change)) } : node;
  return change(next);
}

/**
 * Takes a tile out of the layout. A stack left empty gives its space to the neighbour before it in its split (the
 * one after it if it was first), which is the neighbour it shared its whole edge with.
 */
export function removeTile(layout: Layout, tile: TileId, spread = false): Layout {
  // A workspace always keeps at least one tile.
  if (tilesIn(layout).length <= 1) return layout;
  const emptied = stackOf(layout, tile);
  let root = map(layout.root, (node) => {
    if (node.kind === 'stack') return node.tiles.includes(tile) ? { ...node, tiles: node.tiles.filter((t) => t !== tile) } : node;
    const index = node.children.findIndex((child) => child.kind === 'stack' && child.id === emptied?.id && child.tiles.length === 0);
    if (index < 0) return node;
    const sizes = [...node.sizes];
    // Spread: every neighbour in the split grows by its share (tidy renormalises). Otherwise the one it shared its
    // longest edge with takes all of it.
    if (!spread) {
      const heir = index > 0 ? index - 1 : index + 1;
      sizes[heir] = (sizes[heir] ?? 0) + (sizes[index] ?? 0);
    }
    sizes[index] = 0;
    return { ...node, sizes };
  });
  root = tidy(root) ?? root;
  const maximized = layout.maximized && findStack({ root, maximized: null }, layout.maximized) ? layout.maximized : null;
  return { root, maximized };
}

/**
 * Drops a tile on another stack. The centre adds it as that stack's open tab; an edge splits the target, and the new
 * tile takes half the target's space. Nothing else in the layout moves.
 */
export function dropTile(layout: Layout, tile: TileId, targetStackId: string, zone: DropZone): Layout {
  const target = findStack(layout, targetStackId);
  if (!target) return layout;
  // Dropping a lone tile on its own stack changes nothing.
  if (target.tiles.length === 1 && target.tiles[0] === tile) return layout;
  const without = removeTile(layout, tile);
  const root = map(without.root, (node) => {
    if (node.kind !== 'stack' || node.id !== targetStackId) return node;
    if (zone === 'center') return { ...node, tiles: [...node.tiles, tile], active: tile };
    const incoming = stack([tile]);
    const direction = zone === 'left' || zone === 'right' ? 'row' : 'column';
    const before = zone === 'left' || zone === 'top';
    return split(direction, before ? [incoming, node] : [node, incoming]);
  });
  // The target may have been the tile's own stack, now one tile smaller; either way the tree needs tidying.
  return { root: tidy(root) ?? root, maximized: null };
}

/** The window's edges a tile can dock along (polish 4). Never the left: that edge is the sidebar's. */
export type WindowEdge = 'top' | 'right' | 'bottom';

/** How much of the workspace a tile docked along a window edge takes, across that side. */
export const EDGE_SHARE = 0.25;

/**
 * Docks a tile along a whole side of the workspace: everything else stays as it is, in the rest of the space, and the
 * tile spans the full width (top, bottom) or height (right). It comes out of wherever it was first, so a tile already
 * along that edge just moves there again.
 */
export function dockToEdge(layout: Layout, tile: TileId, edge: WindowEdge): Layout {
  // A workspace's only tile has nothing to dock beside.
  if (!tilesIn(layout).includes(tile) || tilesIn(layout).length <= 1) return layout;
  if (dockedAt(layout, tile) === edge) return layout;
  // What it leaves is shared out among its neighbours by their sizes, so the rest keeps its proportions.
  const rest = removeTile(layout, tile, true).root;
  const incoming = stack([tile]);
  const direction = edge === 'right' ? 'row' : 'column';
  const root =
    edge === 'top'
      ? split(direction, [incoming, rest], [EDGE_SHARE, 1 - EDGE_SHARE])
      : split(direction, [rest, incoming], [1 - EDGE_SHARE, EDGE_SHARE]);
  // A rest split the same way merges into this one, each of its tiles keeping its share of what's left.
  return { root: tidy(root) ?? root, maximized: null };
}

/** The window edge a tile already spans on its own, if any: alone in the first or last place of the root. */
export function dockedAt(layout: Layout, tile: TileId): WindowEdge | null {
  const root = layout.root;
  if (root.kind !== 'split') return null;
  const alone = (node: LayoutNode | undefined) => node?.kind === 'stack' && node.tiles.length === 1 && node.tiles[0] === tile;
  if (root.direction === 'column' && alone(root.children[0])) return 'top';
  if (root.direction === 'column' && alone(root.children.at(-1))) return 'bottom';
  if (root.direction === 'row' && alone(root.children.at(-1))) return 'right';
  return null;
}

/**
 * Adds a tile that isn't in the layout yet, to the right of the given stack (or of everything). One that's there
 * already comes to the front: its tab is picked, and a maximized tile that hides it is restored. Already in view, the
 * layout is returned as it is, so asking again is no layout change to undo.
 */
export function openTile(layout: Layout, tile: TileId, besideStackId?: string): Layout {
  if (tilesIn(layout).includes(tile)) {
    const holder = stackOf(layout, tile);
    if (!holder) return layout;
    const hidden = layout.maximized !== null && layout.maximized !== holder.id;
    if (holder.active === tile && !hidden) return layout;
    const picked = selectTab(layout, holder.id, tile);
    return hidden ? { ...picked, maximized: null } : picked;
  }
  const beside = besideStackId ? findStack(layout, besideStackId) : undefined;
  if (beside) return dropTile({ ...layout, root: layout.root }, tile, beside.id, 'right');
  return { root: tidy(split('row', [layout.root, stack([tile])], [3, 1])) ?? layout.root, maximized: null };
}

export function selectTab(layout: Layout, stackId: string, tile: TileId): Layout {
  return {
    ...layout,
    root: map(layout.root, (node) => (node.kind === 'stack' && node.id === stackId && node.tiles.includes(tile) ? { ...node, active: tile } : node)),
  };
}

/** Moves the line between children `index` and `index + 1`, keeping both above `minimum` of the split. */
export function resizeSplit(layout: Layout, splitId: string, index: number, share: number, minimum = 0.05): Layout {
  return {
    ...layout,
    root: map(layout.root, (node) => {
      if (node.kind !== 'split' || node.id !== splitId) return node;
      const a = node.sizes[index];
      const b = node.sizes[index + 1];
      if (a === undefined || b === undefined) return node;
      const pair = a + b;
      const nextA = Math.min(Math.max(share, minimum), pair - minimum);
      const sizes = [...node.sizes];
      sizes[index] = nextA;
      sizes[index + 1] = pair - nextA;
      return { ...node, sizes };
    }),
  };
}

/** Double-clicking a splitter evens out the two tiles either side of it. */
export function evenOut(layout: Layout, splitId: string, index: number): Layout {
  return {
    ...layout,
    root: map(layout.root, (node) => {
      if (node.kind !== 'split' || node.id !== splitId) return node;
      const a = node.sizes[index];
      const b = node.sizes[index + 1];
      if (a === undefined || b === undefined) return node;
      const sizes = [...node.sizes];
      sizes[index] = (a + b) / 2;
      sizes[index + 1] = (a + b) / 2;
      return { ...node, sizes };
    }),
  };
}

export function toggleMaximize(layout: Layout, stackId: string): Layout {
  return { ...layout, maximized: layout.maximized === stackId ? null : stackId };
}

/** A saved layout read back from settings, checked so a corrupt or hand-edited one can't break the shell. */
export function isLayoutNode(value: unknown): value is LayoutNode {
  if (typeof value !== 'object' || value === null) return false;
  const node = value as Record<string, unknown>;
  if (typeof node.id !== 'string') return false;
  if (node.kind === 'stack') {
    return (
      Array.isArray(node.tiles) &&
      node.tiles.length > 0 &&
      node.tiles.every((t) => typeof t === 'string') &&
      typeof node.active === 'string'
    );
  }
  return (
    node.kind === 'split' &&
    (node.direction === 'row' || node.direction === 'column') &&
    Array.isArray(node.children) &&
    Array.isArray(node.sizes) &&
    node.children.length >= 2 &&
    node.children.length === node.sizes.length &&
    node.sizes.every((s) => typeof s === 'number' && s > 0) &&
    node.children.every(isLayoutNode)
  );
}

export function isLayout(value: unknown): value is Layout {
  if (typeof value !== 'object' || value === null) return false;
  const layout = value as Record<string, unknown>;
  return isLayoutNode(layout.root) && (layout.maximized === null || typeof layout.maximized === 'string');
}

/** Same tiles in the same places at the same sizes, ignoring node ids and which tab is open. */
export function sameLayout(a: Layout, b: Layout): boolean {
  const shape = (node: LayoutNode): unknown =>
    node.kind === 'stack'
      ? node.tiles
      : [node.direction, node.sizes.map((s) => Math.round(s * 1000)), node.children.map(shape)];
  return JSON.stringify(shape(a.root)) === JSON.stringify(shape(b.root));
}
