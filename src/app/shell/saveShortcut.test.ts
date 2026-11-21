import { describe, expect, it, vi } from 'vitest';
import { commitAndStay, isSaveShortcut, onSaveKey, pressSave } from './saveShortcut';

// Ctrl+S, ⌘S on a Mac (Kevin, Nov 18): the key is caught for the whole window, text fields included, so the browser's
// or WebView's save dialog never opens; e2e/ctrlS.spec.ts presses it in the app.

const key = (letter: string, mods: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {}, code = `Key${letter.toUpperCase()}`) => ({
  key: letter,
  code,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe('the save key', () => {
  it('is ⌘S on a Mac and Ctrl+S elsewhere, never the other one', () => {
    expect(isSaveShortcut(key('s', { metaKey: true }), true)).toBe(true);
    expect(isSaveShortcut(key('S', { metaKey: true }), true)).toBe(true);
    expect(isSaveShortcut(key('s', { ctrlKey: true }), true)).toBe(false);
    expect(isSaveShortcut(key('s', { ctrlKey: true }), false)).toBe(true);
    expect(isSaveShortcut(key('s', { metaKey: true }), false)).toBe(false);
    // Not with another modifier, nor another letter, nor alone.
    expect(isSaveShortcut(key('s', { ctrlKey: true, shiftKey: true }), false)).toBe(false);
    expect(isSaveShortcut(key('s', { ctrlKey: true, altKey: true }), false)).toBe(false);
    expect(isSaveShortcut(key('s', { ctrlKey: true, metaKey: true }), false)).toBe(false);
    expect(isSaveShortcut(key('z', { ctrlKey: true }), false)).toBe(false);
    expect(isSaveShortcut(key('s'), false)).toBe(false);
  });

  it('follows the letter on any Latin layout, and the key’s place only where the layout has none', () => {
    // Dvorak: the letter S sits where Latin O is.
    expect(isSaveShortcut(key('s', { ctrlKey: true }, 'Semicolon'), false)).toBe(true);
    expect(isSaveShortcut(key('o', { ctrlKey: true }, 'KeyS'), false)).toBe(false);
    // Russian: ы on the S key.
    expect(isSaveShortcut(key('ы', { metaKey: true }, 'KeyS'), true)).toBe(true);
  });

  it('prevents the default in a text field too, presses once for a held key, and leaves every other key alone', () => {
    const press = vi.fn();
    const inField = { ...key('s', { ctrlKey: true }), target: { tagName: 'INPUT', type: 'text' }, repeat: false, preventDefault: vi.fn() };
    expect(onSaveKey(inField, false, press)).toBe(true);
    expect(inField.preventDefault).toHaveBeenCalledTimes(1);
    expect(press).toHaveBeenCalledTimes(1);

    const held = { ...inField, repeat: true, preventDefault: vi.fn() };
    expect(onSaveKey(held, false, press)).toBe(true);
    expect(held.preventDefault).toHaveBeenCalledTimes(1);
    expect(press).toHaveBeenCalledTimes(1);

    // ⌘S off a Mac is not the key: its default is the browser's.
    const other = { ...key('s', { metaKey: true }), repeat: false, preventDefault: vi.fn() };
    expect(onSaveKey(other, false, press)).toBe(false);
    expect(other.preventDefault).not.toHaveBeenCalled();
    expect(press).toHaveBeenCalledTimes(1);
  });

  it('with no project open does nothing more', async () => {
    await expect(pressSave()).resolves.toBeUndefined();
  });
});

/** A field as commitAndStay sees it: blurring it hands focus to the body, focusing it takes it back. */
function fakeField(doc: { activeElement: unknown; body: unknown }, label: string, value = 'Wide on the pier') {
  const field = {
    tagName: 'INPUT',
    type: 'text',
    name: '',
    isContentEditable: false,
    isConnected: true,
    parentElement: null as unknown,
    labels: [{ textContent: label }],
    getAttribute: () => null,
    selectionStart: 4 as number | null,
    selectionEnd: 8 as number | null,
    selectionDirection: 'backward' as const,
    value,
    blur: vi.fn(() => {
      doc.activeElement = doc.body;
    }),
    focus: vi.fn(() => {
      doc.activeElement = field;
    }),
    setSelectionRange: vi.fn(),
  };
  return field;
}

describe('committing the field being typed in', () => {
  it('leaves it, so its own blur saves it, then puts focus and the caret back without scrolling', async () => {
    const doc = { activeElement: null as unknown, body: {} };
    const field = fakeField(doc, 'Action');
    doc.activeElement = field;
    const settled = vi.fn(() => {
      // By the time the edit is in, the field was left.
      expect(field.blur).toHaveBeenCalledTimes(1);
      return Promise.resolve();
    });
    await commitAndStay(settled, doc as unknown as Document);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(field.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(field.setSelectionRange).toHaveBeenCalledWith(4, 8, 'backward');
    expect(doc.activeElement).toBe(field);
  });

  it('finds the field drawn in its place when the commit drew it anew', async () => {
    const doc = { activeElement: null as unknown, body: {} };
    const old = fakeField(doc, 'Action');
    const fresh = fakeField(doc, 'Action');
    const neighbour = fakeField(doc, 'Dialogue');
    const holder = { isConnected: true, parentElement: null, querySelectorAll: () => [neighbour, fresh] };
    old.parentElement = holder;
    doc.activeElement = old;
    await commitAndStay(() => {
      old.isConnected = false;
      return Promise.resolve();
    }, doc as unknown as Document);
    expect(old.focus).not.toHaveBeenCalled();
    expect(neighbour.focus).not.toHaveBeenCalled();
    expect(fresh.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(fresh.setSelectionRange).toHaveBeenCalledWith(4, 8, 'backward');
  });

  it('leaves focus where the person put it meanwhile, and does nothing outside a text field', async () => {
    const doc = { activeElement: null as unknown, body: {} };
    const field = fakeField(doc, 'Action');
    doc.activeElement = field;
    const elsewhere = {};
    await commitAndStay(() => {
      doc.activeElement = elsewhere;
      return Promise.resolve();
    }, doc as unknown as Document);
    expect(field.focus).not.toHaveBeenCalled();
    expect(doc.activeElement).toBe(elsewhere);

    const button = { tagName: 'BUTTON', isContentEditable: false, blur: vi.fn() };
    doc.activeElement = button;
    const settled = vi.fn(() => Promise.resolve());
    await commitAndStay(settled, doc as unknown as Document);
    expect(button.blur).not.toHaveBeenCalled();
    expect(settled).not.toHaveBeenCalled();
  });
});
