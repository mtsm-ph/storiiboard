import { Circle, Group, Line, Text } from 'react-konva';
import { UPRIGHT } from '../../../ui/canvas/ItemNodes';
import { GOLDEN_HOUR } from '../../../ui/canvas/paperColours';
import type { Beyond, CanvasColours } from '../../../ui/canvas/types';
import { cameraReach, labelReach, UprightLabels } from './cameraDraw';

// A sun path on the plan (6.6): round its middle, never turned with its box (its drawing is the compass's), the arc of
// the sun's bearing from sunrise to sunset 3 m out, ink with its golden-hour stretches in golden hour's fixed colour
// (never themed, decision 13) and drawn thicker, a second cue; a tick and the hour at every whole hour; sunrise and
// sunset marked with their times; then the sun at the item's time: a line out to the arc, a small sun there and its
// label ("14:30 · 212° · 38° high"), and a thin dashed line the other way, where shadows fall. With something missing it
// draws none of that: only its icon and a label saying what. All of it is past the item's box (CanvasItem.beyond), in
// screen-pixel weights and sizes at every zoom, upright.

/** A direction on the plan from the path's middle, a unit vector (y down), with what is written there. */
export interface SunTick {
  x: number;
  y: number;
  label: string;
}

/** What a sun path's drawing past its box shows, worked out from the records by the plan (sunLooks.ts). */
export type SunLook =
  | { kind: 'missing'; lines: readonly string[]; selected: boolean }
  | {
      kind: 'drawn';
      /** The arc's radius, canvas units. */
      radius: number;
      /** The arc in stretches, each golden or not; points round the middle, canvas units. */
      segments: readonly { golden: boolean; points: readonly number[] }[];
      hours: readonly SunTick[];
      rise: SunTick | null;
      set: SunTick | null;
      /** Toward the sun at the item's time, and whether it is up. */
      sun: { x: number; y: number; up: boolean };
      /** "14:30 · 212° · 38° high", or "21:10 · the sun is down". */
      label: string;
      /** "shadows". */
      shadows: string;
      selected: boolean;
    };

const LABEL_PIXELS = 11;
const MONO_ADVANCE = 0.6;
const TICK_PIXELS = 5;
const HOUR_GAP_PIXELS = 12;
const EDGE_GAP_PIXELS = 30;
const SUN_PIXELS = 5;
/** How far the drawing's words reach past the arc, screen pixels: the sun's label, the widest. */
const WORDS_REACH_PIXELS = 220;
/** The shadow line's length, in arc radii. */
const SHADOW_LENGTH = 0.6;

/** A mono line centred at a point, its width worked out from its letters (every one is as wide). */
function MonoText({ x, y, text, size, colours, bold = false }: { x: number; y: number; text: string; size: number; colours: CanvasColours; bold?: boolean }) {
  const wide = text.length * MONO_ADVANCE * size + size;
  return (
    <Text
      x={x - wide / 2}
      y={y - size / 2}
      width={wide}
      align="center"
      text={text}
      fontFamily='"JetBrains Mono"'
      fontStyle={bold ? 'bold' : 'normal'}
      fontSize={size}
      fill={colours.ink}
      wrap="none"
      listening={false}
    />
  );
}

/** A word placed just past a point in a direction, its middle pushed out by half its width so it never sits on the line. */
const beside = (p: { x: number; y: number }, dir: { x: number; y: number }, text: string, size: number, gap: number) => {
  const half = (text.length * MONO_ADVANCE * size) / 2;
  return { x: p.x + dir.x * (half + gap), y: p.y + dir.y * (size + gap) };
};

interface SunProps {
  width: number;
  height: number;
  zoom: number;
  rotation: number;
  colours: CanvasColours;
  look: SunLook;
}

/** The path, the hours, the sun and its label, in the item's own box, upright whatever its box's rotation. */
export function SunBeyond({ width, height, zoom, rotation, colours, look }: SunProps) {
  if (look.kind === 'missing') return <UprightLabels width={width} height={height} zoom={zoom} rotation={rotation} colours={colours} lines={look.lines} />;
  const size = LABEL_PIXELS / zoom;
  const tick = TICK_PIXELS / zoom;
  const r = look.radius;
  const ink = { stroke: colours.ink, strokeScaleEnabled: false, listening: false } as const;
  const at = (t: { x: number; y: number }, d: number) => ({ x: t.x * d, y: t.y * d });
  const sunPoint = at(look.sun, r);
  const shadowEnd = at(look.sun, -r * SHADOW_LENGTH);
  const below = Math.hypot(width, height) / 2 + size;
  // Where words past the arc start: beyond the hour ticks and their numbers.
  const outside = r + tick + (HOUR_GAP_PIXELS + EDGE_GAP_PIXELS) / zoom - size;
  return (
    // Named upright: while a move or resize is under way the canvas keeps it so (it is never turned by the handles).
    <Group x={width / 2} y={height / 2} rotation={-rotation} name={UPRIGHT} listening={false}>
      {look.segments.map((segment, i) => (
        <Line
          key={`arc${String(i)}`}
          points={[...segment.points]}
          stroke={segment.golden ? GOLDEN_HOUR : colours.ink}
          strokeWidth={segment.golden ? 3.5 : look.selected ? 2 : 1.5}
          strokeScaleEnabled={false}
          lineCap="round"
          lineJoin="round"
          listening={false}
        />
      ))}
      {look.hours.map((hour) => (
        <Group key={`h${hour.label}`} listening={false}>
          <Line points={[hour.x * (r - tick), hour.y * (r - tick), hour.x * (r + tick), hour.y * (r + tick)]} strokeWidth={1} {...ink} />
          <MonoText x={hour.x * (r + tick + HOUR_GAP_PIXELS / zoom)} y={hour.y * (r + tick + HOUR_GAP_PIXELS / zoom)} text={hour.label} size={size} colours={colours} />
        </Group>
      ))}
      {[look.rise, look.set].map((edge, i) =>
        edge ? (
          <Group key={i === 0 ? 'rise' : 'set'} listening={false}>
            <Line points={[edge.x * (r - 2 * tick), edge.y * (r - 2 * tick), edge.x * (r + 2 * tick), edge.y * (r + 2 * tick)]} strokeWidth={2} {...ink} />
            {/* Past the hours' numbers, pushed out by half its width so it never sits on them. */}
            <MonoText {...beside(at(edge, outside), edge, edge.label, size, 0)} text={edge.label} size={size} colours={colours} bold />
          </Group>
        ) : null,
      )}
      {look.sun.up ? (
        <>
          <Line points={[0, 0, sunPoint.x, sunPoint.y]} strokeWidth={1.5} {...ink} />
          <Line points={[0, 0, shadowEnd.x, shadowEnd.y]} strokeWidth={1} dash={[4, 3]} {...ink} />
          <Circle x={sunPoint.x} y={sunPoint.y} radius={SUN_PIXELS / zoom} fill={GOLDEN_HOUR} stroke={colours.ink} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
          <MonoText {...beside(at(look.sun, outside), look.sun, look.label, size, 0)} text={look.label} size={size} colours={colours} bold />
          <MonoText {...beside(shadowEnd, { x: -look.sun.x, y: -look.sun.y }, look.shadows, size, 6 / zoom)} text={look.shadows} size={size} colours={colours} />
        </>
      ) : (
        <MonoText x={0} y={below} text={look.label} size={size} colours={colours} bold />
      )}
    </Group>
  );
}

/**
 * The canvas's drawing past a sun path's box, and how far it reaches: the arc's circle and its words round the box's
 * middle, reckoned for the plan's least zoom (its words are in screen pixels), so nothing on screen is culled with it.
 * With something missing, its label alone, as an icon's.
 */
export function sunBeyond(box: { x: number; y: number; width: number; height: number; rotation: number }, look: SunLook, leastZoom: number): Beyond {
  const draw: Beyond['draw'] = (context) => <SunBeyond width={context.width} height={context.height} zoom={context.zoom} rotation={context.rotation} colours={context.colours} look={look} />;
  if (look.kind === 'missing') return { bounds: cameraReach(box, null, 0, 0, labelReach(box, look.lines.length, leastZoom)), draw };
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const reach = Math.max(look.radius, Math.hypot(box.width, box.height) / 2) + WORDS_REACH_PIXELS / leastZoom;
  return { bounds: { x: cx - reach, y: cy - reach, width: 2 * reach, height: 2 * reach }, draw };
}
