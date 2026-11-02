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

describe('settings', () => {
  it('defaults to following the OS', () => {
    expect(loadSettings(memoryStorage())).toEqual({ theme: 'system' });
  });

  it('ignores corrupt or unknown values instead of failing', () => {
    expect(loadSettings(memoryStorage('{not json'))).toEqual({ theme: 'system' });
    expect(loadSettings(memoryStorage('{"theme":"sepia"}'))).toEqual({ theme: 'system' });
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadSettings(throwing)).toEqual({ theme: 'system' });
  });

  it('saves and reloads the theme', () => {
    const storage = memoryStorage();
    saveSettings({ theme: 'dark' }, storage);
    expect(loadSettings(storage)).toEqual({ theme: 'dark' });
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
