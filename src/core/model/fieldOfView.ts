// The horizontal field of view a camera sees (6.1, docs/PHASE6_DECISIONS.md 6). Kevin's rule: the cone shows what the
// project's frame sees, not the whole sensor. So the recording mode's area is de-squeezed first (an anamorphic lens
// spreads the picture sideways by its squeeze), then the project's frame shape is fitted inside it, and only the width
// of that fitted frame counts: field of view = 2 × atan(width / (2 × focal length)). A 2.39:1 frame on a 16:9 mode
// uses less than the mode's width once the squeeze widens it; a 9:16 frame on a 16:9 mode uses a narrow slice of it.
//
// "On its side" (a camera turned for vertical shooting) turns the de-squeezed area, not the sensor before it: the lens
// squeezes along the sensor's long (recording-width) axis, and that axis turns with the camera. So the area is
// (width × squeeze) by height, then its width and height swap, then the frame is fitted. On 35.6 × 20.0 with a 2×
// squeeze, a 2.39:1 frame on its side at 50 mm is 20.0 mm wide, 22.6°; swapping the sensor first and then squeezing
// would stretch the wrong axis (40 mm, 43.6°). Without a squeeze the two orders agree.

export interface FieldOfViewInput {
  /** The recording mode's sensor area, in mm. */
  sensorWidthMm: number | null | undefined;
  sensorHeightMm: number | null | undefined;
  /** The lens's squeeze; 1 (spherical) when left out. */
  squeeze?: number | null | undefined;
  /** The focal length used, in mm. */
  focalMm: number | null | undefined;
  /** The project's frame shape, width over height (storyboard.ts's aspectRatioValue gives it for the project). */
  aspect: number | null | undefined;
  /** The camera turned on its side: the de-squeezed area's width and height swap. */
  onSide?: boolean;
}

export interface FieldOfView {
  /** The width of the sensor the frame uses, in mm (de-squeezed). */
  widthMm: number;
  /** The horizontal angle, in degrees. */
  degrees: number;
}

const positive = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

/** The frame's width and horizontal angle; null when any input is missing or not above 0. */
export function fieldOfView(input: FieldOfViewInput): FieldOfView | null {
  const { sensorWidthMm, sensorHeightMm, focalMm, aspect, onSide = false } = input;
  const squeeze = input.squeeze ?? 1;
  if (!positive(sensorWidthMm) || !positive(sensorHeightMm) || !positive(focalMm) || !positive(aspect) || !positive(squeeze)) return null;
  // De-squeeze along the sensor's recording width first, then turn the area with the camera.
  const desqueezed = sensorWidthMm * squeeze;
  const [areaWidth, areaHeight] = onSide ? [sensorHeightMm, desqueezed] : [desqueezed, sensorHeightMm];
  // The largest rectangle of the frame's shape that fits: when the frame's shape is narrower than or equal to the
  // area's, the frame is as tall as the area and its width is that height × aspect; otherwise it is as wide as the area.
  const widthMm = aspect <= areaWidth / areaHeight ? areaHeight * aspect : areaWidth;
  return { widthMm, degrees: (2 * Math.atan(widthMm / (2 * focalMm)) * 180) / Math.PI };
}

/** A value as the Inspector shows it: one decimal, in figures that never change with the language. */
export const oneDecimal = (value: number): string => value.toFixed(1);
