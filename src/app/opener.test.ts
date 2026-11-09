import { afterEach, describe, expect, it, vi } from 'vitest';
import { openLink } from './opener';

// Opening outside the app (3.12): only web links, refused before anything is asked to open them.

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('openLink', () => {
  it('refuses anything but an http or https link, before it reaches the desktop or the browser', async () => {
    const open = vi.fn(() => null);
    vi.stubGlobal('window', { open });
    for (const refused of ['javascript:alert(1)', 'file:///C:/Windows/System32/calc.exe', 'C:/Windows/notepad.exe', 'mailto:a@b.c', 'https://u:p@x.com/']) {
      await expect(openLink(refused)).rejects.toThrow('Storiiboard opens only web links (http or https).');
    }
    expect(open).not.toHaveBeenCalled();
    await openLink('https://vimeo.com/1');
    expect(open).toHaveBeenCalledWith('https://vimeo.com/1', '_blank', 'noopener,noreferrer');
  });
});
