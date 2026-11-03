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
    expect(loadSettings(storage)).toEqual({ theme: 'dark', backups: { recent: 30, days: 14 }, syncNoted: [] });
    expect(loadSettings(memoryStorage('{"backups":{"recent":0,"days":2.5}}')).backups).toEqual({ recent: 12, days: 14 });
  });

  it('saves the keep numbers alongside the theme', () => {
    const storage = memoryStorage('{"theme":"light"}');
    saveSettings({ backups: { recent: 5, days: 30 } }, storage);
    expect(loadSettings(storage)).toEqual({ theme: 'light', backups: { recent: 5, days: 30 }, syncNoted: [] });
  });
});

describe('settings', () => {
  it('defaults to following the OS', () => {
    expect(loadSettings(memoryStorage()).theme).toBe('system');
  });

  it('ignores corrupt or unknown values instead of failing', () => {
    expect(loadSettings(memoryStorage('{not json')).theme).toBe('system');
    expect(loadSettings(memoryStorage('{"theme":"sepia"}')).theme).toBe('system');
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadSettings(throwing).theme).toBe('system');
  });

  it('saves and reloads the theme', () => {
    const storage = memoryStorage();
    saveSettings({ theme: 'dark' }, storage);
    expect(loadSettings(storage).theme).toBe('dark');
  });
});

describe('resolveTheme', () => {
  it('follows the OS only on system', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
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

  const stored = [null, '{"theme":"system"}', '{"theme":"light"}', '{"theme":"dark"}', '{broken'];
  it.each(stored.flatMap((value) => [true, false].map((osDark) => [value, osDark] as const)))(
    'stored %s, OS dark %s',
    (value, osDark) => {
      const expected = resolveTheme(loadSettings(memoryStorage(value)).theme, osDark);
      expect(runBoot(value, osDark)).toBe(expected);
    },
  );
});
