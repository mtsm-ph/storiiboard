import { describe, expect, it } from 'vitest';
import { isSidebarToggle } from './sidebarToggle';

const key = (over: Partial<Parameters<typeof isSidebarToggle>[0]>) => ({
  key: '\\',
  code: 'Backslash',
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  target: null,
  ...over,
});

describe('the hide and show sidebar shortcut', () => {
  it('is ⌘\\ on a Mac and Ctrl+\\ elsewhere', () => {
    expect(isSidebarToggle(key({ metaKey: true }), true)).toBe(true);
    expect(isSidebarToggle(key({ ctrlKey: true }), true)).toBe(false);
    expect(isSidebarToggle(key({ ctrlKey: true }), false)).toBe(true);
    expect(isSidebarToggle(key({ metaKey: true }), false)).toBe(false);
  });

  it('reads the key where it sits, whatever the layout types there', () => {
    // A German layout types ß there… and a backslash typed some other way still counts.
    expect(isSidebarToggle(key({ ctrlKey: true, key: 'ß' }), false)).toBe(true);
    expect(isSidebarToggle(key({ ctrlKey: true, code: 'IntlBackslash' }), false)).toBe(true);
  });

  it('leaves Shift and Alt combinations, and bare keys, alone', () => {
    expect(isSidebarToggle(key({ ctrlKey: true, shiftKey: true }), false)).toBe(false);
    expect(isSidebarToggle(key({ ctrlKey: true, altKey: true }), false)).toBe(false);
    expect(isSidebarToggle(key({}), false)).toBe(false);
  });
});
