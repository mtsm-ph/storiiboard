// The horizontal field of view a camera sees (6.1, docs/PHASE6_DECISIONS.md 6). Kevin's rule: the cone shows what the
// project's frame sees, not the whole sensor. So the recording mode's area is de-squeezed first (an anamorphic lens
// spreads the picture sideways by its squeeze), then the project's frame shape is fitted inside it, and only the width
// of that fitted frame counts: field of view = 2 × atan(width / (2 × focal length)). A 2.39:1 frame on a 16:9 mode
// uses less than the mode's width once the squeeze widens it; a 9:16 frame on a 16:9 mode uses a narrow slice of it.
// "On its side" (a camera turned for vertical shooting) swaps the mode's width and height before any of that.

export interface FieldOfViewInput {
  /** The recording mode's sensor area, in mm. */
  sensorWidthMm: number | null | undefined;
  sensorHeightMm: number | null | undefined;
  /** The lens's squeeze; 1 (spherical) when left out. */
  squeeze?: number | null | undefined;
  /** The focal length used, in mm. */
  focalMm: number | null | undefined;
  /** The project's frame shape, width over height (aspectValue reads the stored text). */
  aspect: number | null | undefined;
  /** The camera turned on its side: the mode's width and height swap. */
  onSide?: boolean;
}

export interface FieldOfView {
  /** The width of the sensor the frame uses, in mm. */
  widthMm: number;
  /** The horizontal angle, in degrees. */
  degrees: number;
}

const positive = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

/**
 * The project's frame shape as a number, width over height, from the one place it's parsed: "2.39:1", "16:9", "9:16",
 * or a decimal ("1.85", or a number). Null for anything else, never NaN.
 */
export function aspectValue(value: unknown): number | null {
  if (positive(typeof value === 'number' ? value : null)) return value as number;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const ratio = /^(\d+(?:\.\d+)?)\s*[:/x×]\s*(\d+(?:\.\d+)?)$/i.exec(text);
  const n = ratio ? Number(ratio[1]) / Number(ratio[2]) : /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : NaN;
  return positive(n) ? n : null;
}

/** The frame's width and horizontal angle; null when any input is missing or not above 0. */
export function fieldOfView(input: FieldOfViewInput): FieldOfView | null {
  const { sensorWidthMm, sensorHeightMm, focalMm, aspect, onSide = false } = input;
  const squeeze = input.squeeze ?? 1;
  if (!positive(sensorWidthMm) || !positive(sensorHeightMm) || !positive(focalMm) || !positive(aspect) || !positive(squeeze)) return null;
  const [width, height] = onSide ? [sensorHeightMm, sensorWidthMm] : [sensorWidthMm, sensorHeightMm];
  const areaWidth = width * squeeze;
  // The largest rectangle of the frame's shape that fits: as wide as the area when the frame is the taller shape,
  // else as tall as the area.
  const widthMm = aspect <= areaWidth / height ? height * aspect : areaWidth;
  return { widthMm, degrees: (2 * Math.atan(widthMm / (2 * focalMm)) * 180) / Math.PI };
}

/** A value as the Inspector shows it: one decimal, in figures that never change with the language. */
export const oneDecimal = (value: number): string => value.toFixed(1);
