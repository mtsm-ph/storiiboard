import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BackupsView, parseKeep, placeNote } from './BackupsView';

const noop = () => undefined;
const keep = { recent: 12, days: 14 };

describe('the Backups tile', () => {
  it('takes only whole numbers in range for the keep settings', () => {
    expect(parseKeep('30', 'recent')).toBe(30);
    expect(parseKeep(' 7 ', 'days')).toBe(7);
    expect(parseKeep('0', 'days')).toBe(0);
    expect(parseKeep('0', 'recent')).toBeNull();
    expect(parseKeep('2.5', 'days')).toBeNull();
    expect(parseKeep('-1', 'days')).toBeNull();
    expect(parseKeep('999', 'days')).toBeNull();
    expect(parseKeep('twelve', 'recent')).toBeNull();
  });

  it('lists the open project’s backups in local time, each opening as a separate project', () => {
    const html = renderToString(
      <BackupsView
        keep={keep}
        onKeepChange={noop}
        project={{
          folder: '/Films/Backups',
          backups: [
            { name: 'Bey County 2026-11-02 14-05.sbd', at: new Date(2026, 10, 2, 14, 5) },
            { name: 'Bey County 2026-11-02 13-55.sbd', at: new Date(2026, 10, 2, 13, 55) },
          ],
          synced: null,
        }}
        nextToProject={false}
        onNextToProjectChange={noop}
        status={null}
        onBackUpNow={noop}
        onShowBackups={noop}
        onOpen={noop}
      />,
    );
    expect(html).toContain('/Films/Backups');
    expect(html.indexOf('2026-11-02 14:05')).toBeLessThan(html.indexOf('2026-11-02 13:55'));
    expect(html).toContain('aria-label="Open the 2026-11-02 14:05 backup as a separate project"');
    expect(html).toContain('value="12"');
    expect(html).toContain('value="14"');
  });

  it('tells apart two backups from the same minute, on screen and to a screen reader', () => {
    const at = new Date(2026, 10, 4, 18, 30);
    const html = renderToString(
      <BackupsView
        keep={keep}
        onKeepChange={noop}
        project={{
          folder: '/Films/Backups',
          backups: [
            { name: 'Bey County 2026-11-04 18-30 (2).sbd', at, copy: 2 },
            { name: 'Bey County 2026-11-04 18-30.sbd', at, copy: 1 },
          ],
          synced: null,
        }}
        nextToProject={false}
        onNextToProjectChange={noop}
        status={null}
        onBackUpNow={noop}
        onShowBackups={noop}
        onOpen={noop}
      />,
    );
    expect(html).toContain('aria-label="Open the 2026-11-04 18:30 (2) backup as a separate project"');
    expect(html).toContain('aria-label="Open the 2026-11-04 18:30 backup as a separate project"');
    expect(html.indexOf('18:30 (2)')).toBeLessThan(html.indexOf('aria-label="Open the 2026-11-04 18:30 backup'));
  });

  it('keeps the settings editable with no project open, since they apply to every project', () => {
    const html = renderToString(
      <BackupsView
        keep={keep}
        onKeepChange={noop}
        nextToProject={false}
        onNextToProjectChange={noop}
        project={null}
        status={null}
        onBackUpNow={noop}
        onShowBackups={noop}
        onOpen={noop}
      />,
    );
    expect(html).toContain('No project open.');
    expect(html).not.toContain('Back up now');
    expect(html).toContain('Keep the last');
  });

  it('says where a project’s backups are, and why', () => {
    expect(placeNote(null, false)).toBe('Kept in a Backups folder next to the project.');
    expect(placeNote('iCloud Drive', false)).toBe(
      'This project is in iCloud Drive, so its backups stay on this computer instead of uploading every 5 minutes.',
    );
    expect(placeNote('Dropbox', true)).toBe('This project is in Dropbox; its backups are next to it and sync with it.');
  });

  it('says where backups go by the applied setting, as the folder under it does, and where they’d go after Apply (round 2)', () => {
    const view = (nextToProject: boolean, appliedNextToProject: boolean, synced: string | null = 'Dropbox') =>
      renderToString(
        <BackupsView
          keep={keep}
          onKeepChange={noop}
          project={{ folder: '/Users/robin/Library/Application Support/Backups', backups: [], synced }}
          nextToProject={nextToProject}
          appliedNextToProject={appliedNextToProject}
          onNextToProjectChange={noop}
          status={null}
          onBackUpNow={noop}
          onShowBackups={noop}
          onOpen={noop}
        />,
      ).replaceAll('<!-- -->', '');
    const local = 'This project is in Dropbox, so its backups stay on this computer instead of uploading every 5 minutes.';
    const next = 'This project is in Dropbox; its backups are next to it and sync with it.';
    // The switch turned on, not applied: the line still says where they go now, then where they'd go.
    const waiting = view(true, false);
    expect(waiting).toContain(`<p class="text-[12px]">${local}</p>`);
    expect(waiting).toContain(`After Apply: ${next}`);
    expect(waiting.indexOf(local)).toBeLessThan(waiting.indexOf('After Apply'));
    // Nothing waiting: one line, no After Apply.
    const applied = view(true, true);
    expect(applied).toContain(next);
    expect(applied).not.toContain('After Apply');
    // Not synced: the place is the same either way, so nothing more is said.
    expect(view(true, false, null)).not.toContain('After Apply');
  });
});
