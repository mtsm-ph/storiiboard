import { Circle, Group, Line, Text } from 'react-konva';
import { UPRIGHT } from '../../../ui/canvas/ItemNodes';
import { GOLDEN_HOUR } from '../../../ui/canvas/paperColours';
import { screenSizedRef } from '../../../ui/canvas/screenSized';
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
      /**
       * Toward the sun when the location's light reference photo was taken (6.27), with its date and time, "Photo Nov 3,
       * 16:42", and whether the sun was up then: only while the sun path shows the sun at the photo's time. The words
       * are drawn either way (the arc, Rise and Set are for that date); the mark on the path only when it was up.
       * Left out otherwise.
       */
      photo?: SunTick & { up: boolean };
    };

const LABEL_PIXELS = 11;
const MONO_ADVANCE = 0.6;
const TICK_PIXELS = 5;
/** The gap between a tick or a line and the word beside it, screen pixels. */
const GAP_PIXELS = 4;
const SUN_PIXELS = 5;
/** The light reference photo's ring on the path (6.27), screen pixels: a little larger than the sun, so both show when they meet. */
const PHOTO_PIXELS = 7;
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

/**
 * The least view zoom at which an arc of `radius` round an icon `iconHalf` across (canvas units) has room for its words:
 * below it SunBeyond draws it wordless (its sunrise and sunset ring, a row inside the hours, would be nearer the middle
 * than the icon and a word). Infinity when the arc is inside the icon.
 */
export function wordsFrom(radius: number, iconHalf: number): number {
  const room = radius - iconHalf;
  return room > 0 ? (TICK_PIXELS + GAP_PIXELS + LABEL_PIXELS * 2.6) / room : Number.POSITIVE_INFINITY;
}

/** How far an upright box's middle is from its edge along a unit direction. */
const extentAlong = (dir: { x: number; y: number }, half: { w: number; h: number }) => Math.abs(dir.x) * half.w + Math.abs(dir.y) * half.h;

/**
 * A mono line centred at a point, its width worked out from its letters, with a paper halo. Sized on screen from
 * `anchor` (6.11: screenSized.ts), the point on the circle or by the icon its place is worked out from, so a zoom under
 * way scales it about there.
 */
function MonoText({
  x,
  y,
  text,
  size,
  zoom,
  hideBelow,
  colours,
  bold = false,
  anchor,
}: {
  x: number;
  y: number;
  text: string;
  size: number;
  /** The zoom it is drawn for: given as it is (6.11 review, L3), so at rest its scale is exactly 1. */
  zoom: number;
  /** The view zoom below which, during a zoom, it is hidden (the arc would be wordless there: wordsFrom). */
  hideBelow: number;
  colours: CanvasColours;
  bold?: boolean;
  anchor: { x: number; y: number };
}) {
  const half = halfBox(text, size);
  const wide = 2 * half.w + size;
  return (
    <Text
      ref={screenSizedRef(zoom, { x: x - wide / 2, y: y - half.h }, anchor, hideBelow)}
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
      {...labelHalo(zoom, colours)}
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

/** A word's upright box on the drawing: its middle and half its width and height, canvas units. */
export interface WordBox {
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}

const boxAt = (at: { x: number; y: number }, text: string, size: number): WordBox => ({ ...at, ...halfBox(text, size), text });

/** Whether two upright boxes overlap. */
export const boxesMeet = (a: Pick<WordBox, 'x' | 'y' | 'w' | 'h'>, b: Pick<WordBox, 'x' | 'y' | 'w' | 'h'>): boolean => Math.abs(a.x - b.x) < a.w + b.w && Math.abs(a.y - b.y) < a.h + b.h;

/**
 * The light reference photo's words as drawn (6.27 round 3): wrapped by the sun's own label's rule (sunLabelLines), and
 * at most two lines, its date and time on the first and the place on the second, cut with "…" to fit it (as long as
 * the first line, or the room between the icon and the arc when that is wider).
 */
export function photoLabelLines(label: string, room: number, size: number): string {
  const wrapped = sunLabelLines(label, room, size);
  if (!wrapped.includes('\n')) return wrapped;
  const [first = '', ...rest] = label.split(' · ');
  const place = rest.join(' · ');
  const fits = Math.max(first.length, Math.floor(room / (MONO_ADVANCE * size)));
  return place === '' ? first : `${first}\n${place.length <= fits ? place : `${place.slice(0, Math.max(1, fits - 1))}…`}`;
}

/** The drawing's words and the icon, where SunBeyond puts them: what a test checks for overlaps. */
export interface SunWords {
  /** Too small on screen for words: only the arc, the sun and the photo's ring. */
  wordless: boolean;
  icon: Pick<WordBox, 'x' | 'y' | 'w' | 'h'>;
  /** The sun's label beside its line, and "shadows" beside its own, while the sun is up. */
  sun: WordBox | null;
  shadows: WordBox | null;
  /** The sun's label under the icon, while it is down. */
  down: WordBox | null;
  /** The light reference photo's words, clear of all of the above. */
  photo: WordBox | null;
}

/**
 * Where each word of a drawn sun path goes, round its middle (canvas units, upright). The photo's words (6.27) go first
 * where they belong (a row inside sunrise and sunset's along the mark's direction; under the icon for a photo taken
 * with the sun down) and, when that would sit on the icon, the sun's label or "shadows" (or its down label), further
 * out step by step (past the arc for the mark, below or above the icon for the night words) until they are clear.
 */
export function sunWords(look: Extract<SunLook, { kind: 'drawn' }>, width: number, height: number, zoom: number): SunWords {
  const size = LABEL_PIXELS / zoom;
  const tick = TICK_PIXELS / zoom;
  const gap = GAP_PIXELS / zoom;
  const r = look.radius;
  const iconHalf = Math.hypot(width, height) / 2;
  const below = iconHalf + size;
  const hourRing = r - tick - gap;
  const edgeRing = hourRing - size * 1.6;
  const wordless = edgeRing < iconHalf + size;
  const icon = { x: 0, y: 0, w: iconHalf, h: iconHalf };
  const room = r - iconHalf - 3 * gap;
  const side = sideOf(look.sun);
  const away = { x: -look.sun.x, y: -look.sun.y };
  const label = sunLabelLines(look.label, room, size);
  const up = !wordless && look.sun.up;
  const sun = up ? boxAt(besideLine(look.sun, side, iconHalf + gap, gap, label, size), label, size) : null;
  const shadows = up ? boxAt(besideLine(away, side, iconHalf + gap, gap, look.shadows, size), look.shadows, size) : null;
  const down = !wordless && !look.sun.up ? boxAt({ x: 0, y: below }, look.label, size) : null;
  let photo: WordBox | null = null;
  if (look.photo && !wordless) {
    const text = photoLabelLines(look.photo.label, room, size);
    const half = halfBox(text, size);
    const others = [icon, sun, shadows, down].filter((b): b is NonNullable<typeof b> => b !== null);
    const clear = (at: { x: number; y: number }) => !others.some((other) => boxesMeet({ ...at, ...half }, other));
    const step = size * LINE_HEIGHT;
    const candidates: { x: number; y: number }[] = [];
    if (look.photo.up) {
      const dir = look.photo;
      candidates.push(insideAt(dir, edgeRing - size * 1.6, text, size));
      // Past the arc and its ticks, a row further out each time (within the reach the canvas keeps: WORDS_REACH_PIXELS).
      const out = r + 2 * tick + gap + extentAlong(dir, half);
      for (let k = 0; k <= 12; k += 1) candidates.push({ x: dir.x * (out + k * step), y: dir.y * (out + k * step) });
    } else {
      const start = below + size * 1.6;
      for (let k = 0; k <= 12; k += 1) candidates.push({ x: 0, y: start + k * step }, { x: 0, y: -(start + k * step) });
    }
    const at = candidates.find(clear) ?? candidates[candidates.length - 1] ?? { x: 0, y: 0 };
    photo = { ...at, ...half, text };
  }
  return { wordless, icon, sun, shadows, down, photo };
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
  // And while a zoom out is on its way, the words keep their size on screen as the arc shrinks (screenSized.ts): hidden
  // below the zoom at which the arc would be drawn wordless, so they never pile up before it settles (6.11 review, L1).
  const hideBelow = wordsFrom(r, iconHalf);
  const words = { size, zoom, hideBelow, colours };
  // The light reference photo's words, placed clear of the icon and the sun's own words (sunWords).
  const photoWords = look.photo ? sunWords(look, width, height, zoom).photo : null;
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
          <MonoText {...insideAt(hour, hourRing, hour.label, size)} text={hour.label} {...words} anchor={at(hour, r)} />
        </Group>
      ))}
      {!wordless && [look.rise, look.set].map((edge, i) =>
        edge ? (
          <Group key={i === 0 ? 'rise' : 'set'} listening={false}>
            <Line points={[edge.x * (r - 2 * tick), edge.y * (r - 2 * tick), edge.x * (r + 2 * tick), edge.y * (r + 2 * tick)]} strokeWidth={2} {...ink} />
            <MonoText {...insideAt(edge, edgeRing, edge.label, size)} text={edge.label} {...words} bold anchor={at(edge, r)} />
          </Group>
        ) : null,
      )}
      {wordless ? null : look.sun.up ? (
        <>
          <Line points={[0, 0, sunPoint.x, sunPoint.y]} strokeWidth={1.5} {...ink} />
          <Line points={[0, 0, shadowEnd.x, shadowEnd.y]} strokeWidth={1} dash={[4, 3]} {...ink} />
          <Circle x={sunPoint.x} y={sunPoint.y} radius={SUN_PIXELS / zoom} fill={GOLDEN_HOUR} stroke={colours.ink} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
          {/* Beside the sun's line, by the middle, clear of the icon; "shadows" beside its own line, on the same side. */}
          <MonoText {...besideLine(look.sun, side, iconHalf + gap, gap, label, size)} text={label} {...words} bold anchor={at(look.sun, iconHalf)} />
          <MonoText {...besideLine(away, side, iconHalf + gap, gap, look.shadows, size)} text={look.shadows} {...words} anchor={at(away, iconHalf)} />
        </>
      ) : (
        <MonoText x={0} y={below} text={look.label} {...words} bold anchor={{ x: 0, y: iconHalf }} />
      )}
      {/* The light reference photo's moment (6.27): a ring on the path, hollow where the sun at the item's time is a
          filled disc (the shape is the cue, not a colour; where they meet, the ring goes round the disc), and its time
          and date a row inside sunrise and sunset's. Zoomed out too far for words, the ring alone. A photo taken with
          the sun down has no place on the path: its date and time are said under the icon, below the sun's own line
          when that is there. */}
      {look.photo?.up && (
        <Group listening={false} name="photo-mark">
          <Circle x={look.photo.x * r} y={look.photo.y * r} radius={PHOTO_PIXELS / zoom} stroke={colours.ink} strokeWidth={2} strokeScaleEnabled={false} listening={false} />
          {photoWords && <MonoText x={photoWords.x} y={photoWords.y} text={photoWords.text} {...words} bold anchor={at(look.photo, r)} />}
        </Group>
      )}
      {look.photo && !look.photo.up && photoWords && <MonoText x={photoWords.x} y={photoWords.y} text={photoWords.text} {...words} bold anchor={{ x: 0, y: iconHalf }} />}
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
