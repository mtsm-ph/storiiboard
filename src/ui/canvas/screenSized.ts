import type Konva from 'konva';
import type { Point } from './types';

// Drawings sized on screen (6.11: a plan's labels, in screen pixels over the zoom). Items are drawn for the zoom they
// settle at (5.7), so while a wheel or pinch zoom is on its way such a drawing grew or shrank with the view: at 400% a
// label drawn for 20% was twenty times its size, its paper halo as wide, and drawing that much text froze the zoom. A
// node drawn so says, through its ref, the zoom it was drawn for, where React put it, and its anchor: the point in its
// parent's units that stays put (a label's corner of the item), its offset from there being in screen pixels over the
// zoom as its contents are. The canvas scales it about the anchor by that zoom over the view's (fitScreenSized), so it
// keeps its size and its gap on screen at every step of a zoom and is drawn again only once the zoom settles, as every
// item is. At rest the scale is exactly 1 and the node is exactly where React put it: what is drawn is what was drawn
// before. A board draws none, so nothing here runs for it.

interface Sized {
  zoom: number;
  at: Point;
  anchor: Point;
  /**
   * Below this view zoom, during a zoom (the view's zoom not the one it was drawn for), the node is hidden: a sun path's
   * words, which at that zoom would have no room inside its arc (6.11 review, L1). At rest it is always shown: whether
   * it is drawn at all was decided for the zoom it was drawn at.
   */
  hideBelow?: number;
  /** Held at scale 1 while the handles turn or resize its item (6.11 review, L2). */
  held?: boolean;
}

const live = new Map<Konva.Node, Sized>();
/**
 * The nodes held at scale 1 by the handles (holdScreenSized), by node, until releaseScreenSized: a node drawn again
 * mid-gesture (6.18 review: a plan's cone remade as it turns) is registered anew through a new ref, and stays held.
 */
const heldNodes = new Set<Konva.Node>();

/**
 * A ref for a node drawn at `zoom`, placed at `at` (its x and y as given to React), whose offset from `anchor` and whose
 * contents are sized in screen pixels; hidden during a zoom below `hideBelow`, when given. The node is forgotten when
 * React lets it go (6.11 review, L4: a closed Plan tile, an export's page), not kept until some canvas draws again.
 */
export function screenSizedRef(zoom: number, at: Point, anchor: Point, hideBelow?: number): (node: Konva.Node | null) => void {
  let mine: Konva.Node | null = null;
  return (node) => {
    if (node) {
      mine = node;
      live.set(node, { zoom, at, anchor, ...(hideBelow === undefined ? {} : { hideBelow }), ...(heldNodes.has(node) ? { held: true } : {}) });
    } else if (mine) {
      live.delete(mine);
      mine = null;
    }
  };
}

/** The scale a node drawn for `drawnZoom` takes at the view's `zoom`, so it is the size on screen it was drawn to be. */
export const screenScale = (drawnZoom: number, zoom: number): number => (drawnZoom > 0 && zoom > 0 && Number.isFinite(drawnZoom / zoom) ? drawnZoom / zoom : 1);

/** Where a node drawn so sits, scaled by `k` about its anchor: exactly where React put it at 1. */
export const scaledAt = (sized: Sized, k: number): Point =>
  k === 1 ? sized.at : { x: sized.anchor.x + k * (sized.at.x - sized.anchor.x), y: sized.anchor.y + k * (sized.at.y - sized.anchor.y) };

/** Whether a node drawn so is shown at the view's `zoom`. */
const shownAt = (sized: Sized, zoom: number): boolean => sized.hideBelow === undefined || zoom === sized.zoom || zoom >= sized.hideBelow;

/**
 * Scales, places and shows or hides every screen-sized node on `stage` for the view's `zoom`; forgets those no longer on
 * any stage. Whether any changed (the stage needs drawing).
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
    const k = sized.held === true ? 1 : screenScale(sized.zoom, zoom);
    const to = scaledAt(sized, k);
    if (node.scaleX() !== k || node.scaleY() !== k || node.x() !== to.x || node.y() !== to.y) {
      node.scale({ x: k, y: k });
      node.position(to);
      changed = true;
    }
    if (sized.hideBelow !== undefined) {
      const show = shownAt(sized, zoom);
      if (node.visible() !== show) {
        node.visible(show);
        changed = true;
      }
    }
  }
  return changed;
}

/** Whether `node` is `root` or inside it. */
function within(node: Konva.Node, root: Konva.Node): boolean {
  for (let at: Konva.Node | null = node; at; at = at.getParent()) if (at === root) return true;
  return false;
}

/**
 * The screen-sized nodes in these (the items the handles hold) put back to scale 1, where React put them, and held there
 * until releaseScreenSized: their anchors were worked out for the item as it was, not as the handles turn it.
 */
export function holdScreenSized(roots: readonly Konva.Node[]): void {
  if (roots.length === 0) return;
  const stages = new Set(roots.map((root) => root.getStage()));
  for (const [node, sized] of live) {
    if (!stages.has(node.getStage()) || !roots.some((root) => within(node, root))) continue;
    sized.held = true;
    heldNodes.add(node);
    node.scale({ x: 1, y: 1 });
    node.position(sized.at);
  }
}

/** Every held node let go: the next fit scales it for the view's zoom again. */
export function releaseScreenSized(): void {
  heldNodes.clear();
  for (const sized of live.values()) delete sized.held;
}

/** How many screen-sized nodes are known: for tests. */
export const screenSizedCount = (): number => live.size;
