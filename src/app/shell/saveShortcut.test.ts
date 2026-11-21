import { describe, expect, it, vi } from 'vitest';
import { commitAndStay, isSaveShortcut, onGapPointer, onSaveKey, pressSave, typedBy } from './saveShortcut';
import { isTextEntry } from './workspaces';

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
    // A text field by the app's own test, the one that lets typing through every other shortcut.
    expect(isTextEntry(inField.target as unknown as EventTarget)).toBe(true);
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
    const holder = { isConnected: true, parentElement: null, getAttribute: () => null, querySelectorAll: () => [neighbour, fresh] };
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

  it('never takes a field drawn anew with another value, nor one outside its tile', async () => {
    const doc = { activeElement: null as unknown, body: {} };
    const old = fakeField(doc, 'Action');
    // Same label, another value: another record's field.
    const other = fakeField(doc, 'Action', 'Close on the boat');
    const holder = { isConnected: true, parentElement: null, getAttribute: () => null, querySelectorAll: () => [other] };
    old.parentElement = holder;
    doc.activeElement = old;
    await commitAndStay(() => {
      old.isConnected = false;
      return Promise.resolve();
    }, doc as unknown as Document);
    expect(other.focus).not.toHaveBeenCalled();

    // Its tile went with it: the climb stops at the tile, so a field like it in another tile is never taken.
    const again = fakeField(doc, 'Action');
    const elsewhere = fakeField(doc, 'Action');
    const outside = { isConnected: true, parentElement: null, getAttribute: () => null, querySelectorAll: () => [elsewhere] };
    const tile = { isConnected: false, parentElement: outside, getAttribute: (name: string) => (name === 'data-stack-id' ? 's1' : null), querySelectorAll: () => [] };
    again.parentElement = tile;
    doc.activeElement = again;
    await commitAndStay(() => {
      again.isConnected = false;
      return Promise.resolve();
    }, doc as unknown as Document);
    expect(elsewhere.focus).not.toHaveBeenCalled();
  });
});

describe('keys pressed between the blur and the refocus', () => {
  /** A keydown as the window's capture listener gets it. */
  const down = (letter: string, mods: Parameters<typeof key>[1] = {}) => ({
    ...key(letter, mods),
    repeat: false,
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  });

  it('takes every key from everyone, then types the typed ones at the caret once the field is back', async () => {
    const doc = { activeElement: null as unknown, body: {}, execCommand: vi.fn(() => true) };
    const field = fakeField(doc, 'Action');
    doc.activeElement = field;
    const press = vi.fn();
    const pressed: ReturnType<typeof down>[] = [];
    await commitAndStay(() => {
      // Typed at once after the press, an undo among them, and the key again: none acts, nothing presses again.
      for (const event of [down('x'), down('z', { ctrlKey: true }), down('y'), down('s', { ctrlKey: true }), down('Enter'), down('z')]) {
        pressed.push(event);
        onSaveKey(event, false, press);
      }
      expect(doc.execCommand).not.toHaveBeenCalled();
      return Promise.resolve();
    }, doc as unknown as Document);
    for (const event of pressed) {
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(1);
    }
    expect(press).not.toHaveBeenCalled();
    expect(doc.activeElement).toBe(field);
    // After the caret went back, so the letters go where it was.
    expect(field.setSelectionRange).toHaveBeenCalledWith(4, 8, 'backward');
    expect(doc.execCommand).toHaveBeenCalledWith('insertText', false, 'xyz');

    // The gap is over: keys are the page's again.
    const after = down('q');
    expect(onSaveKey(after, false, press)).toBe(false);
    expect(after.preventDefault).not.toHaveBeenCalled();
    expect(after.stopImmediatePropagation).not.toHaveBeenCalled();
  });

  it('drops them when the field doesn’t come back, and takes none once the person clicked elsewhere', async () => {
    const doc = { activeElement: null as unknown, body: {}, execCommand: vi.fn(() => true) };
    const field = fakeField(doc, 'Action');
    doc.activeElement = field;
    await commitAndStay(() => {
      onSaveKey(down('x'), false, vi.fn());
      // Its editor closed with the blur, as leaving it does.
      field.isConnected = false;
      return Promise.resolve();
    }, doc as unknown as Document);
    expect(doc.execCommand).not.toHaveBeenCalled();

    const kept = fakeField(doc, 'Action');
    doc.activeElement = kept;
    const clicked = {};
    let late: ReturnType<typeof down> | null = null;
    await commitAndStay(() => {
      doc.activeElement = clicked;
      late = down('x');
      onSaveKey(late, false, vi.fn());
      return Promise.resolve();
    }, doc as unknown as Document);
    expect(late).not.toBeNull();
    expect((late as unknown as ReturnType<typeof down>).preventDefault).not.toHaveBeenCalled();
    expect(doc.execCommand).not.toHaveBeenCalled();
  });

  it('keeps only keys that type: AltGr and Option letters yes, Alt+1 off a Mac and shortcuts no', () => {
    expect(typedBy(key('x'), false)).toBe('x');
    expect(typedBy(key('X', { shiftKey: true }), false)).toBe('X');
    expect(typedBy(key('@', { ctrlKey: true, altKey: true }), false)).toBe('@');
    expect(typedBy(key('1', { altKey: true }, 'Digit1'), false)).toBeNull();
    expect(typedBy(key('å', { altKey: true }, 'KeyA'), true)).toBe('å');
    expect(typedBy(key('z', { ctrlKey: true }), false)).toBeNull();
    expect(typedBy(key('z', { metaKey: true }), true)).toBeNull();
    expect(typedBy(key('`', {}, 'Backquote'), false)).toBe('`');
    expect(typedBy(key('ArrowLeft', {}, 'ArrowLeft'), false)).toBeNull();
    expect(typedBy(key('Dead', {}, 'Quote'), false)).toBeNull();
  });

  it('counts Ctrl and Alt together as AltGr only when the engine says AltGraph is down', () => {
    const altGr = (letter: string, on: boolean) => ({ ...key(letter, { ctrlKey: true, altKey: true }), getModifierState: (k: string) => on && k === 'AltGraph' });
    expect(typedBy(altGr('@', true), false)).toBe('@');
    // Ctrl+Alt+letter held down, no AltGr: a shortcut, not typing.
    expect(typedBy(altGr('e', false), false)).toBeNull();
    // Alt alone stays a shortcut, whatever the engine says.
    expect(typedBy({ ...key('1', { altKey: true }, 'Digit1'), getModifierState: () => false }, false)).toBeNull();
  });

  /** A press's gap with these keys pressed in it, the field coming back; what the document was asked to do. */
  async function gapWith(events: ReturnType<typeof down>[], tagName = 'INPUT') {
    const doc = { activeElement: null as unknown, body: {}, execCommand: vi.fn(() => true) };
    const field = { ...fakeField(doc, 'Action'), tagName };
    field.focus = vi.fn(() => {
      doc.activeElement = field;
    });
    doc.activeElement = field;
    await commitAndStay(() => {
      for (const event of events) onSaveKey(event, false, vi.fn());
      return Promise.resolve();
    }, doc as unknown as Document);
    return { doc, field, events };
  }

  it('replays Backspace and Delete in order among the letters, and Enter in a textarea as a line break', async () => {
    const { doc } = await gapWith([down('a'), down('b'), down('Backspace'), down('c'), down('Delete'), down('d')]);
    expect(doc.execCommand.mock.calls).toEqual([
      ['insertText', false, 'ab'],
      ['delete', false],
      ['insertText', false, 'c'],
      ['forwardDelete', false],
      ['insertText', false, 'd'],
    ]);

    const lines = await gapWith([down('a'), down('Enter'), down('b')], 'TEXTAREA');
    expect(lines.doc.execCommand.mock.calls).toEqual([['insertText', false, 'a\nb']]);
  });

  it('stops at a key that moves on (Tab, an arrow, Escape): what came before goes in, what follows is dropped', async () => {
    for (const leave of ['Tab', 'ArrowDown', 'Escape']) {
      const { doc, events } = await gapWith([down('a'), down(leave), down('b'), down('Backspace')]);
      expect(doc.execCommand.mock.calls).toEqual([['insertText', false, 'a']]);
      // Every key is still taken from the page.
      for (const event of events) expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(1);
    }
    // Shift held for a capital is no such key.
    const { doc } = await gapWith([down('Shift', { shiftKey: true }), down('A', { shiftKey: true })]);
    expect(doc.execCommand.mock.calls).toEqual([['insertText', false, 'A']]);
  });

  it('ends at a pointerdown: the field isn’t focused again and nothing typed goes in', async () => {
    const doc = { activeElement: null as unknown, body: {}, execCommand: vi.fn(() => true) };
    const field = fakeField(doc, 'Action');
    doc.activeElement = field;
    await commitAndStay(() => {
      onSaveKey(down('x'), false, vi.fn());
      // A click elsewhere, which in WebKit on a Mac moves no focus.
      onGapPointer();
      const after = down('y');
      expect(onSaveKey(after, false, vi.fn())).toBe(false);
      expect(after.preventDefault).not.toHaveBeenCalled();
      return Promise.resolve();
    }, doc as unknown as Document);
    expect(field.focus).not.toHaveBeenCalled();
    expect(doc.execCommand).not.toHaveBeenCalled();
    expect(doc.activeElement).toBe(doc.body);
  });
});

describe('a field drawn anew whose commit tidied its value', () => {
  it('is found by its value as the commit leaves it, in any case and trimmed, only when exactly one matches', async () => {
    const doc = { activeElement: null as unknown, body: {} };
    const old = fakeField(doc, 'Scene number', ' 12a ');
    const fresh = fakeField(doc, 'Scene number', '12A');
    const holder = { isConnected: true, parentElement: null, getAttribute: () => null, querySelectorAll: () => [fresh] };
    old.parentElement = holder;
    doc.activeElement = old;
    await commitAndStay(() => {
      old.isConnected = false;
      return Promise.resolve();
    }, doc as unknown as Document);
    expect(fresh.focus).toHaveBeenCalledWith({ preventScroll: true });

    // Two that match: neither is taken.
    const again = fakeField(doc, 'Scene number', '12a');
    const one = fakeField(doc, 'Scene number', '12A');
    const two = fakeField(doc, 'Scene number', '12A ');
    again.parentElement = { isConnected: true, parentElement: null, getAttribute: () => null, querySelectorAll: () => [one, two] };
    doc.activeElement = again;
    await commitAndStay(() => {
      again.isConnected = false;
      return Promise.resolve();
    }, doc as unknown as Document);
    expect(one.focus).not.toHaveBeenCalled();
    expect(two.focus).not.toHaveBeenCalled();
  });
});
