import { describe, expect, it } from 'vitest';
import { isSidebarToggle, sidebarShortcut } from './sidebarToggle';

const key = (over: Partial<Parameters<typeof isSidebarToggle>[0]>): Parameters<typeof isSidebarToggle>[0] => ({
  key: '\\',
  code: 'Backslash',
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  repeat: false,
  isComposing: false,
  target: null,
  ...over,
});

describe('the hide and show sidebar shortcut', () => {
  it('is ⌘\\ on a Mac and Ctrl+\\ elsewhere', () => {
    expect(isSidebarToggle(key({ metaKey: true }), true)).toBe(true);
    expect(isSidebarToggle(key({ ctrlKey: true }), true)).toBe(false);
    expect(isSidebarToggle(key({ ctrlKey: true }), false)).toBe(true);
    expect(isSidebarToggle(key({ metaKey: true }), false)).toBe(false);
    expect(sidebarShortcut(true)).toEqual({ label: '⌘\\', aria: 'Meta+\\' });
    expect(sidebarShortcut(false)).toEqual({ label: 'Ctrl+\\', aria: 'Control+\\' });
  });

  it('reads the key where a US keyboard has its backslash, whatever the layout types there', () => {
    // On a German layout that key types #; the backslash itself is behind AltGr there.
    expect(isSidebarToggle(key({ ctrlKey: true, key: '#' }), false)).toBe(true);
    // A backslash typed from another key still counts.
    expect(isSidebarToggle(key({ ctrlKey: true, code: 'IntlBackslash' }), false)).toBe(true);
  });

  it('leaves Shift and Alt combinations, bare keys, a held key and an input method alone', () => {
    expect(isSidebarToggle(key({ ctrlKey: true, shiftKey: true }), false)).toBe(false);
    expect(isSidebarToggle(key({ ctrlKey: true, altKey: true }), false)).toBe(false);
    expect(isSidebarToggle(key({}), false)).toBe(false);
    expect(isSidebarToggle(key({ ctrlKey: true, repeat: true }), false)).toBe(false);
    expect(isSidebarToggle(key({ ctrlKey: true, isComposing: true }), false)).toBe(false);
  });

  it('does nothing inside a modal dialog', () => {
    const dialog = { closest: (selector: string) => (selector === 'dialog[open]' ? {} : null) } as unknown as EventTarget;
    expect(isSidebarToggle(key({ ctrlKey: true, target: dialog }), false)).toBe(false);
  });
});
