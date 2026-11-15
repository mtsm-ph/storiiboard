import { useEffect, type ReactElement } from 'react';
import type { Context } from 'konva/lib/Context';
import { Group, Path, Rect, Shape, Text } from 'react-konva';
import type { CanvasColours } from '../../../ui/canvas/types';
import type { PlanIcon } from '../../../ui/icons/plan/planIcons';
import { ensureFont, useFonts } from '../../moodboards/fonts';
import { ICON_BOXES, ICON_SHAPES, type IconBox, type IconPart, type IconPath, type IconText } from './iconBoxes';

// A library icon drawn on a plan (6.3) exactly as the kit's SVG is, never recoloured, in light and dark (decision 13),
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

function pathNode(part: IconPath, key: string): ReactElement {
  return (
    <Path
      key={key}
      data={part.d}
      {...(part.fill === null ? {} : { fill: paintOf(part.fill, part.fillOpacity) })}
      {...(part.stroke === null ? {} : { stroke: paintOf(part.stroke, part.strokeOpacity) })}
      strokeWidth={part.strokeWidth}
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

const ALIGN = { start: 'left', middle: 'center', end: 'right' } as const;

/** Draws a text at its SVG baseline, anchored as SVG's text-anchor says: one function per text, shared. */
const textScenes = new WeakMap<IconText, (context: Context) => void>();
function sceneOf(part: IconText): (context: Context) => void {
  let scene = textScenes.get(part);
  if (!scene) {
    const font = `${String(part.weight)} ${String(part.size)}px "${part.family}", monospace`;
    const fill = paintOf(part.fill, part.fillOpacity);
    scene = (context: Context) => {
      context.setAttr('font', font);
      context.setAttr('textAlign', ALIGN[part.anchor]);
      context.setAttr('textBaseline', 'alphabetic');
      context.setAttr('fillStyle', fill);
      context.fillText(part.text, part.x, part.y);
    };
    textScenes.set(part, scene);
  }
  return scene;
}

/** A text of an icon, in the bundled face it names; drawn again once that face has loaded (Parking's "P", a cast mark's "A1"). */
function IconTextNode({ part }: { part: IconText }) {
  // Changes when a face finishes loading, so the canvas draws the text again in it.
  const fonts = useFonts((s) => s.version);
  useEffect(() => {
    void ensureFont(part.family, part.weight, false);
  }, [part]);
  return <Shape sceneFunc={sceneOf(part)} fontsVersion={fonts} opacity={part.opacity} perfectDrawEnabled={false} listening={false} />;
}

/** Each icon's React elements, made the first time it is drawn and reused by every item that draws it (each gets its own Konva nodes). */
const NODES = new Map<string, readonly ReactElement[]>();

/** An icon's React elements on its grid, the same array every time; null for an id the table doesn't have. */
export function iconNodes(id: string): readonly ReactElement[] | null {
  const had = NODES.get(id);
  if (had) return had;
  const parts = iconShapesOf(id);
  if (!parts) return null;
  const nodes = parts.map((part, i) => (part.kind === 'path' ? pathNode(part, String(i)) : <IconTextNode key={String(i)} part={part} />));
  NODES.set(id, nodes);
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
export function iconNodesWith(id: string, texts: IconTexts | undefined): readonly ReactElement[] | null {
  const nodes = iconNodes(id);
  const parts = iconShapesOf(id);
  if (!nodes || !parts || texts === undefined) return nodes;
  const single = parts.filter((part) => part.kind === 'text').length === 1;
  return parts.map((part, i) => {
    if (part.kind !== 'text') return nodes[i] as ReactElement;
    const replaced = replacedText(id, i, part, texts, single);
    return replaced === part ? (nodes[i] as ReactElement) : <IconTextNode key={String(i)} part={replaced} />;
  });
}

/** The icon's shapes alone, in the item's box. */
function IconGroup({ icon, width, height, texts }: { icon: PlanIcon; width: number; height: number; texts?: IconTexts | undefined }) {
  const nodes = iconNodesWith(icon.id, texts);
  if (!nodes) return null;
  const fit = iconFit(iconContentBox(icon), width, height);
  return (
    <Group x={fit.x} y={fit.y} scaleX={fit.scaleX} scaleY={fit.scaleY} listening={false}>
      {nodes}
    </Group>
  );
}

/**
 * A known icon at its box's size, as vectors, with its name beneath; one the table doesn't have, the "?" outline.
 * `texts` replaces the icon's own text (IconTexts).
 */
export function IconShape({ icon, width, height, zoom, name, colours, texts }: ShapeProps & { icon: PlanIcon; texts?: IconTexts | undefined }) {
  if (!iconShapesOf(icon.id)) return <UnknownIconShape width={width} height={height} zoom={zoom} name={name} colours={colours} />;
  return (
    <>
      <IconGroup icon={icon} width={width} height={height} texts={texts} />
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
  return (
    <>
      <Rect width={width} height={height} fill={fillOf(icon) ?? colours.raised} stroke={colours.ink} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
      <Text
        text={name}
        x={pad}
        y={pad}
        width={Math.max(0, width - 2 * pad)}
        height={Math.max(0, height - 2 * pad)}
        verticalAlign="middle"
        fontFamily='"Inter Tight"'
        fontSize={Math.max(1, Math.min(height * 0.3, 40))}
        fill={colours.ink}
        ellipsis
        listening={false}
      />
    </>
  );
}
