import { useEffect, useRef, useState } from 'react';
import { cropBox, type Crop } from '../../core/media/crop';
import { t } from '../../core/i18n';
import { frameSeconds, type Rational } from '../../core/media/timecode';
import { Button } from '../../ui/Button';

// The frame's clip in the inspector (2.8): its part of the take, in to out, framed as the frame is (the clip's crop,
// 2.6), played from the playback copy (never the original). Still on its in point until Play clip, then round and
// round, muted, until it's paused: a reference to watch, not a player (the Player tile is that). It never plays by
// itself, so nothing moves on screen unasked.

export interface ClipPreviewProps {
  /** Where the copy plays from; null while there's none to play. */
  url: string | null;
  inFrame: number;
  outFrame: number;
  fps: Rational;
  crop: Crop;
  /** The take's shape, upright with square pixels (displayAspect). */
  imageAspect: number;
  /** The project's frame. */
  frameAspect: number;
}

/** The time a frame of the copy is shown at: its middle, as the Player seeks (player.ts timeOfFrame). */
const middle = (frame: number, fps: Rational) => frameSeconds(frame + 0.5, fps);

export function ClipPreview({ url, inFrame, outFrame, fps, crop, imageAspect, frameAspect }: ClipPreviewProps) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const box = cropBox(crop, imageAspect, frameAspect);
  // Past the out point (or before the in point): back to the in point, playing on if it was.
  const end = frameSeconds(outFrame + 1, fps);
  const start = middle(inFrame, fps);

  // Another clip or copy: stopped, on its in point.
  const shown = `${url ?? ''}|${String(inFrame)}|${String(outFrame)}`;
  const [shownFor, setShownFor] = useState(shown);
  if (shownFor !== shown) {
    setShownFor(shown);
    setPlaying(false);
  }
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.pause();
    element.currentTime = start;
  }, [shown, start]);

  // While it plays: each frame shown is checked, so the loop turns at the out point, not up to a quarter second past
  // it as the time updates would. An older webview without frame callbacks falls back on those.
  useEffect(() => {
    const element = video.current;
    if (!playing || !element || !('requestVideoFrameCallback' in element)) return;
    let handle = 0;
    const next: VideoFrameRequestCallback = (_now, metadata) => {
      // The next frame would be past the out point.
      // (A ten-thousandth of a second spare: media time comes in whole microseconds.)
      if (metadata.mediaTime + frameSeconds(1, fps) >= end - 1e-4) element.currentTime = start;
      handle = element.requestVideoFrameCallback(next);
    };
    handle = element.requestVideoFrameCallback(next);
    return () => {
      element.cancelVideoFrameCallback(handle);
    };
  }, [playing, end, start, fps]);

  return (
    <div data-clip-preview="" className="flex flex-col gap-1.5">
      <div className="relative w-full overflow-hidden border border-text bg-ink-fixed" style={{ aspectRatio: String(frameAspect) }}>
        {url && (
          // Muted: a reference to watch while the rest of the inspector is in use.
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
              if (element.currentTime >= end || element.currentTime < start - 0.5) element.currentTime = start;
            }}
            onPlay={() => {
              setPlaying(true);
            }}
            onPause={() => {
              setPlaying(false);
            }}
          />
        )}
      </div>
      <Button
        className="self-start"
        aria-pressed={playing}
        disabled={!url}
        onClick={() => {
          const element = video.current;
          if (!element) return;
          if (element.paused) void element.play().catch(() => undefined);
          else element.pause();
        }}
      >
        {playing ? t('clipPreview.pause') : t('clipPreview.play')}
      </Button>
    </div>
  );
}
