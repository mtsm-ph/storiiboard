import type { JsonValue, Props } from '../model/record';

// How a picture sits in its frame (1.11). The frame always has the project's aspect ratio, and the picture fills it:
// at zoom 1 it just covers the frame, cropped on the long side. `x` and `y` name the point of the picture (0 to 1
// across and down) at the frame's centre. The stored crop is the person's choice; drawing clamps it, so the picture
// never leaves a gap, whatever the frame's shape later becomes.

export interface Crop {
  x: number;
  y: number;
  /** 1 covers the frame; 2 shows half as much of the picture. */
  zoom: number;
}

export const DEFAULT_CROP: Crop = { x: 0.5, y: 0.5, zoom: 1 };
export const MAX_ZOOM = 4;

const finite = (value: JsonValue | undefined, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/** A shot's `crop` prop, or the centred default for a missing or unreadable one. */
export function readCrop(props: Props): Crop {
  const crop = props.crop;
  if (typeof crop !== 'object' || crop === null || Array.isArray(crop)) return DEFAULT_CROP;
  return {
    x: clamp(finite(crop.x, 0.5), 0, 1),
    y: clamp(finite(crop.y, 0.5), 0, 1),
    zoom: clamp(finite(crop.zoom, 1), 1, MAX_ZOOM),
  };
}

/** The picture's size in the frame, as fractions of the frame's width and height. */
function scaled(zoom: number, imageAspect: number, frameAspect: number) {
  // Wider than the frame: its height fills the frame. Narrower: its width does.
  return imageAspect > frameAspect
    ? { width: (zoom * imageAspect) / frameAspect, height: zoom }
    : { width: zoom, height: (zoom * frameAspect) / imageAspect };
}

/** The same crop, moved only as far as it takes to keep the picture covering the frame. */
export function clampCrop(crop: Crop, imageAspect: number, frameAspect: number): Crop {
  const zoom = clamp(crop.zoom, 1, MAX_ZOOM);
  const { width, height } = scaled(zoom, imageAspect, frameAspect);
  const halfX = 0.5 / width;
  const halfY = 0.5 / height;
  return { x: clamp(crop.x, halfX, 1 - halfX), y: clamp(crop.y, halfY, 1 - halfY), zoom };
}

/** Where the picture goes in its frame: left, top, width and height as percentages of the frame. */
export function cropBox(crop: Crop, imageAspect: number, frameAspect: number) {
  const fitted = clampCrop(crop, imageAspect, frameAspect);
  const { width, height } = scaled(fitted.zoom, imageAspect, frameAspect);
  return {
    left: (0.5 - fitted.x * width) * 100,
    top: (0.5 - fitted.y * height) * 100,
    width: width * 100,
    height: height * 100,
  };
}

/**
 * Moves the picture by a drag or an arrow key: `dx` and `dy` are fractions of the frame's width and height, positive
 * to the right and down. The picture follows the hand, so its centre point moves the other way.
 */
export function panCrop(crop: Crop, dx: number, dy: number, imageAspect: number, frameAspect: number): Crop {
  const fitted = clampCrop(crop, imageAspect, frameAspect);
  const { width, height } = scaled(fitted.zoom, imageAspect, frameAspect);
  return clampCrop({ ...fitted, x: fitted.x - dx / width, y: fitted.y - dy / height }, imageAspect, frameAspect);
}

/** The crop at another zoom, about the same centre. */
export function zoomCrop(crop: Crop, zoom: number, imageAspect: number, frameAspect: number): Crop {
  return clampCrop({ ...crop, zoom }, imageAspect, frameAspect);
}

/** True when the crop is the centred default, so a shot can drop its `crop` prop. */
export function isDefaultCrop(crop: Crop): boolean {
  return crop.x === DEFAULT_CROP.x && crop.y === DEFAULT_CROP.y && crop.zoom === DEFAULT_CROP.zoom;
}

/** The prop as stored, rounded so History shows "0.62", not seventeen digits. */
export function cropProp(crop: Crop): { x: number; y: number; zoom: number } {
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return { x: round(crop.x), y: round(crop.y), zoom: round(crop.zoom) };
}
