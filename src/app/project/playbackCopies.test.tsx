import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CopiesInfo } from '../playback';
import { CAP_GB, decimalSize, FLOOR_GB, parseGb, PlaybackCopiesView, type PlaybackCopiesViewProps } from './PlaybackCopies';

// Settings → Storage, for this computer (2.3b): the playback copies, the videos it remembers, FFmpeg's licences.

const noop = () => undefined;
const info: CopiesInfo = {
  folder: '/Users/kevin/Library/Caches/app.storiiboard.desktop/Storiiboard Playback Copies',
  bytes: 12_400_000_000,
  copies: 7,
  capGb: 50,
  floorGb: 10,
  freeBytes: 213_700_000_000,
  fallback: false,
  moved: false,
  busy: false,
};
/** The page as drawn, without React's markers between adjacent pieces of text. */
const render = (props: Partial<PlaybackCopiesViewProps> = {}) =>
  renderToString(
    <PlaybackCopiesView
      info={info}
      queue={{ name: null, done: null, waiting: 0 }}
      known={3}
      moving={false}
      onCapChange={noop}
      onFloorChange={noop}
      onMove={noop}
      onMoveBack={noop}
      onClear={noop}
      onForget={noop}
      onLicences={noop}
      {...props}
    />,
  ).replaceAll('<!-- -->', '');

describe('sizes and whole GB', () => {
  it('counts in decimal GB, as the cap and the floor do, never in KB', () => {
    expect(decimalSize(12_400_000_000)).toBe('12.4 GB');
    expect(decimalSize(640_200_000)).toBe('640.2 MB');
    expect(decimalSize(1200)).toBe('0.0 MB');
  });

  it('takes a whole number in range, grouped as the app’s language writes it, and nothing else', () => {
    expect(parseGb('80', CAP_GB.min, CAP_GB.max)).toBe(80);
    expect(parseGb(' 10,000 ', CAP_GB.min, CAP_GB.max, 'en')).toBe(10_000);
    // Spanish groups thousands with a point and writes decimals with a comma.
    expect(parseGb('10.000', CAP_GB.min, CAP_GB.max, 'es')).toBe(10_000);
    expect(parseGb('12,5', FLOOR_GB.min, FLOOR_GB.max, 'es')).toBeNull();
    expect(parseGb('12.5', FLOOR_GB.min, FLOOR_GB.max, 'en')).toBeNull();
    expect(parseGb('-5', FLOOR_GB.min, FLOOR_GB.max)).toBeNull();
    expect(parseGb('10001', CAP_GB.min, CAP_GB.max)).toBeNull();
    expect(parseGb('0', FLOOR_GB.min, FLOOR_GB.max)).toBeNull();
    expect(parseGb('1001', FLOOR_GB.min, FLOOR_GB.max)).toBeNull();
    expect(parseGb('12.5', FLOOR_GB.min, FLOOR_GB.max)).toBeNull();
    expect(parseGb('', FLOOR_GB.min, FLOOR_GB.max)).toBeNull();
  });
});

describe('Settings → Storage: playback copies (2.3b)', () => {
  it('says how many copies, what they take of the cap, where they are and what the drive has free', () => {
    const html = render();
    expect(html).toContain('7 copies, <span class="font-mono">12.4 GB</span>, of a <span class="font-mono">50 GB</span> cap.');
    expect(html).toMatch(/role="meter"[^>]*aria-valuemax="50000000000"[^>]*aria-valuenow="12400000000"/);
    expect(html).toContain('Storiiboard Playback Copies');
    expect(html).toContain('<span class="font-mono">213.7 GB</span> free on this drive; copies always leave <span class="font-mono">10 GB</span> free.');
    expect(html).toContain('value="50"');
    expect(html).toContain('value="10"');
    expect(html).toContain('Move to another drive…');
    expect(html).not.toContain('Move back to this computer');
  });

  it('reads while it’s read, and says there are none yet', () => {
    expect(render({ info: null })).toContain('Measuring…');
    expect(render({ info: null })).not.toContain('Clear playback copies');
    const none = render({ info: { ...info, copies: 0, bytes: 0 } });
    expect(none).toContain('No playback copies yet.');
    expect(none).not.toContain('role="meter"');
    expect(none).toMatch(/<button[^>]*disabled=""[^>]*>Clear playback copies…/);
  });

  it('says when the drive they were moved to isn’t there, offers to move them back, and when free space can’t be told', () => {
    const html = render({ info: { ...info, moved: true, fallback: true, freeBytes: null } });
    expect(html).toContain('The drive they were moved to isn’t connected: copies go to this computer’s cache folder until it’s back.');
    expect(html).toContain('Move back to this computer');
    expect(html).toContain('This drive doesn’t say what it has free, so copies can’t keep <span class="font-mono">10 GB</span> free on it.');
  });

  it('says which copy is being made, how far along, and how many wait', () => {
    const html = render({ queue: { name: 'A001_C003_0101AB.MOV', done: 0.42, waiting: 2 } });
    expect(html).toContain('Making a playback copy of <span data-user-text="" class="font-mono">A001_C003_0101AB.MOV</span>: 42%. 2 more waiting.');
    expect(render({ queue: { name: 'C0042.MP4', done: null, waiting: 0 } })).toContain('Making a playback copy of <span data-user-text="" class="font-mono">C0042.MP4</span>.');
  });

  it('keeps the Move button focusable while it runs, and says so', () => {
    const button = /<button[^>]*>Moving…/.exec(render({ moving: true }))?.[0] ?? '';
    expect(button).toMatch(/aria-disabled="true"[^>]*aria-busy="true"/);
    expect(button).not.toContain(' disabled=""');
  });

  it('says why when the copies can’t be read, and still offers to move them back', () => {
    const html = render({ info: null, infoError: "Playback copies can't be written in that folder." });
    expect(html).not.toContain('Measuring…');
    expect(html).toContain('t be written in that folder.');
    expect(html).toContain('Move back to this computer');
    expect(html).not.toContain('Clear playback copies');
  });

  it('counts the videos this computer remembers, with Forget, and offers FFmpeg’s licences', () => {
    expect(render()).toContain('3 videos remembered.');
    expect(render({ known: 1 })).toContain('1 video remembered.');
    expect(render({ known: null })).toContain('Counting…');
    const none = render({ known: 0 });
    expect(none).toContain('No videos remembered.');
    expect(none).toMatch(/<button[^>]*disabled=""[^>]*>Forget remembered videos…/);
    expect(render()).toContain('Licences…');
    expect(render()).toContain('GNU LGPL 2.1 or later');
  });
});
