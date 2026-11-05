import { EDGE_SHARE, type DropZone, type WindowEdge } from './layout';

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** How deep into a tile, as a share of its size, the edge zones reach; the rest is the centre. */
export const EDGE_ZONE = 0.25;

/** The five zones of a tile under the pointer: the nearest edge when within its band, otherwise the centre. */
export function zoneAt(box: Box, x: number, y: number): DropZone {
  const fx = (x - box.left) / box.width;
  const fy = (y - box.top) / box.height;
  const edges: [DropZone, number][] = [
    ['left', fx],
    ['right', 1 - fx],
    ['top', fy],
    ['bottom', 1 - fy],
  ];
  const [zone, distance] = edges.reduce((nearest, edge) => (edge[1] < nearest[1] ? edge : nearest));
  return distance < EDGE_ZONE ? zone : 'center';
}

/** Where a drop would put the tile: half the target for an edge, all of it for a tab. */
export function previewBox(box: Box, zone: DropZone): Box {
  const halfW = box.width / 2;
  const halfH = box.height / 2;
  switch (zone) {
    case 'left':
      return { ...box, width: halfW };
    case 'right':
      return { ...box, left: box.left + halfW, width: halfW };
    case 'top':
      return { ...box, height: halfH };
    case 'bottom':
      return { ...box, top: box.top + halfH, height: halfH };
    case 'center':
      return box;
  }
}

/**
 * The window edge a dragged tile would dock along (polish 4): past the tiles themselves, in the gap around them, over
 * the top bar or the status bar, or at the window's right edge. Inside the tiles each tile's own zones apply, so a
 * tile let go on its own title bar stays where it was. Never the left, the sidebar's: there is no left edge.
 */
export function windowEdgeAt(tiles: Box, x: number, y: number): WindowEdge | null {
  if (x < tiles.left) return null;
  if (y < tiles.top) return 'top';
  if (y > tiles.top + tiles.height) return 'bottom';
  if (x > tiles.left + tiles.width) return 'right';
  return null;
}

/** Where a tile docked along a window edge would go: that whole side, at the share it will take. */
export function edgePreviewBox(panel: Box, edge: WindowEdge, share = EDGE_SHARE): Box {
  switch (edge) {
    case 'top':
      return { ...panel, height: panel.height * share };
    case 'bottom':
      return { ...panel, top: panel.top + panel.height * (1 - share), height: panel.height * share };
    case 'right':
      return { ...panel, left: panel.left + panel.width * (1 - share), width: panel.width * share };
  }
}

/** The splitter magnet: within 8px of another splitter's line, snap onto it (DESIGN.md, Tiles). */
export const SNAP_PX = 8;

export function snap(position: number, lines: readonly number[]): { position: number; snappedTo: number | null } {
  let best: number | null = null;
  for (const line of lines) {
    if (Math.abs(line - position) <= SNAP_PX && (best === null || Math.abs(line - position) < Math.abs(best - position))) {
      best = line;
    }
  }
  return best === null ? { position, snappedTo: null } : { position: best, snappedTo: best };
}
