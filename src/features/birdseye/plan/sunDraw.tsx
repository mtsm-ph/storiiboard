import { Circle, Group, Line, Text } from 'react-konva';
import { UPRIGHT } from '../../../ui/canvas/ItemNodes';
import { GOLDEN_HOUR } from '../../../ui/canvas/paperColours';
import type { Beyond, CanvasColours, Rect } from '../../../ui/canvas/types';
import { cameraReach, labelHalo, labelReach, UprightLabels } from './cameraDraw';

// A sun path on the plan (6.6): round its middle, never turned with its box (its drawing is the compass's), the arc of
// the sun's bearing from sunrise to sunset 3 m out, ink with its golden-hour stretches in golden hour's fixed colour
// (never themed, decision 13) edged in ink, so they read on paper and in print (Burning Flame on paper alone is about
// 1.5:1), and drawn thicker, a second cue; a tick at every whole hour; sunrise and sunset marked; then the sun at the
// item's time: a line out to the arc, a small sun there, and a thin dashed line the other way, where shadows fall. Every
// word sits INSIDE the arc (6.6 review: outside it, they ran past the tile's edges and into each other): the hours just
// inside their ticks, "Rise" and "Set" a row further in at the arc's ends, the sun's label beside its line near the
// middle, "shadows" beside its own line. Each word has a paper halo (labelHalo), so it stays legible over a wall. Zoomed
// out so far that the circle has no room for words (they would pile up on each other and on the icon), it draws only
// the arc with its golden stretches and the sun's line and mark; the Selection tile still gives the numbers. With
// something missing it draws none of that: only its icon and a label saying what. All of it is past the item's box
// (CanvasItem.beyond), in screen-pixel weights and sizes at every zoom, upright.

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
/** The gap between a tick or a line and the word beside it, screen pixels. */
const GAP_PIXELS = 4;
const SUN_PIXELS = 5;
/**
 * How far the drawing can reach past the arc, screen pixels: its ticks, and at a far zoom out, where the arc is smaller on
 * screen than they are, the words beside the sun's line (the sun's label, the widest).
 */
const WORDS_REACH_PIXELS = 240;
/** The shadow line's length, in arc radii. */
const SHADOW_LENGTH = 0.6;
/** A golden stretch: gold over an ink casing, screen pixels. */
export const GOLDEN_PIXELS = 3;
export const GOLDEN_CASING_PIXELS = 5;

/** A word's lines' height, in font sizes. */
const LINE_HEIGHT = 1.2;

/** A mono word's upright half width and half height at a size (every character is as wide), one line or several. */
const halfBox = (text: string, size: number) => {
  const lines = text.split('\n');
  const longest = Math.max(...lines.map((line) => line.length));
  return { w: (longest * MONO_ADVANCE * size) / 2, h: lines.length === 1 ? size / 2 : (lines.length * size * LINE_HEIGHT) / 2 };
};

/**
 * The sun's label as drawn: one line where it fits between the icon and the arc, else a line per part ("14:30", "235°",
 * "64° high"), so that, zoomed out, it still sits inside the circle.
 */
export function sunLabelLines(label: string, room: number, size: number): string {
  if (halfBox(label, size).w * 2 <= room) return label;
  return label.split(' · ').join('\n');
}

/** How far an upright box's middle is from its edge along a unit direction. */
const extentAlong = (dir: { x: number; y: number }, half: { w: number; h: number }) => Math.abs(dir.x) * half.w + Math.abs(dir.y) * half.h;

/** A mono line centred at a point, its width worked out from its letters, with a paper halo. */
function MonoText({ x, y, text, size, colours, bold = false }: { x: number; y: number; text: string; size: number; colours: CanvasColours; bold?: boolean }) {
  const half = halfBox(text, size);
  const wide = 2 * half.w + size;
  return (
    <Text
      x={x - wide / 2}
      y={y - half.h}
      width={wide}
      align="center"
      text={text}
      lineHeight={text.includes('\n') ? LINE_HEIGHT : 1}
      fontFamily='"JetBrains Mono"'
      fontStyle={bold ? 'bold' : 'normal'}
      fontSize={size}
      fill={colours.ink}
      {...labelHalo(LABEL_PIXELS / size)}
      wrap="none"
      listening={false}
    />
  );
}

/** Where a word's middle goes so that the whole word sits just inside the circle `distance` out along `dir`. */
export function insideAt(dir: { x: number; y: number }, distance: number, text: string, size: number): { x: number; y: number } {
  const d = distance - extentAlong(dir, halfBox(text, size));
  return { x: dir.x * d, y: dir.y * d };
}

/**
 * Where a word's middle goes beside a line from the middle along `dir`: wholly past `from` along the line, and wholly off
 * it to the side `side` (a unit vector square to the line), by `gap`. So it never sits on the line nor on the icon.
 */
export function besideLine(dir: { x: number; y: number }, side: { x: number; y: number }, from: number, gap: number, text: string, size: number): { x: number; y: number } {
  const half = halfBox(text, size);
  const along = from + extentAlong(dir, half);
  const off = gap + extentAlong(side, half);
  return { x: dir.x * along + side.x * off, y: dir.y * along + side.y * off };
}

/** Square to the sun's line, the side that is down the plan (or to the right, for a line straight across). */
export function sideOf(sun: { x: number; y: number }): { x: number; y: number } {
  const n = { x: -sun.y, y: sun.x };
  return n.y > 0 || (n.y === 0 && n.x > 0) ? n : { x: -n.x, y: -n.y };
}

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
  const gap = GAP_PIXELS / zoom;
  const r = look.radius;
  const ink = { stroke: colours.ink, strokeScaleEnabled: false, listening: false } as const;
  const at = (t: { x: number; y: number }, d: number) => ({ x: t.x * d, y: t.y * d });
  const sunPoint = at(look.sun, r);
  const shadowEnd = at(look.sun, -r * SHADOW_LENGTH);
  const iconHalf = Math.hypot(width, height) / 2;
  const below = iconHalf + size;
  // The hours just inside their ticks; sunrise and sunset a row further in, so they never sit on the first or last hour.
  const hourRing = r - tick - gap;
  const edgeRing = hourRing - size * 1.6;
  const side = sideOf(look.sun);
  const label = sunLabelLines(look.label, r - iconHalf - 3 * gap, size);
  const away = { x: -look.sun.x, y: -look.sun.y };
  const plain = look.segments.filter((segment) => !segment.golden);
  const golden = look.segments.filter((segment) => segment.golden);
  // Too small on screen for words between the icon and the arc (6.6 second review): only the arc and the sun.
  const wordless = edgeRing < iconHalf + size;
  return (
    // Named upright: while a move or resize is under way the canvas keeps it so (it is never turned by the handles).
    <Group x={width / 2} y={height / 2} rotation={-rotation} name={UPRIGHT} listening={false}>
      {plain.map((segment, i) => (
        <Line key={`arc${String(i)}`} points={[...segment.points]} strokeWidth={look.selected ? 2 : 1.5} lineCap="round" lineJoin="round" {...ink} />
      ))}
      {golden.map((segment, i) => (
        <Group key={`gold${String(i)}`} listening={false}>
          {/* Ink under gold: the gold reads as a line edged in ink, on paper and in print. */}
          <Line points={[...segment.points]} strokeWidth={GOLDEN_CASING_PIXELS} lineCap="round" lineJoin="round" name="golden-casing" {...ink} />
          <Line points={[...segment.points]} stroke={GOLDEN_HOUR} strokeWidth={GOLDEN_PIXELS} strokeScaleEnabled={false} lineCap="round" lineJoin="round" name="golden" listening={false} />
        </Group>
      ))}
      {wordless && look.sun.up && (
        <>
          <Line points={[0, 0, sunPoint.x, sunPoint.y]} strokeWidth={1.5} {...ink} />
          <Circle x={sunPoint.x} y={sunPoint.y} radius={SUN_PIXELS / zoom} fill={GOLDEN_HOUR} stroke={colours.ink} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
        </>
      )}
      {!wordless && look.hours.map((hour) => (
        <Group key={`h${hour.label}`} listening={false}>
          <Line points={[hour.x * (r - tick), hour.y * (r - tick), hour.x * (r + tick), hour.y * (r + tick)]} strokeWidth={1} {...ink} />
          <MonoText {...insideAt(hour, hourRing, hour.label, size)} text={hour.label} size={size} colours={colours} />
        </Group>
      ))}
      {!wordless && [look.rise, look.set].map((edge, i) =>
        edge ? (
          <Group key={i === 0 ? 'rise' : 'set'} listening={false}>
            <Line points={[edge.x * (r - 2 * tick), edge.y * (r - 2 * tick), edge.x * (r + 2 * tick), edge.y * (r + 2 * tick)]} strokeWidth={2} {...ink} />
            <MonoText {...insideAt(edge, edgeRing, edge.label, size)} text={edge.label} size={size} colours={colours} bold />
          </Group>
        ) : null,
      )}
      {wordless ? null : look.sun.up ? (
        <>
          <Line points={[0, 0, sunPoint.x, sunPoint.y]} strokeWidth={1.5} {...ink} />
          <Line points={[0, 0, shadowEnd.x, shadowEnd.y]} strokeWidth={1} dash={[4, 3]} {...ink} />
          <Circle x={sunPoint.x} y={sunPoint.y} radius={SUN_PIXELS / zoom} fill={GOLDEN_HOUR} stroke={colours.ink} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
          {/* Beside the sun's line, by the middle, clear of the icon; "shadows" beside its own line, on the same side. */}
          <MonoText {...besideLine(look.sun, side, iconHalf + gap, gap, label, size)} text={label} size={size} colours={colours} bold />
          <MonoText {...besideLine(away, side, iconHalf + gap, gap, look.shadows, size)} text={look.shadows} size={size} colours={colours} />
        </>
      ) : (
        <MonoText x={0} y={below} text={look.label} size={size} colours={colours} bold />
      )}
    </Group>
  );
}

/** What a drawn sun path counts for when a view is fitted to everything (6.6 review): its arc's whole circle. */
export function sunFitExtent(box: { x: number; y: number; width: number; height: number }, look: SunLook): Rect | null {
  if (look.kind !== 'drawn') return null;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return { x: cx - look.radius, y: cy - look.radius, width: 2 * look.radius, height: 2 * look.radius };
}

/**
 * The canvas's drawing past a sun path's box, and how far it reaches: the arc's circle and its ticks round the box's
 * middle, reckoned for the plan's least zoom (they are in screen pixels), so nothing on screen is culled with it. With
 * something missing, its label alone, as an icon's.
 */
export function sunBeyond(box: { x: number; y: number; width: number; height: number; rotation: number }, look: SunLook, leastZoom: number): Beyond {
  const draw: Beyond['draw'] = (context) => <SunBeyond width={context.width} height={context.height} zoom={context.zoom} rotation={context.rotation} colours={context.colours} look={look} />;
  if (look.kind === 'missing') return { bounds: cameraReach(box, null, 0, 0, labelReach(box, look.lines.length, leastZoom)), draw };
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const reach = Math.max(look.radius, Math.hypot(box.width, box.height) / 2) + WORDS_REACH_PIXELS / leastZoom;
  return { bounds: { x: cx - reach, y: cy - reach, width: 2 * reach, height: 2 * reach }, draw };
}
