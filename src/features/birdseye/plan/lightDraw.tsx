import { Circle, Line, Rect, Wedge } from 'react-konva';
import { isAllRound } from '../../../core/model/planLight';
import { DEPT_LIGHTING } from '../../../ui/canvas/paperColours';
import type { Beyond, CanvasColours } from '../../../ui/canvas/types';
import { cameraReach, labelReach, UprightLabels } from './cameraDraw';
import { paintOf } from './iconDraw';

// A light's beam on the plan (6.5, decision 8): from the light's middle along its rotation (0 is up the plan, as a
// camera's), as wide as its beam angle, BEAM_LENGTH_M long, its far edge an arc. A light that shines all round (a china
// ball, a practical, a spacelight) is a soft circle instead, no cone. Both in the lighting department's fixed colour
// (DEPT_LIGHTING: plans are never themed, decision 13) at a low opacity with a thin edge of the same colour, stronger
// while the light is selected. Under it, as a camera's, its labels in mono, upright: its name, its watts and its height.
// All of it is drawn past the light's box (CanvasItem.beyond), so the core keeps it drawn while the box is off screen.

/** What a light's drawing past its box shows, worked out from the records by the plan (lightLooks.ts). */
export interface LightLook {
  /** Its beam angle, degrees; 360 (all round) draws the soft circle. */
  degrees: number;
  lines: readonly string[];
  selected: boolean;
}

const FILL_OPACITY = 0.18;
const EDGE_OPACITY = 0.7;
const GLOW_OPACITY = 0.3;

/**
 * The beam's wedge in the light's own box, as Konva's Wedge draws one (clockwise from +x, degrees): it points the way
 * the icon's drawing does (`facing`, clockwise from up the box: BEAM_FACING), so it starts half its angle before that.
 * Null for a light that shines all round.
 */
export function beamWedge(degrees: number, facing = 0): { rotation: number; angle: number } | null {
  if (isAllRound(degrees)) return null;
  return { rotation: -90 + facing - degrees / 2, angle: degrees };
}

/** The beam's axis in the light's own box, as a unit vector (y down): where the middle of its wedge points. */
export function beamAxis(degrees: number, facing = 0): { x: number; y: number } | null {
  const wedge = beamWedge(degrees, facing);
  if (!wedge) return null;
  const middle = ((wedge.rotation + wedge.angle / 2) * Math.PI) / 180;
  return { x: Math.round(Math.cos(middle) * 1e9) / 1e9, y: Math.round(Math.sin(middle) * 1e9) / 1e9 };
}

interface BeamProps {
  width: number;
  height: number;
  zoom: number;
  rotation: number;
  colours: CanvasColours;
  look: LightLook;
  length: number;
  /** Which way the icon's drawing points, degrees clockwise from up its box (BEAM_FACING). */
  facing: number;
}

/** The beam (or the soft circle) and the labels, in the light's own box. */
export function LightBeyond({ width, height, zoom, rotation, colours, look, length, facing }: BeamProps) {
  const wedge = beamWedge(look.degrees, facing);
  const centre = { x: width / 2, y: height / 2 };
  return (
    <>
      {wedge ? (
        <>
          <Wedge {...centre} radius={length} angle={wedge.angle} rotation={wedge.rotation} fill={DEPT_LIGHTING} opacity={FILL_OPACITY} listening={false} />
          <Wedge
            {...centre}
            radius={length}
            angle={wedge.angle}
            rotation={wedge.rotation}
            stroke={DEPT_LIGHTING}
            strokeWidth={look.selected ? 1.5 : 1}
            opacity={look.selected ? 1 : EDGE_OPACITY}
            strokeScaleEnabled={false}
            listening={false}
          />
        </>
      ) : (
        <>
          <Circle
            {...centre}
            radius={length}
            fillRadialGradientStartPoint={{ x: 0, y: 0 }}
            fillRadialGradientEndPoint={{ x: 0, y: 0 }}
            fillRadialGradientStartRadius={0}
            fillRadialGradientEndRadius={length}
            fillRadialGradientColorStops={[0, paintOf(DEPT_LIGHTING, GLOW_OPACITY), 1, paintOf(DEPT_LIGHTING, 0)]}
            listening={false}
          />
          <Circle {...centre} radius={length} stroke={DEPT_LIGHTING} strokeWidth={look.selected ? 1.5 : 1} opacity={look.selected ? 1 : EDGE_OPACITY * 0.6} strokeScaleEnabled={false} listening={false} />
        </>
      )}
      <UprightLabels width={width} height={height} zoom={zoom} rotation={rotation} colours={colours} lines={look.lines} />
    </>
  );
}

/**
 * The canvas's drawing past a light's box, and how far it reaches: the whole circle its beam can sweep (`length` round
 * its box, whichever way it points and whatever its icon's facing) and its labels, reckoned for the plan's least zoom as
 * a camera's are.
 */
export function lightBeyond(box: { x: number; y: number; width: number; height: number; rotation: number }, look: LightLook, length: number, leastZoom: number, facing = 0): Beyond {
  return {
    bounds: cameraReach(box, null, 0, length, labelReach(box, look.lines.length, leastZoom)),
    draw: (context) => (
      <LightBeyond width={context.width} height={context.height} zoom={context.zoom} rotation={context.rotation} colours={context.colours} look={look} length={length} facing={facing} />
    ),
  };
}

/** A standing frame's bar, screen pixels thick, and the ticks at its ends (as the kit's diffusion icon has them). */
const BAR_PIXELS = 3.5;
const TICK_PIXELS = 10;

/**
 * A standing flag or diffusion frame seen from above (6.5): a line its width long across the middle of its box, solid
 * ink for a flag, the kit's dashes for diffusion, with a tick at each end, at the kit's weights in screen pixels at any
 * zoom. A frame lying flat (the overhead) is drawn as its icon instead.
 */
export function StandingFrameShape({ width, height, zoom, dashed, colours }: { width: number; height: number; zoom: number; dashed: boolean; colours: CanvasColours }) {
  const y = height / 2;
  const tick = TICK_PIXELS / zoom / 2;
  const ink = { stroke: colours.ink, strokeScaleEnabled: false, listening: false, lineCap: 'round' as const };
  return (
    <>
      {/* The whole box, clear: the handles take the item's box from what it draws, and the bar and ticks alone are narrower. */}
      <Rect width={width} height={height} fill="transparent" listening={false} />
      <Line points={[0, y, width, y]} strokeWidth={BAR_PIXELS} {...(dashed ? { dash: [3, 2] } : {})} {...ink} />
      <Line points={[0, y - tick, 0, y + tick]} strokeWidth={1.5} {...ink} />
      <Line points={[width, y - tick, width, y + tick]} strokeWidth={1.5} {...ink} />
    </>
  );
}
