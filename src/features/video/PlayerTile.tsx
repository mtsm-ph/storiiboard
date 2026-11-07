import { useEffect, useMemo, useRef, useState } from 'react';
import { projectStore, useProject } from '../../app/projectStore';
import { readClip, videoFields } from '../../core/media/video';
import { useSelection } from '../storyboard/selection';
import { clipWithIn, clipWithOut, frameOfTime, setClip, stepFrame, timeOfFrame } from './player';
import { copyToPlay, makeCopy, useCopy } from './playbackCopies';
import { PlayerView, type PlayerStatus, type PlayerVideo } from './PlayerView';
import { useVideoMissing } from './videoStatus';

// The Player tile (2.4): the selected frame's video, from its playback copy. It asks for the copy when there's none,
// opens it once made, and asks again if it goes missing while shown (the cap, a Clear, a Move): the <video> says so
// with an error. The frame showing is kept here, from the <video>'s own time; I and O set the frame's clip, one undo
// step each, read from the project as it is when the edit lands.


export function PlayerTile() {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const shotId = useSelection((s) => s.shotId);
  const shot = shotId ? records[shotId] : undefined;
  const clip = shot?.type === 'shot' && shot.trashedAt === null ? readClip(shot.props) : null;
  const videoId = clip?.videoId ?? null;
  const videoRecord = videoId ? records[videoId] : undefined;
  const linked = videoRecord?.type === 'media' && videoRecord.trashedAt === null ? videoFields(videoRecord.props) : null;
  const missing = useVideoMissing(videoId);
  const copy = useCopy(videoId);
  const [opened, setOpened] = useState<{ videoId: string; url: string; silent: boolean; quiet: boolean } | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fpsNum = linked?.fps.num ?? 24;
  const fpsDen = linked?.fps.den ?? 1;
  const fps = useMemo(() => ({ num: fpsNum, den: fpsDen }), [fpsNum, fpsDen]);
  const duration = linked?.durationFrames ?? 0;

  // Another video (or none): from its in point, paused. Set as the video changes, not each time the in point moves.
  const [shownVideo, setShownVideo] = useState(videoId);
  if (shownVideo !== videoId) {
    setShownVideo(videoId);
    setFrame(clip?.inFrame ?? 0);
    setPlaying(false);
  }

  // A copy is asked for when the Player shows a video without one (PLAN 2.3b: "and (2.4) by the Player").
  const usable = videoId !== null && linked !== null && !missing;
  useEffect(() => {
    if (usable && copy.kind === 'none') makeCopy(videoId);
  }, [usable, videoId, copy.kind]);

  // Made: found and opened.
  useEffect(() => {
    if (!usable || copy.kind !== 'made') return;
    let live = true;
    copyToPlay(videoId)
      .then((found) => {
        if (!live) return;
        if (found) setOpened({ videoId, ...found });
        // Gone since it was made: made again.
        else makeCopy(videoId);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [usable, videoId, copy.kind]);

  // While it plays, the frame from each frame shown, where the browser says; otherwise from the time updates.
  useEffect(() => {
    const element = videoRef.current;
    // An older webview without it updates the frame from the time updates alone.
    if (!playing || !element || !('requestVideoFrameCallback' in element)) return;
    let handle = 0;
    const next: VideoFrameRequestCallback = (_now, metadata) => {
      setFrame(frameOfTime(metadata.mediaTime, fps));
      handle = element.requestVideoFrameCallback(next);
    };
    handle = element.requestVideoFrameCallback(next);
    return () => {
      element.cancelVideoFrameCallback(handle);
    };
  }, [playing, fps]);

  const ready = usable && copy.kind === 'made' && opened?.videoId === videoId ? opened : null;
  const status: PlayerStatus = !project
    ? { kind: 'noProject' }
    : !shot || shot.type !== 'shot' || shot.trashedAt !== null
      ? { kind: 'noFrame' }
      : !clip
        ? { kind: 'noVideo' }
        : !linked || missing
          ? { kind: 'missing' }
          : ready
            ? { kind: 'ready', url: ready.url, silent: ready.silent, quiet: ready.quiet }
            : copy.kind === 'made'
              ? { kind: 'opening' }
              : copy.kind === 'queued' || copy.kind === 'making' || copy.kind === 'failed'
                ? copy
                : { kind: 'none' };
  const video: PlayerVideo | null =
    clip && linked
      ? { name: linked.sourceName, fps, startTimecode: linked.startTimecode, durationFrames: duration, inFrame: clip.inFrame, outFrame: clip.outFrame }
      : null;

  const seek = (to: number) => {
    const target = stepFrame(to, 0, duration);
    setFrame(target);
    const element = videoRef.current;
    if (element) element.currentTime = timeOfFrame(target, fps);
  };
  /** Sets the in or out point at the frame showing, on the clip as it is when the edit lands. */
  const setPoint = (which: 'in' | 'out') => {
    if (!shotId) return;
    const at = frame;
    void projectStore.getState().applyWith((now) => {
      const current = now[shotId];
      const currentClip = current?.type === 'shot' ? readClip(current.props) : null;
      if (!currentClip || currentClip.videoId !== videoId) return { changes: [] };
      return { changes: [setClip(shotId, which === 'in' ? clipWithIn(currentClip, at) : clipWithOut(currentClip, at))] };
    });
  };

  return (
    <PlayerView
      status={status}
      video={video}
      frame={frame}
      playing={playing}
      videoRef={videoRef}
      onPlayPause={() => {
        const element = videoRef.current;
        if (!element) return;
        if (element.paused) void element.play().catch(() => undefined);
        else element.pause();
      }}
      onStep={(delta) => {
        videoRef.current?.pause();
        seek(frame + delta);
      }}
      onSeek={seek}
      onSetIn={() => {
        setPoint('in');
      }}
      onSetOut={() => {
        setPoint('out');
      }}
      onMakeCopy={() => {
        if (videoId) makeCopy(videoId);
      }}
      onTime={(event) => {
        // Paused, the frame is where it was put; a play moves it. Loaded, the <video> is put on the frame showing.
        const element = event.currentTarget;
        if (event.type === 'loadeddata') element.currentTime = timeOfFrame(frame, fps);
        else if (!element.paused) setFrame(frameOfTime(element.currentTime, fps));
      }}
      onPlaying={setPlaying}
      onVideoError={() => {
        // The copy went (the cap, a Clear, a Move) or can't be read: made again, and opened once it is.
        setOpened(null);
        setPlaying(false);
        if (videoId) makeCopy(videoId);
      }}
    />
  );
}
