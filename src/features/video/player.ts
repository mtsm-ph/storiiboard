import { clipProp, type Clip } from '../../core/media/video';
import { frameSeconds, type Rational } from '../../core/media/timecode';
import type { Change } from '../../core/ops/ops';

// The Player's arithmetic (2.4), apart from the page so it can be tested: frames and the times a <video> seeks to, a
// step, and the in and out points I and O set on the frame's clip. A playback copy's frame 0 is the video's first
// frame and it runs at the video's exact rate (playback.rs), so a frame of the copy is the same frame of the video.

/**
 * The frame showing at `seconds` of the copy (a `<video>`'s current time, anywhere in a frame). Webviews keep media
 * time in whole microseconds (Chromium rounds to the nearest), so a frame's own start can read a hair before it: a
 * thousandth of a frame's margin keeps it that frame.
 */
export function frameOfTime(seconds: number, fps: Rational): number {
  return Math.max(0, Math.floor((seconds * fps.num) / fps.den + 1e-3));
}

/** The frame a `<video>` presents at `mediaTime`, which is that frame's start (requestVideoFrameCallback): rounded. */
export function frameOfPresentation(mediaTime: number, fps: Rational): number {
  return Math.max(0, Math.round((mediaTime * fps.num) / fps.den));
}

/**
 * Where to seek to show `frame`: its middle, so neither rounding nor a player that shows the frame starting at a time
 * rather than the one ending there lands on its neighbour.
 */
export function timeOfFrame(frame: number, fps: Rational): number {
  return frameSeconds(frame + 0.5, fps);
}

/**
 * The frame at `seconds` of the copy, never past the video's last: at its end a `<video>`'s time is its whole length, a
 * frame past the last. A video whose length isn't known (`durationFrames` 0) isn't held back.
 */
export function frameInVideo(seconds: number, fps: Rational, durationFrames: number): number {
  const at = frameOfTime(seconds, fps);
  return durationFrames > 0 ? Math.min(at, durationFrames - 1) : at;
}

/** Whether `frame` is a frame of the video: any frame of one whose length isn't known. */
export function inVideo(frame: number, durationFrames: number): boolean {
  return frame >= 0 && (durationFrames <= 0 || frame < durationFrames);
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
