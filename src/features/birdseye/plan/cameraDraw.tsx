import { Group, Line, Text } from 'react-konva';
import { UPRIGHT } from '../../../ui/canvas/ItemNodes';
import { PAPER } from '../../../ui/canvas/paperColours';
import type { Beyond, CanvasColours, Rect } from '../../../ui/canvas/types';
import { unionBounds } from '../../../ui/canvas/viewport';

// A camera's field of view on the plan (6.4, decision 6): from the camera's middle along its rotation (0 is up the plan,
// as the icon's lens is), as wide as the angle the project's frame sees, CONE_LENGTH_M long, its far edge open. Plans
// are never themed (decision 13), so the cone is ink at 8% with thin ink edges in light and dark, its edges full ink
// while the camera is selected. design/DESIGN.md's older line, a selected camera's cone in the accent at 10%, is
// superseded by decision 13. Under it, by the camera, its labels in mono: its name, then its letter, focal length and
// angle ("A · 50 mm · 51.1°", or what is missing), then a set height. All of it is drawn past the camera's box
// (CanvasItem.beyond), so the canvas core keeps it drawn while the box is off screen and picks only the box.

/** What a camera's drawing past its box shows, worked out from the records by the plan (planItems.ts). */
export interface CameraLook {
  /** The cone's whole angle, degrees; null draws no cone (no body, no sensor size or no focal length). */
  degrees: number | null;
  /** The label lines under the camera, top to bottom. */
  lines: readonly string[];
  selected: boolean;
}

const FILL_OPACITY = 0.08;
const EDGE_OPACITY = 0.55;
const LABEL_PIXELS = 11;
/** The labels' line height, in label sizes. */
const LINE_HEIGHT = 1.3;
/** How wide a label line may run, screen pixels (it is cut short with an ellipsis past it). */
const LABEL_SPAN_PIXELS = 200;
/** The gap between the box and the first label line, screen pixels. */
const LABEL_GAP_PIXELS = 3;

/** The cone's three corners in the camera's own box (canvas units): its middle, then the left and right far ends. */
export function conePoints(width: number, height: number, degrees: number, length: number): [number, number, number, number, number, number] {
  const half = (degrees / 2) * (Math.PI / 180);
  const cx = width / 2;
  const cy = height / 2;
  return [cx, cy, cx - Math.sin(half) * length, cy - Math.cos(half) * length, cx + Math.sin(half) * length, cy - Math.cos(half) * length];
}

/**
 * Where a camera's labels can reach on the plan (canvas units) when drawn at `zoom`: centred under its middle, upright
 * whatever way it points, as wide as a line may run and as deep as its lines. Labels are sized in screen pixels, so the
 * fewer the pixels per unit, the further they reach: worked out for the least zoom, they are never culled on screen.
 */
export function labelReach(box: { x: number; y: number; width: number; height: number }, lines: number, zoom: number): Rect | null {
  if (lines === 0) return null;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const span = Math.max(box.width, LABEL_SPAN_PIXELS / zoom);
  const below = Math.hypot(box.width, box.height) / 2 + LABEL_GAP_PIXELS / zoom;
  return { x: cx - span / 2, y: cy, width: span, height: below + (lines * LABEL_PIXELS * LINE_HEIGHT) / zoom };
}

/**
 * How far a camera's drawing reaches on the plan (canvas units): its cone's corners turned with it, `labelRoom` round
 * its box, and its labels (`labels`, from labelReach).
 */
export function cameraReach(
  box: { x: number; y: number; width: number; height: number; rotation: number },
  degrees: number | null,
  length: number,
  labelRoom: number,
  labels: Rect | null = null,
): Rect {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const boxed: Rect = { x: box.x - labelRoom, y: box.y - labelRoom, width: box.width + 2 * labelRoom, height: box.height + 2 * labelRoom };
  const around = labels ? (unionBounds([boxed, labels]) ?? boxed) : boxed;
  if (degrees === null) return around;
  const p = conePoints(box.width, box.height, degrees, length);
  const turn = (box.rotation * Math.PI) / 180;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < p.length; i += 2) {
    const dx = (p[i] ?? 0) - box.width / 2;
    const dy = (p[i + 1] ?? 0) - box.height / 2;
    xs.push(cx + dx * Math.cos(turn) - dy * Math.sin(turn));
    ys.push(cy + dx * Math.sin(turn) + dy * Math.cos(turn));
  }
  const cone = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  return unionBounds([around, cone]) ?? around;
}

interface ConeProps {
  width: number;
  height: number;
  zoom: number;
  rotation: number;
  colours: CanvasColours;
  look: CameraLook;
  length: number;
}

/** JetBrains Mono's advance, in font sizes: every character is this wide, so a label's width is known without measuring. */
const MONO_ADVANCE = 0.6;

/** How wide a label's paper halo is drawn, screen pixels (half of it shows round each letter). */
export const HALO_PIXELS = 3;

/**
 * A plan label's paper halo (6.6 review): the text stroked in the fixed paper colour under its ink, so a label stays
 * legible where it crosses a wall, a cone or a beam, with no box behind it. Plans only; the paper is the fixed one, as a
 * plan is never themed (decision 13). Spread into a Konva Text.
 */
export const LABEL_HALO = { stroke: PAPER, strokeWidth: HALO_PIXELS, strokeScaleEnabled: false, fillAfterStrokeEnabled: true, lineJoin: 'round' } as const;

/**
 * Labels under an item's middle, in mono, kept upright whatever way it is turned (a camera's, 6.4; a light's and any
 * item's height, 6.5, decision 11): clear of its box at half its diagonal, as labelReach reckons them.
 */
export function UprightLabels({
  width,
  height,
  zoom,
  rotation,
  colours,
  lines,
}: {
  width: number;
  height: number;
  zoom: number;
  rotation: number;
  colours: CanvasColours;
  lines: readonly string[];
}) {
  if (lines.length === 0) return null;
  const size = LABEL_PIXELS / zoom;
  // Clear of the box whichever way it is turned: half its diagonal from its middle (labelReach reads the same numbers).
  const below = Math.hypot(width, height) / 2 + LABEL_GAP_PIXELS / zoom;
  const span = Math.max(width, LABEL_SPAN_PIXELS / zoom);
  return (
    // Named upright: while the handles turn the item, the canvas turns this back by the live turn (UPRIGHT).
    <Group x={width / 2} y={height / 2} rotation={-rotation} name={UPRIGHT} listening={false}>
      {lines.map((text, i) => (
        <Text
          key={`${String(i)}:${text}`}
          text={text}
          x={-span / 2}
          y={below + i * size * LINE_HEIGHT}
          width={span}
          align="center"
          fontFamily='"JetBrains Mono"'
          fontSize={size}
          fill={colours.ink}
          {...LABEL_HALO}
          wrap="none"
          ellipsis
          listening={false}
        />
      ))}
    </Group>
  );
}

/** The cone and the labels, in the camera's own box; the labels kept upright whatever way it points. */
export function CameraBeyond({ width, height, zoom, rotation, colours, look, length }: ConeProps) {
  const points = look.degrees === null ? null : conePoints(width, height, look.degrees, length);
  return (
    <>
      {points && (
        <>
          <Line points={points} closed fill={colours.ink} opacity={FILL_OPACITY} listening={false} />
          <Line
            points={[points[2], points[3], points[0], points[1], points[4], points[5]]}
            stroke={colours.ink}
            strokeWidth={look.selected ? 1.5 : 1}
            opacity={look.selected ? 1 : EDGE_OPACITY}
            strokeScaleEnabled={false}
            listening={false}
          />
        </>
      )}
      <UprightLabels width={width} height={height} zoom={zoom} rotation={rotation} colours={colours} lines={look.lines} />
    </>
  );
}

/**
 * The canvas's drawing past a camera's box, and how far it reaches. Its labels' reach is worked out for `leastZoom`, the
 * plan's least zoom, not the view's: a zoom then never makes the item again (its bounds stay as they are), and wherever
 * the view is zoomed its labels reach no further than that, so a label on screen is never culled with its box.
 */
export function cameraBeyond(box: { x: number; y: number; width: number; height: number; rotation: number }, look: CameraLook, length: number, leastZoom: number): Beyond {
  return {
    bounds: cameraReach(box, look.degrees, length, 0, labelReach(box, look.lines.length, leastZoom)),
    draw: (context) => <CameraBeyond width={context.width} height={context.height} zoom={context.zoom} rotation={context.rotation} colours={context.colours} look={look} length={length} />,
  };
}

/**
 * Labels alone past an item's box (6.5, decision 11): an icon's, a flag's or a diffusion frame's name and height, drawn
 * and reckoned as a camera's are, so a label on screen is never culled with its box.
 */
export function labelsBeyond(box: { x: number; y: number; width: number; height: number; rotation: number }, lines: readonly string[], leastZoom: number): Beyond {
  return {
    bounds: cameraReach(box, null, 0, 0, labelReach(box, lines.length, leastZoom)),
    draw: (context) => <UprightLabels width={context.width} height={context.height} zoom={context.zoom} rotation={context.rotation} colours={context.colours} lines={lines} />,
  };
}

// A wall's, a door's and a window's height (6.5 second review): beside the item's middle, never on it. A label drawn on
// a wall was painted out by a door in its middle (openings paint paper over their wall) and ran past a short wall's
// ends, so it sits off to one side along the box's normal (its local +y, or -y), always the same side for a given
// direction, so a room drawn the same way round has all its labels inside or all outside. Upright, through the beyond
// drawing, so the canvas keeps it upright while the handles turn the item; no paper patch, so nothing is notched.

/** Something on the label's side of the item's middle line it must sit past: along the box's width, canvas units. */
export interface BesideClear {
  from: number;
  to: number;
  /** How far it reaches from the box's middle line, on the label's side. */
  reach: number;
}

export interface BesideSpec {
  lines: readonly string[];
  /** Which side of the box's middle line: +1 its local +y (the normal), -1 the other. */
  side: 1 | -1;
  /** How far the box's own edge is from its middle line on that side. */
  edge: number;
  /** What else it sits past where it overlaps the label along the box (a door swinging to the wall's label side). */
  clears?: readonly BesideClear[];
}

/** A beside label's size, upright, in canvas units at `zoom`. */
function besideSize(lines: readonly string[], zoom: number): { width: number; height: number; size: number; row: number } {
  const size = LABEL_PIXELS / zoom;
  const row = size * LINE_HEIGHT;
  const longest = Math.max(0, ...lines.map((text) => text.length));
  return { width: longest * MONO_ADVANCE * size, height: lines.length * row, size, row };
}

/**
 * Where a beside label's middle is in the item's own box (canvas units), and its upright size: off the box's middle along
 * its normal, past its edge (and anything in `clears` it overlaps along the box) by a fixed gap of screen pixels, plus as
 * much of the upright label as falls across the turned box, so it never touches it at any rotation.
 */
export function besidePlace(box: { width: number; height: number }, spec: BesideSpec, zoom: number, rotation: number): { x: number; y: number; width: number; height: number } {
  const { width, height } = besideSize(spec.lines, zoom);
  const turn = (rotation * Math.PI) / 180;
  const sin = Math.abs(Math.sin(turn));
  const cos = Math.abs(Math.cos(turn));
  const mid = box.width / 2;
  const along = (cos * width) / 2 + (sin * height) / 2;
  let reach = spec.edge;
  for (const clear of spec.clears ?? []) if (clear.to > mid - along && clear.from < mid + along) reach = Math.max(reach, clear.reach);
  const across = (sin * width) / 2 + (cos * height) / 2;
  return { x: mid, y: box.height / 2 + spec.side * (reach + LABEL_GAP_PIXELS / zoom + across), width, height };
}

/** A beside label's lines, upright, centred on where besidePlace puts them. */
export function BesideLabels({ width, height, zoom, rotation, colours, spec }: { width: number; height: number; zoom: number; rotation: number; colours: CanvasColours; spec: BesideSpec }) {
  if (spec.lines.length === 0) return null;
  const place = besidePlace({ width, height }, spec, zoom, rotation);
  const { size, row } = besideSize(spec.lines, zoom);
  // A character's slack either side, so a line exactly as wide as the mono advance says is never cut.
  const span = place.width + 2 * size;
  return (
    <Group x={place.x} y={place.y} rotation={-rotation} name={UPRIGHT} listening={false}>
      {spec.lines.map((text, i) => (
        <Text
          key={`${String(i)}:${text}`}
          text={text}
          x={-span / 2}
          y={-place.height / 2 + i * row + (row - size) / 2}
          width={span}
          align="center"
          fontFamily='"JetBrains Mono"'
          fontSize={size}
          fill={colours.ink}
          {...LABEL_HALO}
          wrap="none"
          listening={false}
        />
      ))}
    </Group>
  );
}

/**
 * The canvas's drawing of a beside label, and how far it can reach: round the box's middle, as far as the furthest
 * thing it may sit past plus the whole label, worked out for the plan's least zoom (as a camera's labels are), so a
 * zoom never makes the item again and the label is never culled on screen.
 */
export function besideBeyond(box: { x: number; y: number; width: number; height: number; rotation: number }, spec: BesideSpec, leastZoom: number): Beyond {
  const { width, height } = besideSize(spec.lines, leastZoom);
  const reach = Math.max(spec.edge, ...(spec.clears ?? []).map((clear) => clear.reach)) + LABEL_GAP_PIXELS / leastZoom + (width + height) / 2;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return {
    bounds: { x: cx - reach - width / 2, y: cy - reach - height / 2, width: 2 * reach + width, height: 2 * reach + height },
    draw: (context) => <BesideLabels width={context.width} height={context.height} zoom={context.zoom} rotation={context.rotation} colours={context.colours} spec={spec} />,
  };
}
