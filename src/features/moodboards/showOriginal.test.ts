import { describe, expect, it } from 'vitest';
import { originalShown, revealOriginal } from '../../app/opener';
import { en } from '../../core/i18n/locales/en';
import { es } from '../../core/i18n/locales/es';
import { platformOf, showOriginalKey, showsOriginalAction } from './showOriginal';

// Show in Finder / Show in Explorer (5.9): the words by computer, and when the action shows at all.

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

describe('the words', () => {
  it('follow the computer, in English and in Spanish', () => {
    expect(platformOf(MAC)).toBe('mac');
    expect(platformOf(WINDOWS)).toBe('windows');
    expect(platformOf(LINUX)).toBe('other');
    expect(en[showOriginalKey('mac')]).toBe('Show in Finder');
    expect(en[showOriginalKey('windows')]).toBe('Show in Explorer');
    expect(en[showOriginalKey('other')]).toBe('Show in folder');
    expect(es[showOriginalKey('mac')]).toBe('Mostrar en Finder');
    expect(es[showOriginalKey('windows')]).toBe('Mostrar en el Explorador');
    expect(es[showOriginalKey('other')]).toBe('Mostrar en la carpeta');
    expect(en['moodboard.originalGone']).toBe("That picture's original isn't where it was.");
    expect(es['moodboard.originalGone']).toBe('El original de esa imagen ya no está donde estaba.');
  });
});

describe('when the action shows', () => {
  it('is for one picture whose original exists', () => {
    expect(showsOriginalAction({ selected: 1, kind: 'picture', exists: true })).toBe(true);
  });

  it('is not there for a missing or unrecorded original (Rust says no), a video card, a link or several items', () => {
    expect(showsOriginalAction({ selected: 1, kind: 'picture', exists: false })).toBe(false);
    expect(showsOriginalAction({ selected: 1, kind: 'video', exists: true })).toBe(false);
    expect(showsOriginalAction({ selected: 1, kind: 'link', exists: true })).toBe(false);
    expect(showsOriginalAction({ selected: 2, kind: 'picture', exists: true })).toBe(false);
    expect(showsOriginalAction({ selected: 0, kind: 'picture', exists: true })).toBe(false);
  });

  it('is not there in a browser build: nothing is shown, and a reveal says it could not', async () => {
    expect(await originalShown('a'.repeat(64))).toBe(false);
    await expect(revealOriginal('a'.repeat(64))).rejects.toThrow();
  });
});
