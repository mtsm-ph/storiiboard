import { useEffect, useReducer } from 'react';
import { Image as KonvaImage, Rect, Text } from 'react-konva';
import type { CanvasColours } from '../../../ui/canvas/types';
import type { PlanIcon } from '../../../ui/icons/plan/planIcons';
import { ICON_BOXES, type IconBox } from './iconBoxes';

// A library icon drawn on a plan (6.3) exactly as the kit's SVG is, never recoloured, in light and dark (decision 13).
// Its box is the item's real size, so the SVG is cut to what it draws (the kit leaves air round each icon on its 32 px
// grid; the boxes are a committed table, iconBoxes.ts, the same in every engine) and stretched to the box.
//
// Lines stay at the kit's weight on screen however large the item is (6.3 review: a 6 m basecamp's outline was 30 cm
// wide): the SVG that is rasterised marks every shape `vector-effect="non-scaling-stroke"`, so its stroke widths and
// dashes count in the raster's pixels, not the icon's grid. Chromium and WebKit both hold that in an SVG drawn from an
// <img> (WebKit by the SVG's own width and height, so each raster's SVG is written at the raster's size and drawn 1:1).
// A raster is made for the size the item has on screen (device pixels), in powers of two, at most 1024 px on its long
// side and never past the window; its strokes are scaled for the shrink from the raster to the screen, to the nearest
// half octave, so on screen a line is within a fifth of the kit's weight at any zoom. Rasters are made off the render
// path, a few at a time when the page is idle; meanwhile the item draws the last one it had, scaled. They share a
// 64-megapixel cache, least recently used out first; sizes no item wants at the zoom drawn are let go once it settles.

const FULL: IconBox = { x: 0, y: 0, width: 32, height: 32 };

/** What an icon draws on its 32 px grid, its strokes' edges included, from the committed table. */
export const iconContentBox = (icon: PlanIcon): IconBox => (Object.hasOwn(ICON_BOXES, icon.id) ? (ICON_BOXES[icon.id] ?? FULL) : FULL);

/** A raster an icon is drawn into: its size in pixels, and how much its strokes are scaled (1 = the kit's weight in raster pixels). */
export interface RasterSpec {
  width: number;
  height: number;
  strokeScale: number;
}

const SHAPE = /<(rect|circle|ellipse|line|polyline|polygon|path)\b/g;
const fmt = (v: number): string => String(Math.round(v * 10000) / 10000);
const scaleList = (value: string, by: number): string =>
  value
    .trim()
    .split(/[\s,]+/)
    .map((part) => (Number.isFinite(Number(part)) ? fmt(Number(part) * by) : part))
    .join(' ');

/**
 * The icon's SVG cut to what it draws: its view box set to that box and stretched to its size, every shape and colour as
 * the kit has it. For a raster, its size is the raster's and every shape's lines are counted in its pixels
 * (non-scaling), their widths and dashes scaled by the raster's `strokeScale`.
 */
export function croppedIconSvg(icon: PlanIcon, raster?: RasterSpec): string {
  const box = iconContentBox(icon);
  const view = `${String(box.x)} ${String(box.y)} ${String(box.width)} ${String(box.height)}`;
  const width = raster ? raster.width : box.width;
  const height = raster ? raster.height : box.height;
  let svg = icon.svg.replace(/<svg\b([^>]*)>/, (_whole, attrs: string) => {
    let kept = attrs.replace(/\s(width|height|viewBox|preserveAspectRatio)="[^"]*"/g, '');
    // A kit SVG always sets its stroke width; one that doesn't has SVG's default of 1, which is scaled as any other.
    if (raster && raster.strokeScale !== 1 && !/\sstroke-width="/.test(kept)) kept += ' stroke-width="1"';
    return `<svg${kept} width="${String(width)}" height="${String(height)}" viewBox="${view}" preserveAspectRatio="none">`;
  });
  if (!raster) return svg;
  svg = svg.replace(SHAPE, '<$1 vector-effect="non-scaling-stroke"');
  if (raster.strokeScale !== 1) {
    svg = svg.replace(/\s(stroke-width|stroke-dasharray)="([^"]*)"/g, (_whole, name: string, value: string) => ` ${name}="${scaleList(value, raster.strokeScale)}"`);
  }
  return svg;
}

/** An SVG as an image address. */
const svgUrl = (svg: string): string => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

/** The cut SVG as an image address, for the Library's buttons; with a raster's size, for the drag ghost. */
export const croppedIconUrl = (icon: PlanIcon, raster?: RasterSpec): string => svgUrl(croppedIconSvg(icon, raster));

/** The long side a raster never goes past, pixels. */
export const RASTER_MAX = 1024;
/** The smallest raster side, pixels. */
const RASTER_MIN = 8;

/** A size rounded up to a power of two, so a zoom settling nearby reuses what's drawn. */
const bucket = (px: number): number => 2 ** Math.ceil(Math.log2(Math.max(RASTER_MIN, px)));

/**
 * The raster for an item this many device pixels across and deep on screen (`ratio`: device pixels to a CSS pixel;
 * `visible`: the window's longest side, device pixels): powers of two, at most RASTER_MAX and the window on its long side;
 * its strokes scaled so that, shrunk or stretched onto the screen, a line is the kit's weight in CSS pixels, to the
 * nearest half octave (so at most three rasters a size).
 */
export function rasterSpec(pxWidth: number, pxHeight: number, ratio: number, visible: number): RasterSpec {
  let width = bucket(pxWidth);
  let height = bucket(pxHeight);
  const cap = Math.min(RASTER_MAX, bucket(visible));
  const long = Math.max(width, height);
  if (long > cap) {
    width = Math.max(1, (width * cap) / long);
    height = Math.max(1, (height * cap) / long);
  }
  // The raster's pixels to the screen's, both ways at once: a line in the raster is this much wider than on screen.
  const shrink = Math.sqrt((width / Math.max(1, pxWidth)) * (height / Math.max(1, pxHeight)));
  const strokeScale = Math.round(ratio * 2 ** (Math.round(2 * Math.log2(shrink)) / 2) * 10000) / 10000;
  return { width, height, strokeScale };
}

export const rasterKey = (id: string, spec: RasterSpec): string => `${id}|${String(spec.width)}x${String(spec.height)}|${String(spec.strokeScale)}`;

/** The cache's pixel budget: 64 megapixels, about 256 MB of rasters. */
export const RASTER_PIXELS = 64 * 1024 * 1024;

/** Rasters by key, bounded by their pixels, least recently used out first. */
export function createRasterCache<T>(maxPixels: number) {
  const entries = new Map<string, { value: T; pixels: number }>();
  let total = 0;
  const drop = (key: string) => {
    const had = entries.get(key);
    if (!had) return;
    entries.delete(key);
    total -= had.pixels;
  };
  return {
    get(key: string): T | undefined {
      const had = entries.get(key);
      if (!had) return undefined;
      // Most recently used last.
      entries.delete(key);
      entries.set(key, had);
      return had.value;
    },
    has: (key: string): boolean => entries.has(key),
    put(key: string, value: T, pixels: number): void {
      drop(key);
      entries.set(key, { value, pixels });
      total += pixels;
      for (const oldest of entries.keys()) {
        if (total <= maxPixels || oldest === key) break;
        drop(oldest);
      }
    },
    drop,
    keys: (): string[] => [...entries.keys()],
    pixels: (): number => total,
  };
}

/** What makes rasters: a raster from an SVG at its size, and a way to run work when the page is idle. */
export interface RasterDeps<T> {
  make: (svg: string, width: number, height: number) => Promise<T>;
  schedule: (run: () => void) => void;
}

/** How many rasters are started each time the page is idle, and at most underway at once. */
const PER_IDLE = 3;
const AT_ONCE = 4;

/** The rasters every item shares: asked for by size, made in the background, kept in one bounded cache. */
export function createIconRasters<T>(deps: RasterDeps<T>, maxPixels = RASTER_PIXELS) {
  const cache = createRasterCache<T>(maxPixels);
  const queue = new Map<string, { icon: PlanIcon; spec: RasterSpec }>();
  const wantedAt = new Map<string, number>();
  const held = new Map<string, number>();
  const failed = new Set<string>();
  const listeners = new Map<string, Set<() => void>>();
  // The newest raster of each icon, for an item to draw while its own size is made.
  const latest = new Map<string, string>();
  let underway = 0;
  let pumping = false;
  let zoomNow: number | null = null;

  const notify = (id: string) => {
    for (const fn of listeners.get(id) ?? []) fn();
  };
  const isHeld = (key: string) => (held.get(key) ?? 0) > 0;
  const pump = () => {
    if (pumping || queue.size === 0 || underway >= AT_ONCE) return;
    pumping = true;
    deps.schedule(() => {
      pumping = false;
      let started = 0;
      for (const [key, job] of queue) {
        if (started >= PER_IDLE || underway >= AT_ONCE) break;
        queue.delete(key);
        if (cache.has(key) || failed.has(job.icon.id)) continue;
        started += 1;
        underway += 1;
        const { icon, spec } = job;
        deps
          .make(croppedIconSvg(icon, spec), spec.width, spec.height)
          .then((value) => {
            cache.put(key, value, spec.width * spec.height);
            latest.set(icon.id, key);
          })
          .catch(() => {
            // An SVG the engine can't read is drawn as the "?" outline from now on, never as nothing.
            failed.add(icon.id);
          })
          .finally(() => {
            underway -= 1;
            notify(icon.id);
            pump();
          });
      }
      pump();
    });
  };
  /** Sizes no item wants at the zoom drawn now, and that none is drawing, let go. */
  const prune = () => {
    for (const key of cache.keys()) if (wantedAt.get(key) !== zoomNow && !isHeld(key)) cache.drop(key);
    for (const [key, zoom] of wantedAt) if (zoom !== zoomNow && !cache.has(key) && !queue.has(key)) wantedAt.delete(key);
  };

  return {
    /** An item wants this raster at this zoom; made in the background unless it's out of view, made or can't be. */
    want(icon: PlanIcon, spec: RasterSpec, zoom: number, inView: boolean): void {
      const key = rasterKey(icon.id, spec);
      wantedAt.set(key, zoom);
      if (zoom !== zoomNow) {
        zoomNow = zoom;
        // Once every item has asked for its size at the new zoom.
        deps.schedule(prune);
      }
      if (!inView || cache.has(key) || failed.has(icon.id) || queue.has(key)) return;
      queue.set(key, { icon, spec });
      pump();
    },
    /** The raster to draw: this one when made, else the icon's newest, else none yet. */
    best(id: string, key: string): { key: string; value: T } | null {
      const own = cache.get(key);
      if (own !== undefined) return { key, value: own };
      const other = latest.get(id);
      const value = other === undefined ? undefined : cache.get(other);
      return other !== undefined && value !== undefined ? { key: other, value } : null;
    },
    failed: (id: string): boolean => failed.has(id),
    /** While an item draws a raster, it is kept through a settle; let go, it goes when no one wants it at this zoom. */
    hold(key: string): () => void {
      held.set(key, (held.get(key) ?? 0) + 1);
      return () => {
        const left = (held.get(key) ?? 1) - 1;
        if (left > 0) held.set(key, left);
        else {
          held.delete(key);
          if (wantedAt.get(key) !== zoomNow) cache.drop(key);
        }
      };
    },
    subscribe(id: string, fn: () => void): () => void {
      const set = listeners.get(id) ?? new Set();
      set.add(fn);
      listeners.set(id, set);
      return () => {
        set.delete(fn);
      };
    },
    pixels: (): number => cache.pixels(),
    keys: (): string[] => cache.keys(),
  };
}

/** A raster made in the page: the SVG decoded from an <img> at the raster's own size, drawn 1:1 into a canvas. */
async function makeInPage(svg: string, width: number, height: number): Promise<HTMLCanvasElement> {
  if (typeof Image === 'undefined' || typeof document === 'undefined') throw new Error('no page');
  const image = new Image(width, height);
  await new Promise<void>((resolve, reject) => {
    image.onload = () => {
      resolve();
    };
    image.onerror = () => {
      reject(new Error('icon not decoded'));
    };
    image.src = svgUrl(svg);
  });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2d context');
  context.drawImage(image, 0, 0, width, height);
  return canvas;
}

const whenIdle = (run: () => void): void => {
  // WebKit has no requestIdleCallback.
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 120 });
  else setTimeout(run, 16);
};

const rasters = createIconRasters<HTMLCanvasElement>({ make: makeInPage, schedule: whenIdle });

/** The window's longest side, device pixels: no raster is larger than what can be seen. */
const visibleSide = (ratio: number): number => (typeof window === 'undefined' ? RASTER_MAX : Math.max(window.innerWidth, window.innerHeight) * ratio);

/** The raster an item draws now, and whether its icon couldn't be decoded. */
function useIconRaster(icon: PlanIcon, width: number, height: number, zoom: number, inView: boolean): { image: HTMLCanvasElement | null; failed: boolean } {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const spec = rasterSpec(width * zoom * ratio, height * zoom * ratio, ratio, visibleSide(ratio));
  const key = rasterKey(icon.id, spec);
  const { width: rasterWidth, height: rasterHeight, strokeScale } = spec;
  useEffect(() => rasters.subscribe(icon.id, redraw), [icon.id]);
  // Asked for after the render, never made in it.
  useEffect(() => {
    rasters.want(icon, { width: rasterWidth, height: rasterHeight, strokeScale }, zoom, inView);
  }, [icon, rasterWidth, rasterHeight, strokeScale, zoom, inView]);
  const best = rasters.best(icon.id, key);
  const shownKey = best?.key ?? null;
  useEffect(() => (shownKey === null ? undefined : rasters.hold(shownKey)), [shownKey]);
  return { image: best?.value ?? null, failed: rasters.failed(icon.id) };
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
  /** Whether the item meets the view: one out of it asks for no new raster. */
  inView?: boolean;
}

/** A known icon at its box's size, from its SVG, with its name beneath; one the engine couldn't decode, the "?" outline. */
export function IconShape({ icon, width, height, zoom, name, colours, inView = true }: ShapeProps & { icon: PlanIcon }) {
  const { image, failed } = useIconRaster(icon, width, height, zoom, inView);
  if (failed) return <UnknownIconShape width={width} height={height} zoom={zoom} name={name} colours={colours} />;
  return (
    <>
      {image && <KonvaImage image={image} width={width} height={height} listening={false} />}
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

/** A zone (6.3): a named outline that resizes freely, dashed as the kit's is, its name inside its top left corner. */
export function ZoneShape({ width, height, zoom, name, colours }: ShapeProps) {
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
export function NoteShape({ icon, width, height, zoom, name, colours, inView = true }: ShapeProps & { icon: PlanIcon }) {
  if (name === '') return <IconShape icon={icon} width={width} height={height} zoom={zoom} name="" colours={colours} inView={inView} />;
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
