import { beforeEach, describe, expect, it } from 'vitest';
import { originalShown, revealOriginal } from '../../app/opener';
import { projectStore } from '../../app/projectStore';
import { en } from '../../core/i18n/locales/en';
import { es } from '../../core/i18n/locales/es';
import { platformOf, showOriginalKey } from './showOriginal';

// Show in Finder / Show in Explorer (5.9): the words by computer, and the browser build saying no.

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

describe('in a browser build', () => {
  beforeEach(() => {
    // A project is open, as on the web; but this isn't the desktop app and no development stand-in is set.
    projectStore.setState({ project: { file: {} } as never });
  });

  it('shows nothing, and a reveal says it could not', async () => {
    expect(await originalShown('record', 'a'.repeat(64))).toBe(false);
    await expect(revealOriginal('record', 'a'.repeat(64))).rejects.toThrow(en['moodboard.originalGone']);
  });
});
