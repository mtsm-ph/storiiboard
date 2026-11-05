import type { VideoProbe } from './video';

// The browser build's stand-in for ffprobe (Phase 2, decision 9): dev and end-to-end builds can't run ffmpeg, so they
// read an MP4 or QuickTime file's own boxes for what the app needs: the video track's size, its timescale and sample
// durations (so the rate comes out as an exact fraction), and its frame count. Enough for the test fixtures and for
// trying the app in a browser; the desktop app always asks ffprobe.

interface Box {
  type: string;
  start: number;
  end: number;
}

function* boxes(view: DataView, start: number, end: number): Generator<Box> {
  let at = start;
  while (at + 8 <= end) {
    let size = view.getUint32(at);
    const type = String.fromCharCode(view.getUint8(at + 4), view.getUint8(at + 5), view.getUint8(at + 6), view.getUint8(at + 7));
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) return;
      size = Number(view.getBigUint64(at + 8));
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header || at + size > end) return;
    yield { type, start: at + header, end: at + size };
    at += size;
  }
}

function child(view: DataView, parent: Box, type: string): Box | undefined {
  for (const box of boxes(view, parent.start, parent.end)) if (box.type === type) return box;
  return undefined;
}

function path(view: DataView, parent: Box, types: readonly string[]): Box | undefined {
  let box: Box | undefined = parent;
  for (const type of types) box = box ? child(view, box, type) : undefined;
  return box;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** Rates cameras shoot at, as in src-tauri/src/video.rs. */
const STANDARD: readonly (readonly [number, number])[] = [
  [24000, 1001], [24, 1], [25, 1], [30000, 1001], [30, 1], [48000, 1001], [48, 1], [50, 1],
  [60000, 1001], [60, 1], [96, 1], [100, 1], [120000, 1001], [120, 1], [200, 1], [240000, 1001], [240, 1],
];

/**
 * A rate from one sample's duration in the track's timescale: exact, in lowest terms; or, for a variable rate (an
 * average), the nearest camera rate within one frame a second, as src-tauri/src/video.rs does.
 */
function rateOf(timescale: number, delta: number, variable: boolean): { num: number; den: number } {
  const divisor = gcd(timescale, delta);
  const exact = { num: timescale / divisor, den: delta / divisor };
  const value = timescale / delta;
  const tolerance = variable ? 1 : 0.0005;
  let best: readonly [number, number] | undefined;
  for (const rate of STANDARD) {
    const off = Math.abs(rate[0] / rate[1] - value);
    if (off < tolerance && (!best || off < Math.abs(best[0] / best[1] - value))) best = rate;
  }
  return best ? { num: best[0], den: best[1] } : exact;
}

const fourCC = (view: DataView, at: number) =>
  String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));

/** A track's handler (`vide`, `soun`, `tmcd`), or '' when its box is too short to say. */
function handlerOf(view: DataView, trak: Box): string {
  const hdlr = path(view, trak, ['mdia', 'hdlr']);
  return hdlr && hdlr.end - hdlr.start >= 12 ? fourCC(view, hdlr.start + 8) : '';
}

function readVideoTrack(view: DataView, moov: Box, trak: Box): VideoProbe | null {
  const mdhd = path(view, trak, ['mdia', 'mdhd']);
  const stbl = path(view, trak, ['mdia', 'minf', 'stbl']);
  const stts = stbl ? child(view, stbl, 'stts') : undefined;
  const stsd = stbl ? child(view, stbl, 'stsd') : undefined;
  if (!mdhd || !stts) return null;
  const version = view.getUint8(mdhd.start);
  const timescaleAt = mdhd.start + (version === 1 ? 20 : 12);
  if (timescaleAt + 4 > mdhd.end || stts.end - stts.start < 8) return null;
  const timescale = view.getUint32(timescaleAt);
  // Sample counts and durations; a constant-rate file has one entry. Never more entries than the box holds.
  const entries = Math.min(view.getUint32(stts.start + 4), Math.floor((stts.end - stts.start - 8) / 8));
  let frames = 0;
  let total = 0;
  let first = 0;
  for (let i = 0; i < entries; i++) {
    const count = view.getUint32(stts.start + 8 + i * 8);
    const delta = view.getUint32(stts.start + 12 + i * 8);
    if (i === 0) first = delta;
    frames += count;
    total += count * delta;
  }
  if (timescale === 0 || frames === 0 || first === 0 || total === 0) return null;
  const rate = entries === 1 ? rateOf(timescale, first, false) : rateOf(timescale * frames, total, true);
  // Stored pixels from the first sample entry (a visual entry's width and height sit 24 bytes in); tkhd's are the
  // presentation size, after the pixel shape.
  let width = 0;
  let height = 0;
  if (stsd && stsd.end - stsd.start >= 8 + 8 + 28) {
    const entry = stsd.start + 8 + 8;
    width = view.getUint16(entry + 24);
    height = view.getUint16(entry + 26);
  }
  const tkhd = child(view, trak, 'tkhd');
  if ((width === 0 || height === 0) && tkhd && tkhd.end - tkhd.start >= 84) {
    width = Math.round(view.getUint32(tkhd.end - 8) / 65536);
    height = Math.round(view.getUint32(tkhd.end - 4) / 65536);
  }
  if (width === 0 || height === 0) return null;
  return {
    codec: '',
    width,
    height,
    sarNum: 1,
    sarDen: 1,
    fpsNum: rate.num,
    fpsDen: rate.den,
    durationFrames: frames,
    startTimecode: null,
    rotation: 0,
    hasAudio: [...boxes(view, moov.start, moov.end)].some((t) => t.type === 'trak' && handlerOf(view, t) === 'soun'),
    hdr: false,
    bitDepth: 8,
  };
}

/**
 * What the stand-in can read from an MP4 or QuickTime file's bytes; null when it finds no video track, or the bytes
 * don't hold together (it reads whatever file it's given, so a bad one must never throw).
 */
export function probeMp4(bytes: ArrayBuffer): VideoProbe | null {
  try {
    const view = new DataView(bytes);
    const moov = child(view, { type: '', start: 0, end: bytes.byteLength }, 'moov');
    if (!moov) return null;
    for (const trak of boxes(view, moov.start, moov.end)) {
      if (trak.type === 'trak' && handlerOf(view, trak) === 'vide') return readVideoTrack(view, moov, trak);
    }
    return null;
  } catch {
    return null;
  }
}
