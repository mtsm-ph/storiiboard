import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../core/i18n';
import { sceneFields, shotFields } from '../../core/model/storyboard';
import { departmentStates, departmentStatuses } from '../../core/model/departmentStatus';
import { DepartmentStatusTable } from './DepartmentStatusTable';
import { sceneApprovals } from '../../core/model/sceneApprovals';
import { SceneApprovalTable } from './SceneApprovalTable';
import { summaryText } from './DepartmentSummary';
import { RestOfCrew } from '../department/RestOfCrew';
import { focusOf, splitByFocus } from '../department/perspective';
import { DEPARTMENTS } from '../../core/model/department';
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
    // Approved is the scene's (3.6b): a frame's columns end at Done.
    expect(html).not.toContain('Camera: Approved');
    expect(html).toContain('value="1 3/8"');
  });

  it('keeps a value typed elsewhere visible, rather than dropping it', () => {
    const odd = { ...shot, fields: shotFields({ number: '4B', support: 'technocrane' }) };
    const html = renderToString(
      <InspectorView scene={scene} shot={odd} otherSceneNumbers={[]} onShotChange={noop} onSceneChange={noop} onSceneNumberChange={noop} onBack={noop} />,
    );
    expect(html).toMatch(/<option value="technocrane" selected="">Technocrane<\/option>/);
  });

  it('shows a director or DP their own sign-off on a scene: ticked when current, mixed when only someone else’s is (3.6b)', () => {
    const approvals = sceneApprovals({ department_approvals: { camera: [{ name: 'Kevin Matos', roles: ['director'], at: 'x', basis: 'now' }] } });
    const approved = (roles: readonly ('director' | 'dp')[], basis = 'now') =>
      /aria-checked="([a-z]+)" aria-label="Camera: Approved"/.exec(
        renderToString(<SceneApprovalTable scene="SC 04" approvals={approvals} basisOf={() => ({ current: basis, v2: basis, legacy: basis })} departments={['camera']} myRoles={roles} onApprove={noop} />),
      )?.[1];
    expect(approved(['director'])).toBe('true');
    expect(approved(['dp'])).toBe('mixed');
    expect(approved(['director', 'dp'])).toBe('true');
    // Someone who doesn't approve sees whether it's approved.
    expect(approved([])).toBe('true');
    // Once the scene has changed, nobody's box is ticked: the director's gives it again.
    expect(approved(['director'], 'later')).toBe('false');
    expect(approved([], 'later')).toBe('false');
  });

  it('says a changed approval in words, and why someone who doesn’t approve can’t tick it (3.6b)', () => {
    const approvals = sceneApprovals({ department_approvals: { camera: [{ name: 'Kevin Matos', roles: ['dp'], at: 'x', basis: 'then' }] } });
    const html = renderToString(
      <SceneApprovalTable scene="SC 04" approvals={approvals} basisOf={() => ({ current: 'now', v2: 'now', legacy: 'now' })} departments={['direction', 'camera']} myRoles={[]} onApprove={noop} />,
    );
    expect(html).toContain('aria-label="Department approvals for SC 04"');
    expect(html).toContain('Changed since approval');
    expect(html).toContain('approved by Kevin Matos (DP) before the change');
    expect(html).toMatch(/aria-disabled="true" title="Only the director or the DP approves\."/);
    expect(html).toContain('Set your role on this project in Settings → Project.');
    // One Tab stop, on the first row.
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toMatch(/data-approval-row="0" data-approval-department="direction" tabindex="0"/);
  });

  it('opens a department’s workspace from its name, a cell left of Priority, the Tab stop still on Priority (3.6a)', () => {
    const statuses = departmentStatuses({});
    const html = renderToString(
      <DepartmentStatusTable statuses={statuses} seen={[]} onEdit={noop} onOpen={noop} />,
    );
    expect(html).toContain('aria-label="Camera: open its workspace"');
    expect(html).toMatch(/data-cell="0-0" data-open-department="direction" tabindex="-1"/);
    // The one Tab stop is the first row's Priority, as it was before the names opened anything.
    expect(html).toMatch(/aria-label="Direction: Priority" title="Direction: Priority" data-cell="0-1" tabindex="0"/);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    // Without it, the names are plain text, and one department's row alone when asked.
    const plain = renderToString(<DepartmentStatusTable statuses={statuses} seen={[]} onEdit={noop} only="sound" />);
    expect(plain).not.toContain('data-open-department');
    expect(plain.match(/role="row"/g)).toHaveLength(2);
    expect(plain).toContain('Sound: Priority');
    expect(plain).not.toContain('Camera: Priority');
  });
});

describe('a focus view (3.6c)', () => {
  const statuses = departmentStatuses({ department_status: { camera: { done: true }, sound: { priority: true }, art: { working: true } } });

  it('splits the departments into yours and the rest, only when there are both', () => {
    expect(splitByFocus(['direction', 'camera', 'sound'], ['camera'])).toEqual({ mine: ['camera'], rest: ['direction', 'sound'] });
    expect(splitByFocus(['direction', 'camera'], null)).toBeNull();
    expect(splitByFocus(['camera'], ['camera'])).toBeNull();
  });

  it('shows the folded list with yours first, the rest closed under Rest of crew, and the key once', () => {
    const html = renderToString(
      <RestOfCrew
        fold="frame"
        departments={['direction', 'camera', 'sound']}
        focus={['camera']}
        render={(rows, part, last) => (
          <DepartmentStatusTable statuses={statuses} seen={[]} onEdit={noop} rows={rows} label={part} legend={last} />
        )}
      />,
    );
    expect(html).toContain('aria-label="mine"');
    expect(html).toContain('Camera: Done');
    expect(html).not.toContain('Sound: Priority');
    expect(html).toMatch(/aria-expanded="false"[^>]*data-rest-of-crew="frame"/);
    expect(html).toContain('Rest of crew');
    expect(html).toContain('2 departments');
    expect(html.match(/aria-label="Key"/g)).toHaveLength(1);
  });

  it('puts your departments first only when there is something to fold', () => {
    expect(focusOf({ fullView: false, departments: ['camera'] })).toEqual(['camera']);
    expect(focusOf({ fullView: true, departments: ['camera'] })).toBeNull();
    expect(focusOf({ fullView: false, departments: [] })).toBeNull();
    expect(focusOf({ fullView: false, departments: DEPARTMENTS })).toBeNull();
  });

  it('lists your departments alone in the shot list’s words', () => {
    expect(departmentStates(statuses, [], ['camera', 'hmu']).map((r) => r.department)).toEqual(['camera']);
    expect(departmentStates(statuses, []).map((r) => r.department)).toEqual(['sound', 'camera', 'art']);
  });

  it('counts your departments alone on a frame card, and says so', () => {
    expect(summaryText(statuses, ['art'])).toBe('Departments: 1 priority, 1 seen, 1 working on it and 1 done');
    expect(summaryText(statuses, ['art'], ['camera'])).toBe('Your departments: 1 done');
    expect(summaryText(statuses, [], ['hmu'])).toBeNull();
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

  it('offers Save clip as file, and while it saves the same button cancels it', () => {
    const withSave = (saving: boolean) =>
      renderToString(
        <InspectorView
          scene={scene}
          shot={shot}
          otherSceneNumbers={[]}
          onShotChange={noop}
          onSceneChange={noop}
          onSceneNumberChange={noop}
          onBack={noop}
          video={video}
          onSaveClip={noop}
          savingClip={saving}
          onCancelSaveClip={noop}
        />,
      );
    // One button either way, never disabled, so focus stays on it from Save to Cancel.
    const idle = withSave(false).match(/<button[^>]*data-save-clip=""[^>]*>([^<]*)<\/button>/);
    const busy = withSave(true).match(/<button[^>]*data-save-clip=""[^>]*>([^<]*)<\/button>/);
    expect(idle?.[1]).toBe('Save clip as file…');
    expect(busy?.[1]).toBe('Cancel saving clip');
    expect(busy?.[0]).not.toMatch(/ disabled=|aria-disabled="true"/);
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
      // Every sound track silent (2.3c): said so, not taken for sound that couldn't be read.
      expect(withCopy({ state: 'made', silent: true, quiet: true })).toContain('Playback copy ready, without sound: every one of the video’s sound tracks is silent.');
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
