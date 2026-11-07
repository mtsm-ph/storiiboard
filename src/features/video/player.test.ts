import { describe, expect, it } from 'vitest';
import { DEFAULT_CROP } from '../../core/media/crop';
import { clipWithIn, clipWithOut, frameInVideo, frameOfPresentation, framesOfLength, frameOfTime, inVideo, setClip, stepFrame, timeOfFrame } from './player';

// The Player's arithmetic (2.4): a copy's frame 0 is the video's first frame, at the video's exact rate.

const ntsc = { num: 24000, den: 1001 };
const clip = { videoId: 'v1', inFrame: 10, outFrame: 20, crop: DEFAULT_CROP };

describe('the Player', () => {
  it('keeps a frame inside the video at its end, but holds back no video whose length is unknown', () => {
    const fps = { num: 24000, den: 1001 };
    // The end of 48 frames: its whole length, a frame past the last.
    expect(frameOfTime((48 * 1001) / 24000, fps)).toBe(48);
    expect(frameInVideo((48 * 1001) / 24000, fps, 48)).toBe(47);
    expect(frameInVideo(1, fps, 48)).toBe(23);
    // Length unknown: three seconds in is frame 71, not 0.
    expect(frameInVideo(3, fps, 0)).toBe(71);
    expect(inVideo(47, 48)).toBe(true);
    expect(inVideo(48, 48)).toBe(false);
    expect(inVideo(71, 0)).toBe(true);
    expect(inVideo(-1, 0)).toBe(false);
    // Its copy's length bounds it once the <video> knows it: 48 frames in 2.002 s, none when it's not known.
    expect(framesOfLength((48 * 1001) / 24000, fps)).toBe(48);
    expect(framesOfLength(2.002001, fps)).toBe(48);
    // A copy whose sound runs 15 ms past its picture: still 48 frames, never a 49th that isn't there.
    expect(framesOfLength(48 / 24 + 0.015, { num: 24, den: 1 })).toBe(48);
    expect(framesOfLength((48 * 1001) / 24000 - 1e-6, fps)).toBe(48);
    expect(framesOfLength(Number.NaN, fps)).toBe(0);
    expect(framesOfLength(Number.POSITIVE_INFINITY, fps)).toBe(0);
  });


  it('seeks to the middle of a frame, and reads that frame back, at 23.976 and over an hour in', () => {
    for (const frame of [0, 1, 47, 86_313]) {
      expect(frameOfTime(timeOfFrame(frame, ntsc), ntsc)).toBe(frame);
    }
    // The start of a frame reads as that frame, never its neighbour, even held to whole microseconds as Chromium does
    // (frame 1 starts at 41708.333 µs, kept as 41708).
    expect(frameOfTime((48 * 1001) / 24000, ntsc)).toBe(48);
    expect(frameOfTime(0.041708, ntsc)).toBe(1);
    expect(frameOfPresentation(0.041708, ntsc)).toBe(1);
    for (const frame of [1, 2, 47, 1439, 86_313]) {
      const start = Math.round(((frame * 1001) / 24000) * 1e6) / 1e6;
      expect(frameOfTime(start, ntsc)).toBe(frame);
      expect(frameOfPresentation(start, ntsc)).toBe(frame);
    }
  });

  it('steps inside the video', () => {
    expect(stepFrame(5, 1, 48)).toBe(6);
    expect(stepFrame(0, -1, 48)).toBe(0);
    // Length unknown: steps on, never before 0.
    expect(stepFrame(71, 1, 0)).toBe(72);
    expect(stepFrame(3, -10, 0)).toBe(0);
    expect(stepFrame(47, 10, 48)).toBe(47);
    expect(stepFrame(3, -10, 48)).toBe(0);
  });

  it('sets in and out, never leaving the clip backwards', () => {
    expect(clipWithIn(clip, 15)).toMatchObject({ inFrame: 15, outFrame: 20 });
    expect(clipWithIn(clip, 30)).toMatchObject({ inFrame: 30, outFrame: 30 });
    expect(clipWithOut(clip, 12)).toMatchObject({ inFrame: 10, outFrame: 12 });
    expect(clipWithOut(clip, 4)).toMatchObject({ inFrame: 4, outFrame: 4 });
    expect(setClip('s1', clipWithIn(clip, 15))).toEqual({
      kind: 'update',
      id: 's1',
      set: { clip: { video_id: 'v1', in_frame: 15, out_frame: 20 } },
    });
  });
});
