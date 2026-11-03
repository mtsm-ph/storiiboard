import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AppDataStore } from '../../core/storage/appData';
import { rememberRecent } from '../../core/storage/recent';
import { withSbdExtension } from './dialogs';
import { ProjectsView } from './ProjectsView';
import { createRecentStore } from './recentStore';

function memoryStore(): AppDataStore {
  const files: Record<string, string> = {};
  return {
    read: (name) => Promise.resolve(files[name] ?? null),
    write: (name, contents) => {
      files[name] = contents;
      return Promise.resolve();
    },
  };
}

const bey = { path: '/Users/kevin/Films/Bey County.sbd', name: 'Bey County', openedAt: '2026-11-02T14:05:00.000Z' };
const parfum = { path: '/Volumes/Jobs/Parfum No. 7.sbd', name: 'Parfum No. 7', openedAt: '2026-10-28T09:30:00.000Z' };
const noop = () => undefined;

describe('the Projects screen', () => {
  it('gives a new project the .sbd extension once, whatever case the person typed', () => {
    expect(withSbdExtension('/Users/kevin/Films/Open Water')).toBe('/Users/kevin/Films/Open Water.sbd');
    expect(withSbdExtension('/Users/kevin/Films/Open Water.sbd')).toBe('/Users/kevin/Films/Open Water.sbd');
    expect(withSbdExtension('C:\\Films\\PILOT.SBD')).toBe('C:\\Films\\PILOT.SBD');
  });

  it('reads Recent, newest first, and forgets one without touching the file', async () => {
    const disk = memoryStore();
    await rememberRecent(disk, parfum);
    await rememberRecent(disk, bey);
    const recent = createRecentStore(disk);
    await recent.getState().refresh();
    expect(recent.getState().entries.map((e) => e.name)).toEqual(['Bey County', 'Parfum No. 7']);
    await recent.getState().forget(bey.path);
    expect(recent.getState().entries.map((e) => e.name)).toEqual(['Parfum No. 7']);
  });

  it('keeps an empty list in the browser build, which has no app data', async () => {
    const recent = createRecentStore(null);
    await recent.getState().refresh();
    expect(recent.getState().entries).toEqual([]);
  });

  it('lists recent projects with their path and when they were opened, marking the one open', () => {
    const html = renderToString(
      <ProjectsView recent={[bey, parfum]} openPath={bey.path} canOpen onNew={noop} onOpen={noop} onOpenRecent={noop} onForget={noop} onOpenBackup={noop} />,
    );
    expect(html).toContain('Bey County');
    expect(html).toContain('/Volumes/Jobs/Parfum No. 7.sbd');
    expect(html.split('>Open</span>').length - 1).toBe(1);
    expect(html).toContain('aria-label="Remove Parfum No. 7 from Recent"');
    expect(html).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  });

  it('says what to do with no recent projects, and that the browser build can’t open files', () => {
    const html = renderToString(
      <ProjectsView recent={[]} openPath={null} canOpen={false} onNew={noop} onOpen={noop} onOpenRecent={noop} onForget={noop} onOpenBackup={noop} />,
    );
    expect(html).toContain('No recent projects yet.');
    expect(html).toContain('Projects open in the desktop app.');
    expect(html.split('disabled=""').length - 1).toBe(3);
  });

  it('lists only live projects under Recent, each with its state; archived ones wait under Archived', () => {
    const archived = { ...parfum, path: '/Volumes/Jobs/Momentum.sbd', name: 'Momentum', state: 'archived' as const };
    const html = renderToString(
      <ProjectsView
        recent={[{ ...bey, state: 'draft' }, parfum, archived]}
        openPath={null}
        canOpen
        onNew={noop}
        onOpen={noop}
        onOpenRecent={noop}
        onForget={noop}
        onOpenBackup={noop}
      />,
    );
    expect(html).not.toContain('Momentum');
    expect(html).toContain('>Draft</span>');
    // Lists from before 0.7b have no state: they read as active.
    expect(html).toContain('>Active</span>');
    expect(html).toContain('Open backup…');
  });
});
