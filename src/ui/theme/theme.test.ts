import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { loadSettings, saveSettings, SETTINGS_KEY } from '../../core/storage/settings';
import { DARK_QUERY, resolveTheme } from './theme';

function memoryStorage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: (key: string) => (key === SETTINGS_KEY ? value : null),
    setItem: (key: string, next: string) => {
      if (key === SETTINGS_KEY) value = next;
    },
    read: () => value,
  };
}

describe('backup settings', () => {
  it('keep 12 copies and 14 days unless changed, and drop a bad number on its own', () => {
    expect(loadSettings(memoryStorage()).backups).toEqual({ recent: 12, days: 14 });
    const storage = memoryStorage('{"theme":"dark","backups":{"recent":30,"days":-1}}');
    expect(loadSettings(storage)).toEqual({
      theme: 'dark',
      themeChosen: false,
      backups: { recent: 30, days: 14 },
      syncNoted: [],
      backupsNextToProject: false,
      language: 'en',
      weekStart: 'region',
      sidebarHidden: false,
      profile: { name: '', initials: '', role: null, historyInitials: false },
      projectRoles: {},
      projectSelves: {},
      pdfScenePalettes: false,
      companies: [],
      departmentWorkspaces: [],
      customWorkspaces: [],
    });
    expect(loadSettings(memoryStorage('{"backups":{"recent":0,"days":2.5}}')).backups).toEqual({ recent: 12, days: 14 });
  });

  it('keeps each project’s role on this computer, dropping one that isn’t a role (polish 6)', () => {
    const storage = memoryStorage('{"projectRoles":{"p1":"director-dp","p2":"boss","p3":"gaffer","p4":7}}');
    expect(loadSettings(storage).projectRoles).toEqual({ p1: 'director-dp', p3: 'gaffer' });
    const many = Object.fromEntries(Array.from({ length: 520 }, (_, i) => [`p${String(i)}`, 'dp']));
    const kept = loadSettings(memoryStorage(JSON.stringify({ projectRoles: many }))).projectRoles;
    // The newest 500, the oldest falling off first.
    expect(Object.keys(kept)).toHaveLength(500);
    expect(kept.p0).toBeUndefined();
    expect(kept.p519).toBe('dp');
  });

  it('keeps who you are in each project’s Cast and crew on this computer, by person id (3.5c)', () => {
    const storage = memoryStorage('{"projectSelves":{"p1":"person-1","p2":"","p3":7,"p4":null}}');
    expect(loadSettings(storage).projectSelves).toEqual({ p1: 'person-1' });
    expect(loadSettings(memoryStorage('{"projectSelves":["p1"]}')).projectSelves).toEqual({});
    const many = Object.fromEntries(Array.from({ length: 520 }, (_, i) => [`p${String(i)}`, `person-${String(i)}`]));
    const kept = loadSettings(memoryStorage(JSON.stringify({ projectSelves: many }))).projectSelves;
    expect(Object.keys(kept)).toHaveLength(500);
    expect(kept.p0).toBeUndefined();
    expect(kept.p519).toBe('person-519');
  });

  it('lists the department workspaces in the sidebar once each, in the call sheet’s order, dropping unknown ones (3.6a)', () => {
    const storage = memoryStorage('{"departmentWorkspaces":["sound","camera","boom","camera",7]}');
    expect(loadSettings(storage).departmentWorkspaces).toEqual(['camera', 'sound']);
    expect(loadSettings(memoryStorage('{"departmentWorkspaces":"camera"}')).departmentWorkspaces).toEqual([]);
    // Your own workspaces (3.6d): named, with a custom- id, each once; the layout is checked by the shell.
    const custom = memoryStorage(
      '{"customWorkspaces":[{"id":"custom-a1","name":" Prep ","layout":{}},{"id":"custom-a1","name":"Again"},{"id":"storyboard","name":"X"},{"id":"custom-b2","name":"  "},7]}',
    );
    expect(loadSettings(custom).customWorkspaces).toEqual([{ id: 'custom-a1', name: 'Prep', layout: {} }]);
    expect(loadSettings(memoryStorage('{"customWorkspaces":"x"}')).customWorkspaces).toEqual([]);
  });

  it('saves the keep numbers alongside the theme', () => {
    const storage = memoryStorage('{"theme":"light"}');
    saveSettings({ backups: { recent: 5, days: 30 } }, storage);
    expect(loadSettings(storage)).toEqual({
      theme: 'light',
      themeChosen: false,
      backups: { recent: 5, days: 30 },
      syncNoted: [],
      backupsNextToProject: false,
      language: 'en',
      weekStart: 'region',
      sidebarHidden: false,
      profile: { name: '', initials: '', role: null, historyInitials: false },
      projectRoles: {},
      projectSelves: {},
      pdfScenePalettes: false,
      companies: [],
      departmentWorkspaces: [],
      customWorkspaces: [],
    });
  });
});

describe('settings', () => {
  it('defaults to following the project (1.15), which follows the OS until a project opens', () => {
    expect(loadSettings(memoryStorage()).theme).toBe('project');
  });

  it('ignores corrupt or unknown values instead of failing', () => {
    expect(loadSettings(memoryStorage('{not json')).theme).toBe('project');
    expect(loadSettings(memoryStorage('{"theme":"sepia"}')).theme).toBe('project');
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadSettings(throwing).theme).toBe('project');
  });

  it('saves and reloads the theme', () => {
    const storage = memoryStorage();
    saveSettings({ theme: 'dark' }, storage);
    expect(loadSettings(storage).theme).toBe('dark');
  });

  it('reads a System saved before 1.15 as the new default, and keeps one picked since', () => {
    // Every save before 1.15 wrote the old default along with whatever changed, such as a backups number.
    expect(loadSettings(memoryStorage('{"theme":"system","backups":{"recent":12,"days":14}}')).theme).toBe('project');
    const storage = memoryStorage();
    saveSettings({ theme: 'system', themeChosen: true }, storage);
    // A later save of something else keeps the choice.
    saveSettings({ backupsNextToProject: true }, storage);
    expect(loadSettings(storage)).toMatchObject({ theme: 'system', themeChosen: true });
  });
});

describe('resolveTheme', () => {
  it('follows the OS only on system', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('follows the project’s own mode on Follow project, and the OS while none is open', () => {
    expect(resolveTheme('project', false, 'dark')).toBe('dark');
    expect(resolveTheme('project', true, 'light')).toBe('light');
    expect(resolveTheme('project', true, null)).toBe('dark');
    // A fixed choice wins over the project's.
    expect(resolveTheme('light', false, 'dark')).toBe('light');
  });
});

// public/theme-boot.js runs before React to avoid a flash of the wrong theme; it must reach the same answer.
describe('theme-boot.js', () => {
  const boot = readFileSync(new URL('../../../public/theme-boot.js', import.meta.url), 'utf8');

  function runBoot(stored: string | null, osDark: boolean): string | null {
    let applied: string | null = null;
    runInNewContext(boot, {
      // Answer only the real key and the real query, so a renamed key or query in either file fails here.
      window: {
        localStorage: memoryStorage(stored),
        matchMedia: (query: string) => ({ matches: query === DARK_QUERY && osDark }),
      },
      document: {
        documentElement: {
          setAttribute: (_name: string, value: string) => {
            applied = value;
          },
        },
      },
    });
    return applied;
  }

  // No project is open before first paint, so Follow project boots as the OS does.
  const stored = [null, '{"theme":"project"}', '{"theme":"system"}', '{"theme":"light"}', '{"theme":"dark"}', '{broken'];
  it.each(stored.flatMap((value) => [true, false].map((osDark) => [value, osDark] as const)))(
    'stored %s, OS dark %s',
    (value, osDark) => {
      const expected = resolveTheme(loadSettings(memoryStorage(value)).theme, osDark);
      expect(runBoot(value, osDark)).toBe(expected);
    },
  );
});
