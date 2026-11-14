import { Line } from 'react-konva';
import type { Beyond, CanvasColours, Rect } from '../../../ui/canvas/types';
import { unionBounds } from '../../../ui/canvas/viewport';

// A path between one owner's positions on the plan (6.7, decision 9): from each position to the next a straight dashed
// line, ink as the kit's walk path is (never themed, decision 13), with an arrowhead at the later end, stopping at the
// edge of each position's mark so it never runs over a drawing or a label. Worked out each time from the positions,
// never stored. It is drawn past the box of the owner's first position (CanvasItem.beyond), so the canvas keeps it while
// that box is off screen, and its bounds take in every position. Only straight lines in this milestone.

/** What a path is drawn from, worked out by the plan (markLooks.ts): canvas units, absolute. */
export interface PathLook {
  /** Each position's middle, in order. */
  points: readonly { x: number; y: number }[];
  /** How far from each middle the line stops: half the mark's shorter side. */
  radii: readonly number[];
  /** Every position's box together: what Fit all and the minimap count for the owner's first position. */
  fit: Rect;
}

/** The dashes, screen pixels: a walk path's look. */
const DASH: readonly number[] = [6, 4];
/** The arrowhead's length and width, screen pixels. */
const HEAD_PIXELS = 10;
const HEAD_WIDTH_PIXELS = 7;

/** A segment's ends cut back by the marks at either end, or null when the marks overlap and nothing shows between them. */
export function segmentEnds(a: { x: number; y: number }, b: { x: number; y: number }, ra: number, rb: number): [number, number, number, number] | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d <= ra + rb) return null;
  const ux = dx / d;
  const uy = dy / d;
  return [a.x + ux * ra, a.y + uy * ra, b.x - ux * rb, b.y - uy * rb];
}

/** A point from the plan into the owner's own box (canvas units): the inverse of the canvas's turn about its middle. */
function toLocal(p: { x: number; y: number }, box: { x: number; y: number; width: number; height: number; rotation: number }): { x: number; y: number } {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const turn = (-box.rotation * Math.PI) / 180;
  const dx = p.x - cx;
  const dy = p.y - cy;
  return { x: box.width / 2 + dx * Math.cos(turn) - dy * Math.sin(turn), y: box.height / 2 + dx * Math.sin(turn) + dy * Math.cos(turn) };
}

/** The path's lines and arrowheads, in the owner's own box. */
export function PathShape({ path, box, zoom, colours }: { path: PathLook; box: { x: number; y: number; width: number; height: number; rotation: number }; zoom: number; colours: CanvasColours }) {
  const head = HEAD_PIXELS / zoom;
  const half = HEAD_WIDTH_PIXELS / zoom / 2;
  const parts = path.points.slice(1).flatMap((to, i) => {
    const from = path.points[i];
    if (!from) return [];
    const ends = segmentEnds(from, to, path.radii[i] ?? 0, path.radii[i + 1] ?? 0);
    if (!ends) return [];
    const a = toLocal({ x: ends[0], y: ends[1] }, box);
    const b = toLocal({ x: ends[2], y: ends[3] }, box);
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const ux = (b.x - a.x) / d;
    const uy = (b.y - a.y) / d;
    // The head's back, no further back than the line is long.
    const back = Math.min(head, d);
    const bx = b.x - ux * back;
    const by = b.y - uy * back;
    return [
      <Line key={`line${String(i)}`} points={[a.x, a.y, bx, by]} stroke={colours.ink} strokeWidth={1.5} dash={[...DASH]} strokeScaleEnabled={false} listening={false} />,
      <Line key={`head${String(i)}`} points={[b.x, b.y, bx - uy * half, by + ux * half, bx + uy * half, by - ux * half]} closed fill={colours.ink} listening={false} />,
    ];
  });
  return <>{parts}</>;
}

/** How far a path reaches (canvas units): every position's middle, with room for an arrowhead at the plan's least zoom. */
export function pathReach(path: PathLook, leastZoom: number): Rect {
  const pad = HEAD_PIXELS / leastZoom;
  const xs = path.points.map((p) => p.x);
  const ys = path.points.map((p) => p.y);
  const reach = { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, width: Math.max(...xs) - Math.min(...xs) + 2 * pad, height: Math.max(...ys) - Math.min(...ys) + 2 * pad };
  return unionBounds([reach, path.fit]) ?? reach;
}

/** The canvas's drawing of a path past the owner's first position, and how far it reaches. */
export function pathBeyond(box: { x: number; y: number; width: number; height: number; rotation: number }, path: PathLook, leastZoom: number): Beyond {
  return {
    bounds: pathReach(path, leastZoom),
    draw: (context) => <PathShape path={path} box={box} zoom={context.zoom} colours={context.colours} />,
  };
}

/** Two drawings past one box as one (a camera's cone and its move's path): both drawn, the first under, reaching as far as either. */
export function joinBeyond(under: Beyond | undefined, over: Beyond | undefined): Beyond | undefined {
  if (!under || !over) return under ?? over;
  return {
    bounds: unionBounds([under.bounds, over.bounds]) ?? under.bounds,
    draw: (context) => (
      <>
        {under.draw(context)}
        {over.draw(context)}
      </>
    ),
  };
}
