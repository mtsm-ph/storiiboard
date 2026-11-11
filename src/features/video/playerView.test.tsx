import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlayerView, type PlayerStatus, type PlayerViewProps } from './PlayerView';

// The Player's view (2.4): what it says in place of a picture, and the picture with its scrubber, timecode and keys.

const video = { name: 'A001_C003_0101AB.MOV', fps: { num: 24000, den: 1001 }, startTimecode: '01:00:00:00', durationFrames: 48, inFrame: 12, outFrame: 35 };
const ready: PlayerStatus = { kind: 'ready', url: 'sbdcopy://localhost/copy.mp4', silent: false, quiet: false };
const render = (props: Partial<PlayerViewProps> = {}) =>
  renderToString(<PlayerView status={ready} video={video} frame={24} playing={false} {...props} />).replaceAll('<!-- -->', '');

describe('the Player tile (2.4)', () => {
  it('plays the copy, with the frame showing as timecode, its in and out, and the keys', () => {
    const html = render();
    expect(html).toContain('src="sbdcopy://localhost/copy.mp4"');
    expect(html).not.toContain(' controls');
    expect(html).toContain('01:00:01:00');
    expect(html).toMatch(/type="range"[^>]*max="47"[^>]*aria-label="Playhead"[^>]*aria-valuetext="01:00:01:00"[^>]*value="24"/);
    expect(html).toContain('In 01:00:00:12 · Out 01:00:01:11 · 24 frames');
    expect(html).toContain('Comma and period step a frame');
    // The playhead halfway along, in the accent and outlined, so not by colour alone.
    expect(html).toMatch(/data-playhead=""[^>]*border-text bg-accent[^>]*style="left:51\.0638/);
    expect(html).toMatch(/role="group" aria-label="Player"/);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Play</);
    expect(render({ playing: true })).toMatch(/aria-pressed="true"[^>]*>Pause</);
  });

  it('plays a board card’s video with step, play and pause, and says in and out and grab work on a storyboard frame (5.1b)', () => {
    const html = render({ cardOnly: true, onGrabStill: () => undefined });
    expect(html).toContain('data-player-card-only=""');
    expect(html).toContain('work on a storyboard frame');
    expect(html).toMatch(/aria-pressed="false"[^>]*>Play</);
    expect(html).toContain('aria-label="Next frame"');
    for (const hidden of ['Set in', 'Set out', 'Grab still', 'data-grab-still', 'In 01:00:00:12']) expect(html).not.toContain(hidden);
    // A frame's clip keeps all of them.
    expect(render({ onGrabStill: () => undefined })).toContain('data-grab-still');
  });

  it('says in words about the card when the board card being played is gone (5.1b)', () => {
    const html = render({ status: { kind: 'noCard' }, video: null });
    expect(html).toContain('This video card is no longer on its board');
    expect(html).not.toContain('This frame has no video');
  });

  it('says what stands in the picture’s place, in a live region that’s always there', () => {
    const says = (status: PlayerStatus, extra: Partial<PlayerViewProps> = {}) => render({ status, ...extra });
    expect(says({ kind: 'noProject' }, { video: null })).toContain('No project open.');
    expect(says({ kind: 'noFrame' }, { video: null })).toContain('Select a frame with a video to play it here.');
    expect(says({ kind: 'noVideo' }, { video: null })).toContain('This frame has no video.');
    expect(says({ kind: 'missing' })).toContain('Relink it from the inspector.');
    expect(says({ kind: 'making', done: 0.5 })).toMatch(/role="meter"[^>]*aria-valuenow="50"/);
    expect(says({ kind: 'opening' })).toContain('Opening the playback copy…');
    expect(says({ kind: 'none' })).toMatch(/<button[^>]*>Make playback copy</);
    expect(says({ kind: 'failed', message: 'That video couldn’t be made into a playback copy.' })).toMatch(/<button[^>]*>Try again</);
    expect(says({ kind: 'ready', url: 'x', silent: true, quiet: true })).toContain('every one of the video’s sound tracks is silent');
    // A copy the webview can't play: said, with Try again.
    expect(says({ kind: 'failed', message: 'This playback copy can’t be played here.' })).toMatch(/can’t be played here[\s\S]*<button[^>]*>Try again</);
    // The timecode isn't read out every frame: the playhead's value says it.
    expect(render()).toMatch(/<span data-player-timecode="" aria-hidden="true"/);
    for (const status of [{ kind: 'noFrame' }, { kind: 'none' }, ready] as PlayerStatus[]) {
      expect(says(status)).toContain('role="status" data-player-state=""');
    }
    // No picture, no scrubber or keys to offer.
    expect(says({ kind: 'none' })).not.toContain('type="range"');
  });

  it('draws the frame’s window over the take, with its keys, its zoom and Centre (2.6)', () => {
    const framed = (crop: { x: number; y: number; zoom: number }) =>
      render({ framing: { crop, imageAspect: 16 / 9, frameAspect: 2.39, onCommit: () => Promise.resolve(true), frameKey: 's1|v1' } });
    const html = framed({ x: 0.5, y: 0.5, zoom: 1 });
    // A 2.39 frame over a 16:9 take: the full width, a centred band of its height.
    expect(html).toMatch(/role="application" tabindex="0" aria-label="The frame’s window over the take, zoom 100%"[^>]*data-frame-window=""[^>]*style="left:0%;top:12\.8/);
    expect(html).toContain('The bright window is what the frame shows.');
    expect(html).toMatch(/<label[^>]*>Framing<\/label>/);
    expect(html).toMatch(/max="400"[^>]*value="100"/);
    // Centred: nothing for Centre to do.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Centre</);
    const zoomed = framed({ x: 0.3, y: 0.6, zoom: 2 });
    expect(zoomed).toContain('zoom 200%');
    expect(zoomed).not.toMatch(/<button[^>]*disabled=""[^>]*>Centre</);
    // Without framing (a frame that can't be framed yet), the picture alone.
    expect(render()).not.toContain('data-frame-window');
  });
});
