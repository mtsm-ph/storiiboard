// Timecode and frame numbers (Phase 2). A video's frames are counted from 0 at its exact rational rate (24000/1001,
// never 23.976); timecode is how a slate, a camera and an editor name them. Drop-frame timecode (29.97 and 59.94,
// written with a semicolon: 01:00:00;00) skips labels, never frames: the first two labels of every minute (four at
// 59.94), except every tenth minute, so the clock keeps up with real time.

export interface Rational {
  num: number;
  den: number;
}

/** 24000/1001 → 23.976…; for display and seconds, never for counting. */
export function rateValue(rate: Rational): number {
  return rate.num / rate.den;
}

/** The whole number of frames a second of timecode counts: 24 for 23.976, 30 for 29.97, 60 for 59.94. */
export function timecodeBase(rate: Rational): number {
  return Math.max(1, Math.round(rateValue(rate)));
}

/** Labels dropped each minute: 2 at 29.97, 4 at 59.94; none at a rate drop-frame doesn't exist for. */
function droppedPerMinute(rate: Rational, dropFrame: boolean): number {
  if (!dropFrame || rate.den !== 1001) return 0;
  const base = timecodeBase(rate);
  return base === 30 ? 2 : base === 60 ? 4 : 0;
}

const DAY_SECONDS = 24 * 3600;

export interface ParsedTimecode {
  /** Frames since 00:00:00:00, counting only labels that exist. */
  frames: number;
  dropFrame: boolean;
}

/**
 * "01:00:00:00" or "01:00:00;00" (a semicolon or a full stop before the frames marks drop-frame) as a frame count at
 * `rate`; null for text that isn't a timecode at that rate.
 */
export function parseTimecode(text: string, rate: Rational): ParsedTimecode | null {
  const match = /^(\d{1,2}):(\d{2}):(\d{2})([:;.,])(\d{2,3})$/.exec(text.trim());
  if (!match) return null;
  const [h, m, s, f] = [match[1], match[2], match[3], match[5]].map(Number) as [number, number, number, number];
  const dropFrame = match[4] !== ':';
  const base = timecodeBase(rate);
  if (m > 59 || s > 59 || f >= base || h > 23) return null;
  const drop = droppedPerMinute(rate, dropFrame);
  // A label drop-frame skips (00:01:00;00 at 29.97) doesn't exist.
  if (drop > 0 && s === 0 && f < drop && m % 10 !== 0) return null;
  const minutes = 60 * h + m;
  const frames = (h * 3600 + m * 60 + s) * base + f - drop * (minutes - Math.floor(minutes / 10));
  return { frames, dropFrame };
}

/** A frame count since 00:00:00:00 as timecode; wraps at 24 hours, as the clock does. */
export function formatTimecode(frames: number, rate: Rational, dropFrame: boolean): string {
  const base = timecodeBase(rate);
  const drop = droppedPerMinute(rate, dropFrame);
  let n = Math.max(0, Math.floor(frames));
  if (drop > 0) {
    const perTenMinutes = base * 600 - drop * 9;
    const perMinute = base * 60 - drop;
    const day = perTenMinutes * 6 * 24;
    n %= day;
    const tens = Math.floor(n / perTenMinutes);
    const rest = n % perTenMinutes;
    // Add back the labels skipped so far: nine minutes in each whole ten, and the minutes begun in this one.
    n += drop * 9 * tens + (rest > drop ? drop * Math.floor((rest - drop) / perMinute) : 0);
  } else {
    n %= base * DAY_SECONDS;
  }
  const f = n % base;
  const totalSeconds = Math.floor(n / base);
  const two = (value: number) => String(value).padStart(2, '0');
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor(totalSeconds / 60) % 60;
  const s = totalSeconds % 60;
  return `${two(h)}:${two(m)}:${two(s)}${drop > 0 ? ';' : ':'}${base > 99 ? String(f).padStart(3, '0') : two(f)}`;
}

/**
 * The timecode of frame `index` of a video that starts at `start` (its source timecode, or none: 00:00:00:00).
 * Drop-frame follows the start's own mark; with no start, the rate's usual one (drop-frame at 29.97 and 59.94).
 */
export function frameTimecode(index: number, rate: Rational, start: string | null): string {
  const parsed = start === null ? null : parseTimecode(start, rate);
  const dropFrame = parsed ? parsed.dropFrame : droppedPerMinute(rate, true) > 0;
  return formatTimecode((parsed?.frames ?? 0) + index, rate, dropFrame);
}

/** Where frame `index` starts, in seconds: exact for a rational rate, as players and ffmpeg seek. */
export function frameSeconds(index: number, rate: Rational): number {
  return (index * rate.den) / rate.num;
}

/** The frame showing at `seconds`, never rounded up into the next one by floating point. */
export function frameAt(seconds: number, rate: Rational): number {
  return Math.max(0, Math.floor((seconds * rate.num) / rate.den + 1e-6));
}
