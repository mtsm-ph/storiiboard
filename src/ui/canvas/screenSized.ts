import type Konva from 'konva';
import type { Point } from './types';

// Drawings sized on screen (6.11: a plan's labels, in screen pixels over the zoom). Items are drawn for the zoom they
// settle at (5.7), so while a wheel or pinch zoom is on its way such a drawing grew or shrank with the view: at 400% a
// label drawn for 20% was twenty times its size, its paper halo as wide, and drawing that much text froze the zoom. A
// node drawn so says, through its ref, the zoom it was drawn for, where React put it, and its anchor: the point in its
// parent's units that stays put (a label's corner of the item), its offset from there being in screen pixels over the
// zoom as its contents are. The canvas scales it about the anchor by that zoom over the view's (fitScreenSized), so it
// keeps its size and its gap on screen at every step of a zoom and is drawn again only once the zoom settles, as every
// item is. At rest the scale is 1 and the node is where React put it: what is drawn is exactly what was drawn before.
// A board draws none, so nothing here runs for it.

interface Sized {
  zoom: number;
  at: Point;
  anchor: Point;
}

const live = new Map<Konva.Node, Sized>();

/**
 * A ref for a node drawn at `zoom`, placed at `at` (its x and y as given to React), whose offset from `anchor` and whose
 * contents are sized in screen pixels.
 */
export function screenSizedRef(zoom: number, at: Point, anchor: Point): (node: Konva.Node | null) => void {
  return (node) => {
    if (node) live.set(node, { zoom, at, anchor });
  };
}

/** The scale a node drawn for `drawnZoom` takes at the view's `zoom`, so it is the size on screen it was drawn to be. */
export const screenScale = (drawnZoom: number, zoom: number): number => (drawnZoom > 0 && zoom > 0 && Number.isFinite(drawnZoom / zoom) ? drawnZoom / zoom : 1);

/** Where a node drawn so sits, scaled by `k` about its anchor. */
export const scaledAt = (sized: Sized, k: number): Point => ({ x: sized.anchor.x + k * (sized.at.x - sized.anchor.x), y: sized.anchor.y + k * (sized.at.y - sized.anchor.y) });

/**
 * Scales and places every screen-sized node on `stage` for the view's `zoom`; forgets those no longer on any stage.
 * Whether any changed (the stage needs drawing).
 */
export function fitScreenSized(stage: Konva.Stage | null, zoom: number): boolean {
  let changed = false;
  for (const [node, sized] of live) {
    const on = node.getStage();
    if (!on) {
      live.delete(node);
      continue;
    }
    if (on !== stage) continue;
    const k = screenScale(sized.zoom, zoom);
    const to = scaledAt(sized, k);
    if (node.scaleX() !== k || node.scaleY() !== k || node.x() !== to.x || node.y() !== to.y) {
      node.scale({ x: k, y: k });
      node.position(to);
      changed = true;
    }
  }
  return changed;
}

/** How many screen-sized nodes are known: for tests. */
export const screenSizedCount = (): number => live.size;
