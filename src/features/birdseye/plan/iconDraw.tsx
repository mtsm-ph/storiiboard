import { useEffect, type ReactElement } from 'react';
import type { Context } from 'konva/lib/Context';
import { Group, Path, Rect, Shape, Text } from 'react-konva';
import { DARK_COLOURS, inkOn, isDark, kitStroke } from '../../../ui/canvas/canvasPalette';
import { INK, PAPER_COLOURS } from '../../../ui/canvas/paperColours';
import type { CanvasColours } from '../../../ui/canvas/types';
import type { PlanIcon } from '../../../ui/icons/plan/planIcons';
import { ensureFont, useFonts } from '../../moodboards/fonts';
import { parsePathData } from '../../export/deckDisplay';
import { ICON_BOXES, ICON_SHAPES, type IconBox, type IconPart, type IconPath, type IconText } from './iconBoxes';
import { outlinedSymbol } from './iconSizes';

// A library icon drawn on a plan (6.3) exactly as the kit's SVG is, never recoloured by the theme (decision 13); only
// the plan's own Dark view (6.5.1) draws the kit's ink LINES light (canvasPalette.ts kitStroke) and keeps every fill,
// its letters in the ink that reads on what they sit on (iconTextInk),
// as vectors (third review round): its shapes are a committed table (iconBoxes.ts, written from the SVGs by
// scripts/planIconBoxes.ts), each a Konva Path in the kit's own hex, inside one Group that maps the box of the icon's ink
// on its 32 px grid to the item's box (stretched, as the item is). Every line is drawn with strokeScaleEnabled off, so
// it keeps the kit's weight in screen pixels at every zoom and size; Konva then lays its dashes out in screen pixels
// too, so a dash reads as the kit's at any zoom, as it does when the icon is drawn at its own 32 px. A text is drawn at
// its SVG baseline in the bundled face it names (JetBrains Mono), scaled with the item, and drawn again once the face has
// loaded. An icon's React elements are made once and reused by every item that draws it (React makes each item its own
// Konva nodes from them): an item only adds its own Group.

const FULL: IconBox = { x: 0, y: 0, width: 32, height: 32 };

/** The box of what an icon draws on its 32 px grid, from the committed table: its geometry, no stroke padding. */
export const iconContentBox = (icon: PlanIcon): IconBox => (Object.hasOwn(ICON_BOXES, icon.id) ? (ICON_BOXES[icon.id] ?? FULL) : FULL);

/** An icon's shapes, the table's own array, shared by every item of that icon; null for an id the table doesn't have. */
export const iconShapesOf = (id: string): readonly IconPart[] | null => (Object.hasOwn(ICON_SHAPES, id) ? (ICON_SHAPES[id] ?? null) : null);

/** A kit hex at an opacity, as the canvas takes it: the hex itself when it is opaque. */
export function paintOf(hex: string, alpha: number): string {
  if (alpha >= 1) return hex;
  const full = hex.length === 4 ? `#${hex.slice(1).replace(/./g, (c) => c + c)}` : hex;
  const v = (at: number) => parseInt(full.slice(at, at + 2), 16);
  return `rgba(${String(v(1))}, ${String(v(3))}, ${String(v(5))}, ${String(alpha)})`;
}

/**
 * How an icon's grid maps into an item's box (canvas units): the box of its ink stretched to the item's. A box with no
 * extent one way (a line) keeps the other way's scale and sits in the middle of the item.
 */
export function iconFit(box: IconBox, width: number, height: number): { x: number; y: number; scaleX: number; scaleY: number } {
  const sx = box.width > 0 ? width / box.width : box.height > 0 ? height / box.height : 1;
  const sy = box.height > 0 ? height / box.height : sx;
  const x = box.width > 0 ? -box.x * sx : width / 2 - box.x * sx;
  const y = box.height > 0 ? -box.y * sy : height / 2 - box.y * sy;
  return { x, y, scaleX: sx, scaleY: sy };
}

/** The margin a symbol keeps inside its outline (6.17), each side, as a share of the outline's shorter side. */
export const SYMBOL_MARGIN = 0.08;

/**
 * How a symbol's grid maps into an item's box (6.17): the box of its ink scaled the same both ways, as large as fits
 * inside the box less SYMBOL_MARGIN each side, centred, never stretched. A long thin box shows a small symbol.
 */
export function symbolFit(box: IconBox, width: number, height: number): { x: number; y: number; scaleX: number; scaleY: number } {
  const margin = Math.min(width, height) * SYMBOL_MARGIN;
  const room = { width: Math.max(0, width - 2 * margin), height: Math.max(0, height - 2 * margin) };
  const scales = [box.width > 0 ? room.width / box.width : Infinity, box.height > 0 ? room.height / box.height : Infinity];
  const finite = scales.filter(Number.isFinite);
  const scale = finite.length > 0 ? Math.min(...finite) : 1;
  return { x: width / 2 - (box.x + box.width / 2) * scale, y: height / 2 - (box.y + box.height / 2) * scale, scaleX: scale, scaleY: scale };
}

/** The width of the light outline the Dark view gives a solid ink fill with no line of its own, kit pixels (its lines' weight). */
export const DARK_OUTLINE = 1.5;

/** A path's box on the icon's grid, from every point its segments name (an arc's cubics' control points bound it). */
const pathBoxes = new WeakMap<IconPath, { x0: number; y0: number; x1: number; y1: number } | null>();
function pathBox(part: IconPath): { x0: number; y0: number; x1: number; y1: number } | null {
  if (pathBoxes.has(part)) return pathBoxes.get(part) ?? null;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const segment of parsePathData(part.d)) {
    const values = 'm' in segment ? segment.m : 'l' in segment ? segment.l : 'c' in segment ? segment.c : [];
    for (let i = 0; i + 1 < values.length; i += 2) {
      xs.push(values[i] ?? 0);
      ys.push(values[i + 1] ?? 0);
    }
  }
  const box = xs.length === 0 ? null : { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  pathBoxes.set(part, box);
  return box;
}

/** How far past a fill's box a line may reach and still be on it, grid pixels (a line drawn along a fill's edge). */
const ON_FILL_SLACK = 0.01;

/**
 * The fill a line of an icon is drawn over (6.5.1 round 4): a shape with no fill of its own whose every point lies in
 * the box of a filled shape drawn before it (the nearest such, by the kit's drawing order); null for a line on no fill
 * (a filled shape's own outline, which edges it against the page, and a stroke-only icon). Drawing order alone took a
 * fresnel's rays, a beam's sides and a stand's legs, drawn after the lamp's or the screen's fill but outside it, for lines
 * on it; the box tells them apart. A box is wider than a round fill, so a line in a disc's corner would count as on it:
 * no kit icon draws one there.
 */
export function fillUnderLine(parts: readonly IconPart[], index: number): string | null {
  const part = parts[index];
  if (part?.kind !== 'path' || part.fill !== null) return null;
  const box = pathBox(part);
  if (!box) return null;
  for (let i = index - 1; i >= 0; i -= 1) {
    const under = parts[i];
    if (under?.kind !== 'path' || under.fill === null) continue;
    const fill = pathBox(under);
    if (fill && box.x0 >= fill.x0 - ON_FILL_SLACK && box.x1 <= fill.x1 + ON_FILL_SLACK && box.y0 >= fill.y0 - ON_FILL_SLACK && box.y1 <= fill.y1 + ON_FILL_SLACK) return under.fill;
  }
  return null;
}

function pathNode(part: IconPath, key: string, colours: CanvasColours, under: string | null = null): ReactElement {
  // Dark (6.5.1 rounds 3 and 4): the kit's ink lines turn light, but a line over one of the icon's own fills (a bounce's
  // centre line on its white face) takes the ink that reads on that fill; every fill stays the kit's (an ink fill is
  // black cloth, a white one a bounce's face). A solid ink fill with no line of its own would vanish into the dark page:
  // it gets a light outline at the kit's line weight, so its shape reads while its fill stays ink.
  const inkFill = part.fill !== null && part.fill.toUpperCase() === INK;
  const outlined = isDark(colours) && part.stroke === null && inkFill;
  const line = part.stroke === null ? null : under !== null && isDark(colours) && part.stroke.toUpperCase() === INK ? inkOn(colours, under) : kitStroke(part.stroke, colours);
  return (
    <Path
      key={key}
      data={part.d}
      {...(part.fill === null ? {} : { fill: paintOf(part.fill, part.fillOpacity) })}
      {...(line === null ? {} : { stroke: paintOf(line, part.strokeOpacity) })}
      {...(outlined ? { stroke: colours.ink } : {})}
      strokeWidth={outlined ? DARK_OUTLINE : part.strokeWidth}
      strokeScaleEnabled={false}
      {...(part.dash === null ? {} : { dash: [...part.dash] })}
      lineCap={part.lineCap}
      lineJoin={part.lineJoin}
      opacity={part.opacity}
      perfectDrawEnabled={false}
      listening={false}
    />
  );
}

/** One shape of an icon as the palette draws it (its tests draw a shape the kit doesn't have yet). */
export const iconPathNode = pathNode;

const ALIGN = { start: 'left', middle: 'center', end: 'right' } as const;

/** Draws a text at its SVG baseline, anchored as SVG's text-anchor says: one function per text and paint, shared. */
const textScenes = new WeakMap<IconText, Map<string, (context: Context) => void>>();
function sceneOf(part: IconText, ink: string | undefined): (context: Context) => void {
  const fill = paintOf(ink ?? part.fill, part.fillOpacity);
  let scenes = textScenes.get(part);
  if (!scenes) {
    scenes = new Map();
    textScenes.set(part, scenes);
  }
  let scene = scenes.get(fill);
  if (!scene) {
    const font = `${String(part.weight)} ${String(part.size)}px "${part.family}", monospace`;
    scene = (context: Context) => {
      context.setAttr('font', font);
      context.setAttr('textAlign', ALIGN[part.anchor]);
      context.setAttr('textBaseline', 'alphabetic');
      context.setAttr('fillStyle', fill);
      context.fillText(part.text, part.x, part.y);
    };
    scenes.set(fill, scene);
  }
  return scene;
}

/**
 * A text of an icon, in the bundled face it names; drawn again once that face has loaded (Parking's "P", a cast mark's "A1").
 * `ink`, the Dark view's ink for it (iconTextInk); left out, the kit's own fill.
 */
function IconTextNode({ part, ink }: { part: IconText; ink?: string }) {
  // Changes when a face finishes loading, so the canvas draws the text again in it.
  const fonts = useFonts((s) => s.version);
  useEffect(() => {
    void ensureFont(part.family, part.weight, false);
  }, [part]);
  // `sbText` carries the part itself, so a PDF export can set it as real text in its face (6.10), not as the pixels fillText makes.
  return <Shape sceneFunc={sceneOf(part, ink)} sbText={part} fontsVersion={fonts} opacity={part.opacity} perfectDrawEnabled={false} listening={false} />;
}

/**
 * The fill a text of an icon sits on: the last filled shape drawn before it in the kit's own order (a cast mark's pink
 * disc under its "A1"); null for none (Parking's "P" in an outline). The kit draws a letter after the shape it is set on,
 * so its drawing order stands in for geometry, which a path's arcs make costly to work out.
 */
export function fillUnderText(parts: readonly IconPart[], index: number): string | null {
  for (let i = index - 1; i >= 0; i -= 1) {
    const part = parts[i];
    if (part?.kind === 'path' && part.fill !== null) return part.fill;
  }
  return null;
}

/**
 * The ink a text of an icon is set in for a palette (6.5.1 round 3): on paper, and in every print, none (the kit's own
 * fill). In Dark, a text in the kit's ink takes `inkOn` against the fill it sits on (ink on the cast pink, light on no
 * fill); a text in a colour of the kit's own keeps it.
 */
export function iconTextInk(parts: readonly IconPart[], index: number, part: IconText, colours: CanvasColours): string | undefined {
  if (!isDark(colours) || part.fill.toUpperCase() !== INK) return undefined;
  return inkOn(colours, fillUnderText(parts, index));
}

/**
 * Each icon's React elements, made the first time it is drawn and reused by every item that draws it (each gets its own
 * Konva nodes): one set in the kit's own hexes (paper, and every print), one for the Dark view (6.5.1): its ink lines
 * light, its fills the kit's, its letters in the ink that reads on what they sit on.
 */
const NODES = new Map<string, readonly ReactElement[]>();
const DARK_NODES = new Map<string, readonly ReactElement[]>();

/** An icon's React elements on its grid for a palette, the same array every time; null for an id the table doesn't have. */
export function iconNodes(id: string, colours: CanvasColours = PAPER_COLOURS): readonly ReactElement[] | null {
  const dark = isDark(colours);
  const cache = dark ? DARK_NODES : NODES;
  const had = cache.get(id);
  if (had) return had;
  const parts = iconShapesOf(id);
  if (!parts) return null;
  const paint = dark ? DARK_COLOURS : PAPER_COLOURS;
  const nodes = parts.map((part, i) => {
    if (part.kind === 'path') return pathNode(part, String(i), paint, dark ? fillUnderLine(parts, i) : null);
    const ink = iconTextInk(parts, i, part, paint);
    return <IconTextNode key={String(i)} part={part} {...(ink === undefined ? {} : { ink })} />;
  });
  cache.set(id, nodes);
  return nodes;
}

/** The name drawn under an item, in the UI face, once the item is at least this many screen pixels across. */
const NAME_FROM_PIXELS = 24;
const NAME_PIXELS = 11;

/** An item's name under its box, at a fixed screen size, while the plan is close enough to read it. */
export function NameBelow({ name, width, height, zoom, colours }: { name: string; width: number; height: number; zoom: number; colours: CanvasColours }) {
  if (name === '' || width * zoom < NAME_FROM_PIXELS) return null;
  const size = NAME_PIXELS / zoom;
  const span = Math.max(width, 160 / zoom);
  return <Text text={name} x={(width - span) / 2} y={height + 3 / zoom} width={span} align="center" fontFamily='"Inter Tight"' fontSize={size} fill={colours.ink} wrap="none" ellipsis listening={false} />;
}

interface ShapeProps {
  width: number;
  height: number;
  zoom: number;
  name: string;
  colours: CanvasColours;
}

/**
 * Text drawn in place of an icon's own (6.7: a character's mark says "B1", not the kit's "A1"): a map from the icon's
 * text to what to draw, or one replacement for an icon with a single text. The Library's thumbnails pass none.
 */
export type IconTexts = string | Readonly<Record<string, string>>;

/** A replaced text part, made once per icon, part and text, so its scene function is shared as the kit's are. */
const REPLACED = new Map<string, IconText>();

/** What a text part says with `texts` applied: the part itself when nothing replaces it. */
export function replacedText(id: string, index: number, part: IconText, texts: IconTexts, single: boolean): IconText {
  const text = typeof texts === 'string' ? (single ? texts : null) : Object.hasOwn(texts, part.text) ? (texts[part.text] ?? null) : null;
  if (text === null || text === part.text) return part;
  const key = `${id}\u0000${String(index)}\u0000${text}`;
  let made = REPLACED.get(key);
  if (!made) {
    // A longer text is set smaller, so it stays inside the drawing the kit's fitted (a mono face: width is length).
    const longer = Math.max(1, Array.from(text).length) / Math.max(1, Array.from(part.text).length);
    made = { ...part, text, size: longer > 1 ? part.size / longer : part.size };
    REPLACED.set(key, made);
  }
  return made;
}

/** An icon's React elements with `texts` applied; the shared ones when there is nothing to replace. */
export function iconNodesWith(id: string, texts: IconTexts | undefined, colours: CanvasColours = PAPER_COLOURS): readonly ReactElement[] | null {
  const nodes = iconNodes(id, colours);
  const parts = iconShapesOf(id);
  if (!nodes || !parts || texts === undefined) return nodes;
  const single = parts.filter((part) => part.kind === 'text').length === 1;
  return parts.map((part, i) => {
    if (part.kind !== 'text') return nodes[i] as ReactElement;
    const replaced = replacedText(id, i, part, texts, single);
    if (replaced === part) return nodes[i] as ReactElement;
    const ink = iconTextInk(parts, i, replaced, colours);
    return <IconTextNode key={String(i)} part={replaced} {...(ink === undefined ? {} : { ink })} />;
  });
}

/** The icon's shapes alone, in the item's box: stretched to it, or for a symbol (6.17) at its own proportions in its middle. */
function IconGroup({ icon, width, height, colours, texts, symbol = false }: { icon: PlanIcon; width: number; height: number; colours: CanvasColours; texts?: IconTexts | undefined; symbol?: boolean }) {
  const nodes = iconNodesWith(icon.id, texts, colours);
  if (!nodes) return null;
  const fit = (symbol ? symbolFit : iconFit)(iconContentBox(icon), width, height);
  return (
    <Group x={fit.x} y={fit.y} scaleX={fit.scaleX} scaleY={fit.scaleY} listening={false}>
      {nodes}
    </Group>
  );
}

/**
 * A known icon at its box's size, as vectors, with its name beneath; one the table doesn't have, the "?" outline.
 * `texts` replaces the icon's own text (IconTexts). `footprint` (an icon item, 6.17: its box is the thing's real width
 * and depth) draws a symbol footprint (iconSizes.ts `outlinedSymbol`: a `symbol` sized by width and depth, never one
 * sized by its side) as an ink outline at the box with the symbol at its own proportions in the middle; any other icon,
 * and every icon drawn without it (a camera, a light, a mark), stretched to the box as before. Either turns with the
 * item: it is drawn in the item's own box, which the canvas turns.
 */
export function IconShape({ icon, width, height, zoom, name, colours, texts, footprint = false }: ShapeProps & { icon: PlanIcon; texts?: IconTexts | undefined; footprint?: boolean }) {
  if (!iconShapesOf(icon.id)) return <UnknownIconShape width={width} height={height} zoom={zoom} name={name} colours={colours} />;
  const symbol = footprint && outlinedSymbol(icon.id);
  return (
    <>
      <IconGroup icon={icon} width={width} height={height} colours={colours} texts={texts} symbol={symbol} />
      {/* The true footprint, in the kit's 1.5 px ink line (printed at the kit's line weight), under nothing it hides. */}
      {symbol && <Rect width={width} height={height} stroke={colours.ink} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />}
      <NameBelow name={name} width={width} height={height} zoom={zoom} colours={colours} />
    </>
  );
}

/** An icon id this version doesn't have: a plain ink outline with a "?", its record left as it is. */
export function UnknownIconShape({ width, height, zoom, name, colours }: ShapeProps) {
  const size = Math.min(width, height) * 0.6;
  return (
    <>
      <Rect width={width} height={height} stroke={colours.ink} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
      <Text text="?" width={width} height={height} align="center" verticalAlign="middle" fontFamily='"Inter Tight"' fontStyle="bold" fontSize={size} fill={colours.ink} listening={false} />
      <NameBelow name={name} width={width} height={height} zoom={zoom} colours={colours} />
    </>
  );
}

/** A zone (6.3): a named outline that resizes freely, the kit's dashed outline stretched to it, its name inside its top left corner. */
export function ZoneShape({ icon, width, height, zoom, name, colours }: ShapeProps & { icon: PlanIcon }) {
  const pad = 4 / zoom;
  return (
    <>
      <IconShape icon={icon} width={width} height={height} zoom={zoom} name="" colours={colours} />
      {name !== '' && <Text text={name} x={pad} y={pad} width={Math.max(0, width - 2 * pad)} fontFamily='"Inter Tight"' fontStyle="bold" fontSize={NAME_PIXELS / zoom} fill={colours.ink} wrap="none" ellipsis listening={false} />}
    </>
  );
}

/** The kit's fill for an icon (the note's oatmeal), read from its shapes so no colour is written here. */
const fillOf = (icon: PlanIcon): string | null => {
  for (const part of iconShapesOf(icon.id) ?? []) if (part.kind === 'path' && part.fill !== null) return part.fill;
  return null;
};

/**
 * A note (6.3): its name as text on the note, sized with the note as a label on a printed plan is, the kit's fill and
 * an ink outline. A note with no name yet draws the kit's icon.
 */
export function NoteShape({ icon, width, height, zoom, name, colours }: ShapeProps & { icon: PlanIcon }) {
  if (name === '') return <IconShape icon={icon} width={width} height={height} zoom={zoom} name="" colours={colours} />;
  const pad = Math.min(width, height) * 0.12;
  // The kit's fill stays the kit's in the Dark view (6.5.1 round 3); its outline is a line (light in Dark), and its words
  // take the ink that reads on that fill.
  const fill = fillOf(icon) ?? colours.raised;
  return (
    <>
      <Rect width={width} height={height} fill={fill} stroke={colours.ink} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
      <Text
        text={name}
        x={pad}
        y={pad}
        width={Math.max(0, width - 2 * pad)}
        height={Math.max(0, height - 2 * pad)}
        verticalAlign="middle"
        fontFamily='"Inter Tight"'
        fontSize={Math.max(1, Math.min(height * 0.3, 40))}
        fill={inkOn(colours, fill)}
        ellipsis
        listening={false}
      />
    </>
  );
}
