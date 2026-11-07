import { describe, expect, it } from 'vitest';
import { DEFAULT_CROP } from '../../core/media/crop';
import { clipWithIn, clipWithOut, frameOfTime, setClip, stepFrame, timeOfFrame } from './player';

// The Player's arithmetic (2.4): a copy's frame 0 is the video's first frame, at the video's exact rate.

const ntsc = { num: 24000, den: 1001 };
const clip = { videoId: 'v1', inFrame: 10, outFrame: 20, crop: DEFAULT_CROP };

describe('the Player', () => {
  it('seeks to the middle of a frame, and reads that frame back, at 23.976 and over an hour in', () => {
    for (const frame of [0, 1, 47, 86_313]) {
      expect(frameOfTime(timeOfFrame(frame, ntsc), ntsc)).toBe(frame);
    }
    // The start of a frame reads as that frame, never its neighbour.
    expect(frameOfTime((48 * 1001) / 24000, ntsc)).toBe(48);
  });

  it('steps inside the video', () => {
    expect(stepFrame(5, 1, 48)).toBe(6);
    expect(stepFrame(0, -1, 48)).toBe(0);
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
