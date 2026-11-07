import { useId, type KeyboardEvent, type Ref, type SyntheticEvent } from 'react';
import { localizeError, t, tn } from '../../core/i18n';
import { frameTimecode, type Rational } from '../../core/media/timecode';
import { Button } from '../../ui/Button';
import { BarGauge } from '../../ui/fields';

// The Player tile (2.4): the selected frame's video, played from its playback copy (never the original, CLAUDE.md),
// with a scrubber, the frame's in and out, and the keys an editor expects: comma and period step a frame, I and O set
// in and out, Space plays and pauses. This part only draws; PlayerTile does the rest.

/** What the Player has to show. */
export type PlayerStatus =
  | { kind: 'noProject' }
  | { kind: 'noFrame' }
  | { kind: 'noVideo' }
  | { kind: 'missing' }
  | { kind: 'none' }
  | { kind: 'queued' }
  | { kind: 'making'; done: number | null }
  | { kind: 'failed'; message: string }
  /** Made: being found and opened. */
  | { kind: 'opening' }
  /** Ready to play from `url`; `quiet` or `silent`: without sound, and why. */
  | { kind: 'ready'; url: string; silent: boolean; quiet: boolean };

export interface PlayerVideo {
  name: string;
  fps: Rational;
  startTimecode: string | null;
  durationFrames: number;
  inFrame: number;
  outFrame: number;
}

export interface PlayerViewProps {
  status: PlayerStatus;
  video: PlayerVideo | null;
  /** The frame showing. */
  frame: number;
  playing: boolean;
  videoRef?: Ref<HTMLVideoElement>;
  onPlayPause?: () => void;
  onStep?: (delta: number) => void;
  onSeek?: (frame: number) => void;
  onSetIn?: () => void;
  onSetOut?: () => void;
  onMakeCopy?: () => void;
  /** The <video>'s own events: its time, its play state, an error (a copy gone missing). */
  onTime?: (event: SyntheticEvent<HTMLVideoElement>) => void;
  onPlaying?: (playing: boolean) => void;
  onVideoError?: () => void;
}

/**
 * The keys, on the whole tile, unless a button takes them itself. The comma and period characters step a frame, wherever
 * a layout puts them (an AZERTY's period wants Shift); Shift on the comma or period key steps ten, whatever it types
 * then (">" in English, ":" in German). I and O also by their key, for a layout that types other letters there. A key
 * held down repeats a step, never an in or out point or a play.
 */
function playerKeys(event: KeyboardEvent, props: PlayerViewProps): void {
  if (event.metaKey || event.ctrlKey || event.altKey || event.nativeEvent.isComposing || props.status.kind !== 'ready') return;
  const target = event.target as HTMLElement;
  const key = event.key.toLowerCase();
  const act = (run: (() => void) | undefined) => {
    event.preventDefault();
    run?.();
  };
  const step = key === ',' ? -1 : key === '.' ? 1 : event.shiftKey && event.code === 'Comma' ? -10 : event.shiftKey && event.code === 'Period' ? 10 : 0;
  if (step !== 0) {
    act(() => props.onStep?.(step));
    return;
  }
  if (event.repeat || event.shiftKey) return;
  if (key === 'i' || event.code === 'KeyI') act(props.onSetIn);
  else if (key === 'o' || event.code === 'KeyO') act(props.onSetOut);
  // Space on a button presses the button; anywhere else in the Player, it plays or pauses.
  else if (key === ' ' && target.tagName !== 'BUTTON') act(props.onPlayPause);
}

export function PlayerView(props: PlayerViewProps) {
  const { status, video, frame, playing } = props;
  const helpId = useId();
  const tc = (index: number) => (video ? frameTimecode(index, video.fps, video.startTimecode) : '');
  const last = video ? Math.max(0, video.durationFrames - 1) : 0;
  const at = (index: number) => `${String(last > 0 ? (index / last) * 100 : 0)}%`;
  return (
    // A group the keys work anywhere in, whichever of its controls has focus (the scrubber, a button). jsx-a11y counts
    // a group as non-interactive; its own controls are the interactive parts, and the keys only add shortcuts to them.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      role="group"
      aria-label={t('tile.player.title')}
      aria-describedby={status.kind === 'ready' ? helpId : undefined}
      data-player=""
      className="flex h-full min-h-0 flex-col gap-2 p-3"
      onKeyDown={(event) => {
        playerKeys(event, props);
      }}
    >
      {video && (
        <p data-user-text="" className="truncate font-mono text-[12px] font-bold" title={video.name}>
          {video.name}
        </p>
      )}
      <PlayerScreen {...props} />
      {status.kind === 'ready' && video && (
        <>
          <div className="relative h-[22px]">
            <input
              type="range"
              min={0}
              max={last}
              step={1}
              value={frame}
              aria-label={t('player.playhead')}
              aria-valuetext={tc(frame)}
              aria-describedby={helpId}
              onChange={(event) => props.onSeek?.(Number(event.target.value))}
              className="peer absolute inset-0 z-10 m-0 w-full cursor-pointer opacity-0"
            />
            <div aria-hidden="true" className="absolute inset-x-0 top-[10px] border-t border-text" />
            {/* The frame's clip, in to out: an ink band on the rule. */}
            <div
              aria-hidden="true"
              data-player-clip=""
              className="absolute top-[7px] h-[7px] bg-text"
              style={{ left: at(video.inFrame), width: `calc(${at(video.outFrame)} - ${at(video.inFrame)} + 2px)` }}
            />
            {/* The playhead: the accent, outlined in ink so it never relies on colour alone. */}
            <div
              aria-hidden="true"
              data-playhead=""
              className="absolute top-0 -ml-[3px] h-[22px] w-[6px] border border-text bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-text"
              style={{ left: at(frame) }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button aria-label={t('player.previousFrame')} onClick={() => props.onStep?.(-1)}>
              ,
            </Button>
            <Button variant="primary" aria-pressed={playing} onClick={props.onPlayPause}>
              {playing ? t('player.pause') : t('player.play')}
            </Button>
            <Button aria-label={t('player.nextFrame')} onClick={() => props.onStep?.(1)}>
              .
            </Button>
            <Button onClick={props.onSetIn}>{t('player.setIn')}</Button>
            <Button onClick={props.onSetOut}>{t('player.setOut')}</Button>
            {/* Not a live region: it changes every frame while playing. The playhead's own value says it to a screen reader. */}
            <span data-player-timecode="" aria-hidden="true" className="ml-auto font-mono text-[13px] font-bold">
              {tc(frame)}
            </span>
          </div>
          <p className="font-mono text-[11px] text-text-muted">
            {t('player.inOut', { in: tc(video.inFrame), out: tc(video.outFrame), frames: tn('count.frames', video.outFrame - video.inFrame + 1) })}
          </p>
          <p id={helpId} className="text-[11px] text-text-muted">
            {t('player.keys')}
          </p>
        </>
      )}
    </div>
  );
}

/** The picture, or what stands in its place, with a live region that says why. */
function PlayerScreen({ status, videoRef, onTime, onPlaying, onVideoError, onMakeCopy }: PlayerViewProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      {status.kind === 'ready' ? (
        <div className="flex min-h-0 flex-1 items-center justify-center bg-ink-fixed">
          {/* No native controls: the Player's own, keyboard first. Camera footage carries no captions to give it. */}
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            ref={videoRef}
            src={status.url}
            preload="auto"
            playsInline
            aria-label={t('player.picture')}
            className="max-h-full max-w-full"
            onTimeUpdate={onTime}
            onSeeked={onTime}
            onLoadedData={onTime}
            onPlay={() => onPlaying?.(true)}
            onPause={() => onPlaying?.(false)}
            onEnded={() => onPlaying?.(false)}
            onError={onVideoError}
          />
        </div>
      ) : (
        <div className="flex min-h-[80px] flex-1 items-center justify-center border border-dashed border-text-muted" />
      )}
      {/* Always there, so the line is heard as it changes. */}
      <div role="status" data-player-state="" className="flex flex-col gap-1.5">
        {status.kind === 'noProject' && <p className="text-[12px] text-text-muted">{t('player.noProject')}</p>}
        {status.kind === 'noFrame' && <p className="text-[12px] text-text-muted">{t('player.noFrame')}</p>}
        {status.kind === 'noVideo' && <p className="text-[12px] text-text-muted">{t('player.noVideo')}</p>}
        {status.kind === 'missing' && (
          <p className="inline-block self-start bg-warning px-[7px] py-1 text-[12px] text-paper-fixed">{t('player.missing')}</p>
        )}
        {status.kind === 'none' && <p className="text-[12px] text-text-muted">{t('inspector.copyNone')}</p>}
        {status.kind === 'queued' && <p className="text-[12px]">{t('inspector.copyQueued')}</p>}
        {status.kind === 'making' && <p className="text-[12px]">{t('inspector.copyMaking')}</p>}
        {status.kind === 'opening' && <p className="text-[12px] text-text-muted">{t('player.opening')}</p>}
        {status.kind === 'failed' && (
          <p className="inline-block self-start bg-warning px-[7px] py-1 text-[12px] text-paper-fixed">{localizeError(status.message)}</p>
        )}
        {status.kind === 'ready' && status.quiet && <p className="text-[12px] text-text-muted">{t('player.quiet')}</p>}
        {status.kind === 'ready' && status.silent && !status.quiet && <p className="text-[12px] text-text-muted">{t('player.silent')}</p>}
      </div>
      {status.kind === 'making' && status.done !== null && <BarGauge label={t('inspector.copyProgress')} value={Math.round(status.done * 100)} />}
      {(status.kind === 'none' || status.kind === 'failed') && (
        <Button className="self-start" onClick={onMakeCopy}>
          {status.kind === 'failed' ? t('inspector.copyTryAgain') : t('inspector.makeCopy')}
        </Button>
      )}
    </div>
  );
}
