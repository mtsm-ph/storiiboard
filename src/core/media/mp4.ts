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

/** A rate from one sample's duration in the track's timescale: exact, in lowest terms, snapped to a camera rate when it's within a hair of one. */
function rateOf(timescale: number, delta: number): { num: number; den: number } {
  const divisor = gcd(timescale, delta);
  const exact = { num: timescale / divisor, den: delta / divisor };
  const value = timescale / delta;
  const near = STANDARD.find(([num, den]) => Math.abs(num / den - value) < 0.0005);
  return near ? { num: near[0], den: near[1] } : exact;
}

/** What the stand-in can read from an MP4 or QuickTime file's bytes; null when it finds no video track. */
export function probeMp4(bytes: ArrayBuffer): VideoProbe | null {
  const view = new DataView(bytes);
  const file: Box = { type: '', start: 0, end: bytes.byteLength };
  const moov = child(view, file, 'moov');
  if (!moov) return null;
  for (const trak of boxes(view, moov.start, moov.end)) {
    if (trak.type !== 'trak') continue;
    const hdlr = path(view, trak, ['mdia', 'hdlr']);
    if (!hdlr || hdlr.end - hdlr.start < 12) continue;
    const handler = String.fromCharCode(...new Uint8Array(bytes, hdlr.start + 8, 4));
    if (handler !== 'vide') continue;
    const mdhd = path(view, trak, ['mdia', 'mdhd']);
    const stts = path(view, trak, ['mdia', 'minf', 'stbl', 'stts']);
    const tkhd = child(view, trak, 'tkhd');
    if (!mdhd || !stts || !tkhd) return null;
    const timescale = view.getUint8(mdhd.start) === 1 ? view.getUint32(mdhd.start + 20) : view.getUint32(mdhd.start + 12);
    // Sample counts and durations; a constant-rate file has one entry.
    const entries = view.getUint32(stts.start + 4);
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
    if (timescale === 0 || frames === 0 || first === 0) return null;
    const rate = entries === 1 ? rateOf(timescale, first) : rateOf(timescale * frames, total);
    // tkhd's width and height are 16.16 fixed point, at its end.
    const width = Math.round(view.getUint32(tkhd.end - 8) / 65536);
    const height = Math.round(view.getUint32(tkhd.end - 4) / 65536);
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
      hasAudio: [...boxes(view, moov.start, moov.end)].some((t) => {
        const h = t.type === 'trak' ? path(view, t, ['mdia', 'hdlr']) : undefined;
        return h !== undefined && String.fromCharCode(...new Uint8Array(bytes, h.start + 8, 4)) === 'soun';
      }),
      hdr: false,
      bitDepth: 8,
    };
  }
  return null;
}
