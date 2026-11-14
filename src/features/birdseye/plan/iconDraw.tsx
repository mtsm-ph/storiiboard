import { useEffect, useState } from 'react';
import { Image as KonvaImage, Rect, Text } from 'react-konva';
import type { CanvasColours } from '../../../ui/canvas/types';
import type { PlanIcon } from '../../../ui/icons/plan/planIcons';

// A library icon drawn on a plan (6.3) exactly as the kit's SVG is, never recoloured, in light and dark (decision 13).
// Its box is the item's real size, so the SVG is cut to what it draws (the kit leaves air round each icon on its
// 32 px grid) and stretched to the box. Each icon is decoded once and shared by every item that shows it; it is
// rasterised again, from the SVG, when the zoom the canvas draws for settles (5.7), so it is crisp at any zoom.

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const FULL: Box = { x: 0, y: 0, width: 32, height: 32 };
/** Half the kit's widest stroke (3 px), so a cut never clips a line's edge. */
const STROKE_AIR = 1.5;

const boxes = new Map<string, Box>();

/**
 * What an icon draws on its 32 px grid, its strokes included: found once by the browser (getBBox, which counts each
 * shape's own transform). Where there is no layout (a test), the whole grid.
 */
export function iconContentBox(icon: PlanIcon): Box {
  const known = boxes.get(icon.id);
  if (known) return known;
  let box = FULL;
  if (typeof document !== 'undefined' && typeof DOMParser !== 'undefined') {
    const parsed = new DOMParser().parseFromString(icon.svg, 'image/svg+xml').documentElement;
    const holder = document.createElement('div');
    holder.setAttribute('aria-hidden', 'true');
    holder.style.cssText = 'position:absolute;left:-9999px;top:0;width:32px;height:32px;visibility:hidden;pointer-events:none';
    const svg = document.importNode(parsed, true);
    holder.appendChild(svg);
    document.body.appendChild(holder);
    try {
      if (svg instanceof SVGGraphicsElement) {
        const b = svg.getBBox();
        if (b.width > 0 && b.height > 0) {
          const x = Math.max(0, b.x - STROKE_AIR);
          const y = Math.max(0, b.y - STROKE_AIR);
          box = { x, y, width: Math.min(32, b.x + b.width + STROKE_AIR) - x, height: Math.min(32, b.y + b.height + STROKE_AIR) - y };
        }
      }
    } catch {
      // A browser that can't measure it draws the whole grid.
    } finally {
      holder.remove();
    }
  }
  boxes.set(icon.id, box);
  return box;
}

/** The icon's SVG cut to what it draws: its view box and size set to that box, every shape and colour as the kit has it. */
export function croppedIconSvg(icon: PlanIcon): string {
  const box = iconContentBox(icon);
  const view = `${String(box.x)} ${String(box.y)} ${String(box.width)} ${String(box.height)}`;
  return icon.svg.replace(/<svg\b([^>]*)>/, (_whole, attrs: string) => {
    const kept = attrs.replace(/\s(width|height|viewBox)="[^"]*"/g, '');
    return `<svg${kept} width="${String(box.width)}" height="${String(box.height)}" viewBox="${view}" preserveAspectRatio="none">`;
  });
}

/** The cut SVG as an image address, for the Library's drag ghost and the canvas. */
export const croppedIconUrl = (icon: PlanIcon): string => `data:image/svg+xml;utf8,${encodeURIComponent(croppedIconSvg(icon))}`;

const decoded = new Map<string, Promise<HTMLImageElement | null>>();
const ready = new Map<string, HTMLImageElement | null>();

/** The icon decoded once, shared: null when the browser couldn't read it. */
function decodeIcon(icon: PlanIcon): Promise<HTMLImageElement | null> {
  const have = decoded.get(icon.id);
  if (have) return have;
  const made = new Promise<HTMLImageElement | null>((resolve) => {
    if (typeof Image === 'undefined') {
      resolve(null);
      return;
    }
    const image = new Image();
    image.onload = () => {
      resolve(image);
    };
    image.onerror = () => {
      resolve(null);
    };
    image.src = croppedIconUrl(icon);
  }).then((image) => {
    ready.set(icon.id, image);
    return image;
  });
  decoded.set(icon.id, made);
  return made;
}

/** Rasters kept, newest last; the oldest go past this many. */
const RASTER_LIMIT = 256;
const rasters = new Map<string, HTMLCanvasElement>();

/** A size in device pixels, rounded up to a power of two, so a zoom settling nearby reuses what's drawn. */
const bucket = (px: number): number => 2 ** Math.ceil(Math.log2(Math.min(2048, Math.max(8, px))));

/** The icon rasterised from its SVG for a box this many device pixels across and deep, shared by size. */
function rasterFor(icon: PlanIcon, image: HTMLImageElement, pxWidth: number, pxHeight: number): HTMLCanvasElement | HTMLImageElement {
  if (typeof document === 'undefined') return image;
  const w = bucket(pxWidth);
  const h = bucket(pxHeight);
  const key = `${icon.id}:${String(w)}x${String(h)}`;
  const have = rasters.get(key);
  if (have) {
    rasters.delete(key);
    rasters.set(key, have);
    return have;
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext('2d');
  if (!context) return image;
  context.drawImage(image, 0, 0, w, h);
  rasters.set(key, canvas);
  if (rasters.size > RASTER_LIMIT) {
    const oldest = rasters.keys().next().value;
    if (oldest !== undefined) rasters.delete(oldest);
  }
  return canvas;
}

/** The decoded icon: null while it decodes or when it couldn't be. */
function useIconImage(icon: PlanIcon): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(() => ready.get(icon.id) ?? null);
  useEffect(() => {
    let live = true;
    void decodeIcon(icon).then((done) => {
      if (live) setImage(done);
    });
    return () => {
      live = false;
    };
  }, [icon]);
  return image;
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

/** A known icon at its box's size, from its SVG, with its name beneath. */
export function IconShape({ icon, width, height, zoom, name, colours }: { icon: PlanIcon; width: number; height: number; zoom: number; name: string; colours: CanvasColours }) {
  const image = useIconImage(icon);
  const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio;
  return (
    <>
      {image && <KonvaImage image={rasterFor(icon, image, width * zoom * ratio, height * zoom * ratio)} width={width} height={height} listening={false} />}
      <NameBelow name={name} width={width} height={height} zoom={zoom} colours={colours} />
    </>
  );
}

/** An icon id this version doesn't have: a plain ink outline with a "?", its record left as it is. */
export function UnknownIconShape({ width, height, zoom, name, colours }: { width: number; height: number; zoom: number; name: string; colours: CanvasColours }) {
  const size = Math.min(width, height) * 0.6;
  return (
    <>
      <Rect width={width} height={height} stroke={colours.ink} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
      <Text text="?" width={width} height={height} align="center" verticalAlign="middle" fontFamily='"Inter Tight"' fontStyle="bold" fontSize={size} fill={colours.ink} listening={false} />
      <NameBelow name={name} width={width} height={height} zoom={zoom} colours={colours} />
    </>
  );
}

/** A zone (6.3): a named outline that resizes freely, dashed as the kit's is, its name inside its top left corner. */
export function ZoneShape({ width, height, zoom, name, colours }: { width: number; height: number; zoom: number; name: string; colours: CanvasColours }) {
  const pad = 4 / zoom;
  return (
    <>
      <Rect width={width} height={height} stroke={colours.ink} strokeWidth={1.5} strokeScaleEnabled={false} dash={[6 / zoom, 4 / zoom]} listening={false} />
      {name !== '' && <Text text={name} x={pad} y={pad} width={Math.max(0, width - 2 * pad)} fontFamily='"Inter Tight"' fontStyle="bold" fontSize={NAME_PIXELS / zoom} fill={colours.ink} wrap="none" ellipsis listening={false} />}
    </>
  );
}

/** The kit's fill for an icon (the note's oatmeal), read from its SVG so no colour is written here. */
const fillOf = (icon: PlanIcon): string | null => /\sfill="(#[0-9A-Fa-f]{6})"/.exec(icon.svg.replace(/^<svg\b[^>]*>/, ''))?.[1] ?? null;

/**
 * A note (6.3): its name as text on the note, sized with the note as a label on a printed plan is, the kit's fill and
 * an ink outline. A note with no name yet draws the kit's icon.
 */
export function NoteShape({ icon, width, height, zoom, name, colours }: { icon: PlanIcon; width: number; height: number; zoom: number; name: string; colours: CanvasColours }) {
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
