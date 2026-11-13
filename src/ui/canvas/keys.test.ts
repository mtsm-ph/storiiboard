import { describe, expect, it } from 'vitest';
import { commandForKey, toolForKey, zoomShortcut, zoomStepFor, type KeyLike } from './keys';

const key = (k: string, rest: Partial<KeyLike> = {}): KeyLike => ({ key: k, code: '', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...rest });

describe('the canvas keys', () => {
  it('reads the tools from V, H and R', () => {
    expect([toolForKey(key('v')), toolForKey(key('H')), toolForKey(key('r')), toolForKey(key('x'))]).toEqual(['select', 'hand', 'rect', null]);
    expect(toolForKey(key('r', { ctrlKey: true }))).toBeNull();
  });

  it('reads T, S and O as the text, sticky and ellipse tools', () => {
    expect([toolForKey(key('t')), toolForKey(key('S')), toolForKey(key('o'))]).toEqual(['text', 'sticky', 'ellipse']);
    expect(toolForKey(key('s', { metaKey: true }))).toBeNull();
  });

  it('maps the edit commands with ⌘ on a Mac and Ctrl elsewhere', () => {
    expect(commandForKey(key('c', { metaKey: true }), true, null)).toEqual({ kind: 'copy' });
    expect(commandForKey(key('c', { ctrlKey: true }), true, null)).toBeNull();
    expect(commandForKey(key('x', { ctrlKey: true }), false, null)).toEqual({ kind: 'cut' });
    expect(commandForKey(key('d', { ctrlKey: true }), false, null)).toEqual({ kind: 'duplicate' });
    expect(commandForKey(key('v', { ctrlKey: true }), false, { x: 3, y: 4 })).toEqual({ kind: 'paste', at: { x: 3, y: 4 } });
    expect(commandForKey(key('Delete'), false, null)).toEqual({ kind: 'delete' });
    expect(commandForKey(key('Backspace'), true, null)).toEqual({ kind: 'delete' });
  });

  it('maps the brackets by their place, Shift for the ends', () => {
    expect(commandForKey(key(']', { code: 'BracketRight', ctrlKey: true }), false, null)).toEqual({ kind: 'forward' });
    expect(commandForKey(key('[', { code: 'BracketLeft', ctrlKey: true }), false, null)).toEqual({ kind: 'backward' });
    expect(commandForKey(key('}', { code: 'BracketRight', ctrlKey: true, shiftKey: true }), false, null)).toEqual({ kind: 'front' });
    expect(commandForKey(key('{', { code: 'BracketLeft', metaKey: true, shiftKey: true }), true, null)).toEqual({ kind: 'back' });
  });

  it('reads the zoom shortcuts', () => {
    expect(zoomShortcut(key(')', { code: 'Digit0', shiftKey: true }))).toBe('actual');
    expect(zoomShortcut(key('!', { code: 'Digit1', shiftKey: true }))).toBe('all');
    expect(zoomShortcut(key('@', { code: 'Digit2', shiftKey: true }))).toBe('selection');
    expect(zoomShortcut(key('1', { code: 'Digit1' }))).toBeNull();
    expect([zoomStepFor(key('+')), zoomStepFor(key('=')), zoomStepFor(key('-')), zoomStepFor(key('a'))]).toEqual([1, 1, -1, 0]);
  });
});
