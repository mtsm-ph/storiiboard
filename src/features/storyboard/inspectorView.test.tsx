import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../core/i18n';
import { sceneFields, shotFields } from '../../core/model/storyboard';
import { departmentStatuses } from '../../core/model/departmentStatus';
import { DepartmentStatusTable } from './DepartmentStatusTable';
import { InspectorView, type InspectorCopy } from './InspectorView';

const noop = () => undefined;
const scene = { id: 'sc4', fields: sceneFields({ number: '4', name: 'Penn Station', int_ext: 'INT', day_night: 'DAY', page_eighths: 11 }) };
const shot = {
  id: '4b',
  fields: shotFields({ number: '4B', size: 'MCU', lens_mm: 35, t_stop: 2, move: 'push in', status: 'need', departments: ['camera', 'sound'] }),
};

describe('the Frame inspector', () => {
  it('asks for a selection when there is none', () => {
    const html = renderToString(
      <InspectorView scene={null} shot={null} otherSceneNumbers={[]} onShotChange={noop} onSceneChange={noop} onSceneNumberChange={noop} onBack={noop} />,
    );
    expect(html).toContain('Select a frame or a scene');
  });

  it('shows the frame’s camera, status, story and departments, then its scene', () => {
    const html = renderToString(
      <InspectorView scene={scene} shot={shot} otherSceneNumbers={['5']} onShotChange={noop} onSceneChange={noop} onSceneNumberChange={noop} onBack={noop} />,
    );
    expect(html).toContain('>4B</p>');
    expect(html).toContain('SC 04 · INT. PENN STATION — DAY');
    expect(html).toMatch(/aria-checked="true"[^>]*>MCU</);
    expect(html).toContain('value="35"');
    expect(html).toMatch(/<option value="2" selected="">T2\.0<\/option>/);
    expect(html).toMatch(/aria-checked="true"[^>]*>Need</);
    // An older frame's departments read as Priority (polish 6): ticked, and listed first.
    expect(html).toMatch(/role="checkbox" aria-checked="true" aria-label="Camera: Priority"/);
    expect(html).toMatch(/role="checkbox" aria-checked="false" aria-label="Art: Priority"/);
    expect(html.indexOf('Sound: Priority')).toBeLessThan(html.indexOf('Direction: Priority'));
    // No role that approves: Approved says so, rather than hiding.
    expect(html).toMatch(/aria-disabled="true" title="Only the director or the DP approves\."/);
    expect(html).toContain('Set your role on this project in Settings → Project.');
    expect(html).toContain('value="1 3/8"');
  });

  it('keeps a value typed elsewhere visible, rather than dropping it', () => {
    const odd = { ...shot, fields: shotFields({ number: '4B', support: 'technocrane' }) };
    const html = renderToString(
      <InspectorView scene={scene} shot={odd} otherSceneNumbers={[]} onShotChange={noop} onSceneChange={noop} onSceneNumberChange={noop} onBack={noop} />,
    );
    expect(html).toMatch(/<option value="technocrane" selected="">Technocrane<\/option>/);
  });

  it('shows a director or DP their own sign-off on Approved: ticked when given, mixed when only someone else has', () => {
    const statuses = departmentStatuses({ department_status: { camera: { approvals: [{ name: 'Kevin Matos', roles: ['director'], at: 'x' }] } } });
    const approved = (roles: readonly ('director' | 'dp')[]) =>
      /aria-checked="([a-z]+)" aria-label="Camera: Approved"/.exec(
        renderToString(<DepartmentStatusTable statuses={statuses} seen={[]} approval={() => null} myRoles={roles} onEdit={noop} />),
      )?.[1];
    expect(approved(['director'])).toBe('true');
    expect(approved(['dp'])).toBe('mixed');
    expect(approved(['director', 'dp'])).toBe('true');
    // Someone who doesn't approve sees whether it's approved.
    expect(approved([])).toBe('true');
  });
});

describe('the Frame inspector’s Video section (2.2b)', () => {
  const video = {
    name: 'C0042.MP4',
    details: '23.976 fps · 3840 × 2160 · H264',
    range: '01:00:00:00 – 01:00:01:23',
    frames: '48 frames',
    path: 'Footage/C0042.MP4',
    missing: false,
    gone: false,
  };
  const render = (v: typeof video) =>
    renderToString(
      <InspectorView scene={scene} shot={shot} otherSceneNumbers={[]} onShotChange={noop} onSceneChange={noop} onSceneNumberChange={noop} onBack={noop} video={v} />,
    );

  it('reads the file, its rate and size, and the clip’s timecode, with Relink and Unlink', () => {
    const html = render(video);
    expect(html).toContain('C0042.MP4');
    expect(html).toContain('23.976 fps · 3840 × 2160 · H264');
    expect(html).toContain('01:00:00:00 – 01:00:01:23 · 48 frames');
    expect(html).toContain('Relink…');
    expect(html).toContain('Unlink video');
    // The live region is there before anything is missing, so the line is heard when it appears.
    expect(html).toMatch(/<div role="status" class="flex"><\/div>/);
  });

  it('says plainly when the file is missing, and makes Relink the way back', () => {
    const html = render({ ...video, missing: true });
    expect(html).toContain('Can’t be found or read on this computer. Relink to point at it again.');
    expect(html).toMatch(/<div role="status"[^>]*><p[^>]*bg-warning[^>]*>/);
    expect(html).toMatch(/<button[^>]*class="[^"]*bg-accent[^"]*"[^>]*data-relink-video=""/);
  });

  it('leaves only Unlink for a clip whose video is gone from the project', () => {
    const html = render({ ...video, missing: true, gone: true });
    expect(html).toContain('The video this frame played isn’t in the project any more.');
    expect(html).not.toContain('Relink…');
    expect(html).toContain('Unlink video');
  });

  describe('its playback copy (2.3b)', () => {
    const withCopy = (copy: InspectorCopy, extra: Partial<typeof video> = {}) => render({ ...video, ...extra, copy } as typeof video);

    it('says there’s none yet, and offers to make it', () => {
      const html = withCopy({ state: 'none' });
      expect(html).toContain('No playback copy yet.');
      expect(html).toMatch(/data-make-copy=""[^>]*>Make playback copy</);
      expect(html).not.toContain('data-cancel-copy');
    });

    it('says it waits its turn, or how far along it is, with Cancel', () => {
      const queued = withCopy({ state: 'queued' });
      expect(queued).toContain('Waiting its turn for a playback copy.');
      expect(queued).toMatch(/data-cancel-copy=""[^>]*>Cancel copy</);
      expect(queued).not.toContain('data-make-copy');
      const making = withCopy({ state: 'making', done: 0.42 });
      expect(making).toContain('Making the playback copy…');
      // The percentage is a meter, outside the live region, so it isn't read out every half second.
      expect(making).toMatch(/role="meter"[^>]*aria-valuenow="42"/);
      expect(making).not.toMatch(/role="status"[^>]*>(?:(?!<\/div>).)*42%/);
      // A video whose length isn't known says only that it's being made.
      expect(withCopy({ state: 'making', done: null })).not.toContain('role="meter"');
    });

    it('says it’s ready, and says so when it has no sound', () => {
      expect(withCopy({ state: 'made', silent: false })).toContain('Playback copy ready.');
      expect(withCopy({ state: 'made', silent: true })).toContain('Playback copy ready, without sound: the video’s sound couldn’t be read.');
      expect(withCopy({ state: 'made', silent: false })).not.toContain('data-make-copy');
    });

    afterEach(() => {
      setLocale('en');
    });

    it('says why it failed, in the app’s words, with Try again', () => {
      // Rust's own words, straight apostrophes and all: shown in the app's language.
      const stalled = "That video stopped being read partway. If it's on a card, a drive or a network share, check it's still connected.";
      const html = withCopy({ state: 'failed', message: stalled });
      expect(html).toMatch(/<div role="status" data-copy-state=""[^>]*><p[^>]*bg-warning[^>]*>That video stopped being read partway/);
      expect(html).toMatch(/data-make-copy=""[^>]*>Try again</);
      setLocale('es');
      expect(withCopy({ state: 'failed', message: stalled })).toContain('Ese video dejó de leerse a mitad de camino.');
    });

    it('has one button for the copy, whatever its job', () => {
      // One place for Make playback copy and Cancel copy. That React keeps the one element, and focus with it, as the
      // job changes can't be seen in a page drawn once: the end-to-end test of a copy (e2e/video.spec.ts) checks it.
      const button = (html: string) => /<button[^>]*data-(?:make|cancel)-copy=""[^>]*>[^<]*</g.exec(html)?.[0] ?? '';
      expect(button(withCopy({ state: 'none' }))).toContain('Make playback copy');
      expect(button(withCopy({ state: 'making', done: 0.1 }))).toContain('Cancel copy');
      expect(withCopy({ state: 'making', done: 0.1 }).match(/data-(?:make|cancel)-copy=""/g)).toHaveLength(1);
      // Where focus goes when it goes: the copy's line, which a script can focus and Tab never stops on.
      expect(withCopy({ state: 'made', silent: false })).toMatch(/<div tabindex="-1" data-copy-line=""/);
    });

    it('stays out of the way of a missing video, whose way back is Relink', () => {
      const html = withCopy({ state: 'none' }, { missing: true });
      expect(html).not.toContain('No playback copy yet.');
      expect(html).not.toContain('data-make-copy');
      // The live region stays, so the line is heard when it comes back.
      expect(html).toContain('data-copy-state=""');
    });
  });
});
