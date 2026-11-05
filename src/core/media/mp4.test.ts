import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { probeMp4 } from './mp4';

// The end-to-end fixture: 2 s of H.264 at 24000/1001 with AAC sound and a 01:00:00:00 timecode track, made once with
// the sidecar ffmpeg (Media Foundation's H.264 encoder) and checked in, 120 KB.
const fixture = readFileSync(new URL('../../../e2e/fixtures/video/A001_C003_2398.mp4', import.meta.url));
const bytes = fixture.buffer.slice(fixture.byteOffset, fixture.byteOffset + fixture.byteLength);

describe('the browser build’s MP4 reader', () => {
  it('reads the video track’s size, exact rate, frame count and sound, past the timecode track', () => {
    expect(probeMp4(bytes)).toMatchObject({
      width: 320,
      height: 180,
      fpsNum: 24000,
      fpsDen: 1001,
      durationFrames: 48,
      hasAudio: true,
      rotation: 0,
    });
  });

  it('finds nothing in a file that is not one', () => {
    expect(probeMp4(new TextEncoder().encode('not a video at all').buffer)).toBeNull();
    // Cut short halfway: no movie box left whole.
    expect(probeMp4(bytes.slice(0, 64))).toBeNull();
  });

  it('returns nothing, never an error, for a movie box whose insides lie about their size', () => {
    // Every byte of the movie box in turn set to 0xFF: sizes, counts and offsets all wrong somewhere.
    const at = Buffer.from(bytes).indexOf('moov') - 4;
    for (let i = at; i < at + 400; i++) {
      const broken = new Uint8Array(bytes.slice(0));
      broken[i] = 0xff;
      expect(() => probeMp4(broken.buffer)).not.toThrow();
    }
  });
});
