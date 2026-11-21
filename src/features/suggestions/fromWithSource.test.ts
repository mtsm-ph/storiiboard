import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../core/i18n';
import { fromWithSource } from './review';

// Who an import is from, with its source beside the names (7.6 round 2), as the Notifications row says it: an
// assistant's app that names itself "Kevin Matos" or "Storiiboard" never reads as the person or the app. Made-up
// people only.

afterEach(() => {
  setLocale('en');
});

describe('fromWithSource (7.6 round 2)', () => {
  it('says the source beside the names, and the source alone when the file names no one', () => {
    setLocale('en');
    expect(fromWithSource(['Robin Vale'], 'mcp')).toBe('Robin Vale, through the assistant');
    expect(fromWithSource(['Storiiboard'], 'mcp')).toBe('Storiiboard, through the assistant');
    expect(fromWithSource(['Robin Vale'], 'change_file')).toBe('Robin Vale, through a change file');
    expect(fromWithSource([], 'mcp')).toBe('the assistant');
    setLocale('es');
    expect(fromWithSource(['Robin Vale'], 'mcp')).toBe('Robin Vale, vía el asistente');
  });
});
