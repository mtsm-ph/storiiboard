import { useEffect, useRef, useState } from 'react';
import { cropBox, type Crop } from '../../core/media/crop';
import { t } from '../../core/i18n';
import { frameSeconds, type Rational } from '../../core/media/timecode';
import { Button } from '../../ui/Button';
import { copyMayBeGone } from './playbackCopies';

// The frame's clip in the inspector (2.8): its part of the take, in to out, framed as the frame is (the clip's crop,
// 2.6), played from the playback copy (never the original). Still on its in point until Play clip, then round and
// round, muted, until it's paused: a reference to watch, not a player (the Player tile is that). It never plays by
// itself, so nothing moves on screen unasked.
//
// It never shows a frame outside the clip: at the out frame it pauses, goes back to the in point and carries on once
// it's there, rather than seek while playing, when the frame after the out point could show before the seek lands.

export interface ClipPreviewProps {
  /** The video the copy is of, so a copy that can't be read is looked for (and made again if it's gone). */
  videoId: string;
  /** The frame it's for: another frame, even of the same clip, starts again on its in point. */
  frameKey: string;
  /** Where the copy plays from. */
  url: string;
  inFrame: number;
  outFrame: number;
  fps: Rational;
  crop: Crop;
  /** The take's shape, upright with square pixels (displayAspect). */
  imageAspect: number;
  /** The project's frame. */
  frameAspect: number;
}

/** A margin for media time, which webviews keep in whole microseconds. */
const EPSILON = 1e-4;

export function ClipPreview({ videoId, frameKey, url, inFrame, outFrame, fps: rate, crop, imageAspect, frameAspect }: ClipPreviewProps) {
  const video = useRef<HTMLVideoElement>(null);
  // Playing as the person asked: the loop's own pause at the out point doesn't change it.
  const [playing, setPlaying] = useState(false);
  // Going back to the in point: the pause and the seek that make the turn, not the person's.
  const turning = useRef(false);
  // The URL whose error has been answered, so a copy that can't be read is looked for once; and whether it still
  // can't be played after that (it's there, but this webview can't read it), which is said, as the Player says it.
  const answered = useRef<string | null>(null);
  const [broken, setBroken] = useState<string | null>(null);
  const box = cropBox(crop, imageAspect, frameAspect);
  const { num, den } = rate;
  const inStart = frameSeconds(inFrame, { num, den });
  const outStart = frameSeconds(outFrame, { num, den });
  const end = frameSeconds(outFrame + 1, { num, den });
  // Shown at its middle, as the Player seeks (player.ts timeOfFrame).
  const start = frameSeconds(inFrame + 0.5, { num, den });
  // One frame has nothing to play.
  const still = inFrame >= outFrame;

  // Another frame, clip or copy: stopped, on its in point.
  const shown = `${frameKey}|${url}|${String(inFrame)}|${String(outFrame)}`;
  const [shownFor, setShownFor] = useState(shown);
  if (shownFor !== shown) {
    setShownFor(shown);
    setPlaying(false);
  }
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    turning.current = false;
    element.pause();
    element.currentTime = start;
  }, [shown, start]);

  /** Back to the in point, paused there; playing on once it's there if it was playing. */
  const turn = (element: HTMLVideoElement) => {
    if (turning.current) return;
    turning.current = true;
    element.pause();
    element.currentTime = start;
  };

  // While it plays: each frame shown is checked, so it turns on the out frame itself. An older webview without frame
  // callbacks has the time updates alone, which come a few times a second.
  useEffect(() => {
    const element = video.current;
    if (!playing || !element || !('requestVideoFrameCallback' in element)) return;
    let handle = 0;
    const next: VideoFrameRequestCallback = (_now, metadata) => {
      if (!turning.current && (metadata.mediaTime >= outStart - EPSILON || metadata.mediaTime < inStart - EPSILON)) {
        turning.current = true;
        element.pause();
        element.currentTime = start;
      }
      handle = element.requestVideoFrameCallback(next);
    };
    handle = element.requestVideoFrameCallback(next);
    return () => {
      element.cancelVideoFrameCallback(handle);
    };
  }, [playing, outStart, inStart, start]);

  return (
    <div data-clip-preview="" className="flex flex-col gap-1.5">
      <div className="relative w-full overflow-hidden border border-text bg-ink-fixed" style={{ aspectRatio: String(frameAspect) }}>
        {/* Muted: a reference to watch while the rest of the inspector is in use. */}
        <video
          ref={video}
          src={url}
          muted
          playsInline
          preload="auto"
          aria-label={t('clipPreview.picture')}
          className="absolute max-w-none"
          style={{ left: `${String(box.left)}%`, top: `${String(box.top)}%`, width: `${String(box.width)}%`, height: `${String(box.height)}%` }}
          onLoadedData={(event) => {
            event.currentTarget.currentTime = start;
          }}
          onTimeUpdate={(event) => {
            const element = event.currentTarget;
            if (!element.paused && (element.currentTime >= end - EPSILON || element.currentTime < inStart - EPSILON)) turn(element);
          }}
          onSeeked={(event) => {
            if (!turning.current) return;
            turning.current = false;
            if (playing) void event.currentTarget.play().catch(() => undefined);
          }}
          // The take's own end (an out point on its last frame): round again from the in point.
          onEnded={(event) => {
            if (playing) turn(event.currentTarget);
          }}
          onPause={() => {
            if (!turning.current && !video.current?.ended) setPlaying(false);
          }}
          // The copy can't be read (the cap took it, or it went outside the app): looked for, and made again if it's
          // gone, once for this copy, as the Player does.
          onError={() => {
            turning.current = false;
            setPlaying(false);
            setBroken(url);
            if (answered.current === url) return;
            answered.current = url;
            copyMayBeGone(videoId);
          }}
          onLoadedMetadata={() => {
            setBroken(null);
          }}
        />
      </div>
      {broken === url && <p className="inline-block self-start bg-warning px-[7px] py-1 text-[12px] text-paper-fixed">{t('player.cantPlay')}</p>}
      <Button
        className="self-start"
        disabled={still || broken === url}
        onClick={() => {
          const element = video.current;
          if (!element) return;
          if (!playing) {
            // A turn whose seek never ended is over: this play starts afresh.
            turning.current = false;
            // From the in point unless it's inside the clip before its out frame, never from the take's start, and
            // never on into the frame after the out point.
            if (element.ended || element.currentTime < inStart - EPSILON || element.currentTime >= outStart - EPSILON) element.currentTime = start;
            setPlaying(true);
            void element.play().catch(() => {
              setPlaying(false);
            });
          } else {
            setPlaying(false);
            element.pause();
          }
        }}
      >
        {playing ? t('clipPreview.pause') : t('clipPreview.play')}
      </Button>
    </div>
  );
}
