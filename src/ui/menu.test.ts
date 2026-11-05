import { describe, expect, it } from 'vitest';
import { commandShortcut } from './Menu';

describe('a shortcut as a menu shows it', () => {
  it('uses the Mac’s symbols there and Ctrl elsewhere, with matching aria-keyshortcuts', () => {
    expect(commandShortcut('S', { shift: true, mac: true })).toEqual({ label: '⌘⇧S', aria: 'Meta+Shift+S' });
    expect(commandShortcut('S', { shift: true, mac: false })).toEqual({ label: 'Ctrl+Shift+S', aria: 'Control+Shift+S' });
    expect(commandShortcut(',', { mac: true })).toEqual({ label: '⌘,', aria: 'Meta+,' });
    expect(commandShortcut('E', { mac: false })).toEqual({ label: 'Ctrl+E', aria: 'Control+E' });
  });
});
