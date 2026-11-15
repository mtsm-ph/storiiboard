import { Group, Line, Text } from 'react-konva';
import { UPRIGHT } from '../../../ui/canvas/ItemNodes';
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

/** The cone and the labels, in the camera's own box; the labels kept upright whatever way it points. */
export function CameraBeyond({ width, height, zoom, rotation, colours, look, length }: ConeProps) {
  const points = look.degrees === null ? null : conePoints(width, height, look.degrees, length);
  const size = LABEL_PIXELS / zoom;
  // Clear of the box whichever way it is turned: half its diagonal from its middle (labelReach reads the same numbers).
  const below = Math.hypot(width, height) / 2 + LABEL_GAP_PIXELS / zoom;
  const span = Math.max(width, LABEL_SPAN_PIXELS / zoom);
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
      {/* Named upright: while the handles turn the camera, the canvas turns this back by the live turn (UPRIGHT). */}
      <Group x={width / 2} y={height / 2} rotation={-rotation} name={UPRIGHT} listening={false}>
        {look.lines.map((text, i) => (
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
            wrap="none"
            ellipsis
            listening={false}
          />
        ))}
      </Group>
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
