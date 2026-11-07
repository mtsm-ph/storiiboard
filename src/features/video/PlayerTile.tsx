import { useEffect, useMemo, useRef, useState } from 'react';
import { projectStore, useProject } from '../../app/projectStore';
import { readClip, videoFields } from '../../core/media/video';
import { useSelection } from '../storyboard/selection';
import { t } from '../../core/i18n';
import { clipWithIn, clipWithOut, frameInVideo, frameOfPresentation, framesOfLength, inVideo, setClip, stepFrame, timeOfFrame } from './player';
import { copyMayBeGone, copyToPlay, makeCopy, useCopy } from './playbackCopies';
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
  // The video's length in frames; for one whose record has none (ffprobe couldn't tell), its copy's once loaded.
  const [copyFrames, setCopyFrames] = useState<{ url: string; frames: number } | null>(null);
  const recorded = linked?.durationFrames ?? 0;

  // Another frame or video (or none): from its in point, paused. Set as the selection changes, not each time the in
  // point moves; two frames of one take each start at their own in point.
  const shown = `${shotId ?? ''}|${videoId ?? ''}`;
  const [shownFor, setShownFor] = useState(shown);
  if (shownFor !== shown) {
    setShownFor(shown);
    setFrame(clip?.inFrame ?? 0);
    setPlaying(false);
  }

  // A copy the <video> can't play: its URL, so it isn't opened again until a remake (it passes through being made) or
  // Try again; and the video it was remade for, once, so a copy that never plays can't be remade over and over.
  const [broken, setBroken] = useState<{ videoId: string; url: string } | null>(null);
  const [remadeFor, setRemadeFor] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  if (broken !== null && (broken.videoId !== videoId || copy.kind !== 'made')) setBroken(null);

  // A copy is asked for when the Player shows a video that has had none since it came into view (PLAN 2.3b: "and (2.4)
  // by the Player"). Once one was waiting, made or failed while shown, a copy gone after is the person's doing (Cancel,
  // Clear), so the Player offers Make playback copy rather than undo it; a copy that vanishes mid-play is made again
  // below (onVideoError).
  const usable = videoId !== null && linked !== null && !missing;
  const [worked, setWorked] = useState<string | null>(null);
  if (videoId !== null && copy.kind !== 'none' && copy.kind !== 'unknown' && worked !== videoId) setWorked(videoId);
  useEffect(() => {
    if (usable && copy.kind === 'none' && worked !== videoId) makeCopy(videoId);
  }, [usable, videoId, copy.kind, worked]);

  // Made: found and opened.
  useEffect(() => {
    if (!usable || copy.kind !== 'made') return;
    let live = true;
    copyToPlay(videoId)
      .then((found) => {
        if (!live) return;
        if (found && found.url === broken?.url) setOpened(null);
        else if (found) setOpened({ videoId, ...found });
        // Gone since it was made: made again.
        else makeCopy(videoId);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `broken` is read, not watched: a Try again (tries) opens anew.
  }, [usable, videoId, copy.kind, tries]);

  const ready = usable && copy.kind === 'made' && opened?.videoId === videoId ? opened : null;
  const duration = recorded > 0 ? recorded : ready && copyFrames?.url === ready.url ? copyFrames.frames : 0;

  // While it plays, the frame from each frame shown, where the browser says; otherwise from the time updates.
  useEffect(() => {
    const element = videoRef.current;
    // An older webview without it updates the frame from the time updates alone.
    if (!playing || !element || !('requestVideoFrameCallback' in element)) return;
    let handle = 0;
    const next: VideoFrameRequestCallback = (_now, metadata) => {
      // A copy can run a little longer than the video's record: never past its last frame.
      const at = frameOfPresentation(metadata.mediaTime, fps);
      setFrame(duration > 0 ? Math.min(at, duration - 1) : at);
      handle = element.requestVideoFrameCallback(next);
    };
    handle = element.requestVideoFrameCallback(next);
    return () => {
      element.cancelVideoFrameCallback(handle);
    };
  }, [playing, fps, duration]);

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
            : copy.kind === 'made' && broken !== null
              ? { kind: 'failed', message: t('player.cantPlay') }
              : copy.kind === 'made'
                ? { kind: 'opening' }
              : copy.kind === 'queued' || copy.kind === 'making' || copy.kind === 'failed'
                ? copy
                  : { kind: 'none' };
  // The picture gone (a Clear, a Move, a relink) can't say it stopped: it isn't playing.
  if (status.kind !== 'ready' && playing) setPlaying(false);
  const video: PlayerVideo | null =
    clip && linked
      ? { name: linked.sourceName, fps, startTimecode: linked.startTimecode, durationFrames: duration, inFrame: clip.inFrame, outFrame: clip.outFrame }
      : null;

  /** The frame at a time of the copy, never past the video's last. */
  const frameAt = (seconds: number) => frameInVideo(seconds, fps, duration);
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
      if (!currentClip || currentClip.videoId !== videoId || !inVideo(at, duration)) return { changes: [] };
      const next = which === 'in' ? clipWithIn(currentClip, at) : clipWithOut(currentClip, at);
      // Where it is already: no edit, so no undo step for nothing.
      if (next.inFrame === currentClip.inFrame && next.outFrame === currentClip.outFrame) return { changes: [] };
      return { changes: [setClip(shotId, next)] };
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
        if (element.paused) {
          // Stopped on the last frame (played to the end): from the frame's in point again, as a replay.
          if (duration > 0 && frame >= duration - 1 && clip) seek(clip.inFrame);
          void element.play().catch(() => undefined);
        }
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
        if (broken !== null) {
          // Try again on a copy that couldn't be played: opened anew.
          setBroken(null);
          setTries((n) => n + 1);
        } else if (videoId) makeCopy(videoId);
      }}
      onTime={(event) => {
        // Paused, the frame is where it was put; a play moves it. Loaded, the <video> is put on the frame showing, and
        // a copy that plays earns another remake should it go missing later.
        const element = event.currentTarget;
        if (event.type === 'loadeddata') {
          element.currentTime = timeOfFrame(frame, fps);
          setRemadeFor(null);
          if (ready) setCopyFrames({ url: ready.url, frames: framesOfLength(element.duration, fps) });
        }
        else if (!element.paused) setFrame(frameAt(element.currentTime));
      }}
      onPlaying={(now) => {
        setPlaying(now);
        // Paused: the readout, the picture and the <video>'s time all settle on the frame it stopped in.
        const element = videoRef.current;
        if (!now && element) {
          // At the end the time is the video's whole length, a frame past its last: the last frame.
          const at = frameAt(element.currentTime);
          setFrame(at);
          element.currentTime = timeOfFrame(at, fps);
        }
      }}
      onVideoError={() => {
        // The copy went (the cap, a Move) or can't be read: made again once, and opened once it is; if it's still
        // there, the Player says it can't play it, with Try again.
        setBroken(opened && videoId ? { videoId, url: opened.url } : null);
        setOpened(null);
        setPlaying(false);
        if (videoId && remadeFor !== videoId) {
          setRemadeFor(videoId);
          copyMayBeGone(videoId);
        }
      }}
    />
  );
}
