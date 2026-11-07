import { clipProp, type Clip } from '../../core/media/video';
import { frameAt, frameSeconds, type Rational } from '../../core/media/timecode';
import type { Change } from '../../core/ops/ops';

// The Player's arithmetic (2.4), apart from the page so it can be tested: frames and the times a <video> seeks to, a
// step, and the in and out points I and O set on the frame's clip. A playback copy's frame 0 is the video's first
// frame and it runs at the video's exact rate (playback.rs), so a frame of the copy is the same frame of the video.

/** The frame showing at `seconds` of the copy. */
export function frameOfTime(seconds: number, fps: Rational): number {
  return frameAt(seconds, fps);
}

/**
 * Where to seek to show `frame`: its middle, so neither rounding nor a player that shows the frame starting at a time
 * rather than the one ending there lands on its neighbour.
 */
export function timeOfFrame(frame: number, fps: Rational): number {
  return frameSeconds(frame + 0.5, fps);
}

/** A frame `delta` frames on, inside the video's `durationFrames`. */
export function stepFrame(frame: number, delta: number, durationFrames: number): number {
  return Math.min(Math.max(0, durationFrames - 1), Math.max(0, frame + delta));
}

/** The clip with its in point at `frame`; an out point before it moves with it, so the clip is never backwards. */
export function clipWithIn(clip: Clip, frame: number): Clip {
  return { ...clip, inFrame: frame, outFrame: Math.max(clip.outFrame, frame) };
}

/** The clip with its out point at `frame`; an in point after it moves with it. */
export function clipWithOut(clip: Clip, frame: number): Clip {
  return { ...clip, outFrame: frame, inFrame: Math.min(clip.inFrame, frame) };
}

/** The edit that sets a frame's clip, one undo step. */
export function setClip(shotId: string, clip: Clip): Change {
  return { kind: 'update', id: shotId, set: { clip: clipProp(clip) } };
}
