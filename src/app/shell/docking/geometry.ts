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
 * How close to the workspace's top, right or bottom edge the pointer has to be for a tile to dock along that whole
 * side (polish 4): the 8px gap plus a band into the tiles, wide enough to find, narrow enough to leave each tile's
 * own edge zones their room. The left edge is the sidebar's, so it has none.
 */
export const WINDOW_EDGE_PX = 24;

export function windowEdgeAt(panel: Box, x: number, y: number): WindowEdge | null {
  if (x < panel.left || x > panel.left + panel.width || y < panel.top || y > panel.top + panel.height) return null;
  const distances: [WindowEdge, number][] = [
    ['top', y - panel.top],
    ['right', panel.left + panel.width - x],
    ['bottom', panel.top + panel.height - y],
  ];
  const [edge, distance] = distances.reduce((nearest, next) => (next[1] < nearest[1] ? next : nearest));
  return distance <= WINDOW_EDGE_PX ? edge : null;
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
