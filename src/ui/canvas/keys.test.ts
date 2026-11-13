import { describe, expect, it } from 'vitest';
import { arrangeForKey, commandForKey, quickSideFor, toolForKey, zoomShortcut, zoomStepFor, type KeyLike } from './keys';

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

  it('reads L as the link tool (5.1b)', () => {
    expect(toolForKey(key('l'))).toBe('link');
    expect(toolForKey(key('L', { ctrlKey: true }))).toBeNull();
  });

  it('reads C as the connector tool and ⌘⌥ or Ctrl+Shift with an arrow as a connected copy (5.2)', () => {
    expect(toolForKey(key('c'))).toBe('connector');
    expect(toolForKey(key('c', { metaKey: true }))).toBeNull();
    expect(quickSideFor(key('ArrowDown', { metaKey: true, altKey: true }), true)).toBe('bottom');
    expect(quickSideFor(key('ArrowRight', { ctrlKey: true, shiftKey: true }), false)).toBe('right');
    expect(quickSideFor(key('ArrowRight', { ctrlKey: true, altKey: true }), false)).toBeNull();
    expect(quickSideFor(key('ArrowUp', { ctrlKey: true, shiftKey: true }), true)).toBeNull();
    expect(quickSideFor(key('ArrowLeft', { metaKey: true }), true)).toBeNull();
    expect(quickSideFor(key('a', { metaKey: true, altKey: true }), true)).toBeNull();
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

  it('reads Shift+S as the Section tool, leaving S the sticky (5.3)', () => {
    expect(toolForKey(key('S', { shiftKey: true }))).toBe('section');
    expect(toolForKey(key('s'))).toBe('sticky');
    expect(toolForKey(key('S', { shiftKey: true, metaKey: true }))).toBeNull();
  });

  it('reads the layout keys by the key’s place, as Option changes what a Mac types (5.3)', () => {
    const alt = (code: string, rest: Partial<KeyLike> = {}) => arrangeForKey(key('¯', { code, altKey: true, ...rest }), true);
    // On Windows and Linux the letter typed counts, so a layout that moves the keys still matches the menu’s letters.
    expect(arrangeForKey(key('a', { code: 'KeyQ', altKey: true }), false)).toEqual({ kind: 'align', mode: 'left' });
    expect(arrangeForKey(key('H', { code: 'KeyJ', altKey: true, shiftKey: true }), false)).toEqual({ kind: 'distribute', axis: 'horizontal' });
    expect(arrangeForKey(key('q', { code: 'KeyA', altKey: true }), false)).toBeNull();
    expect(['KeyA', 'KeyH', 'KeyD', 'KeyW', 'KeyV', 'KeyS'].map((code) => alt(code))).toEqual([
      { kind: 'align', mode: 'left' },
      { kind: 'align', mode: 'center' },
      { kind: 'align', mode: 'right' },
      { kind: 'align', mode: 'top' },
      { kind: 'align', mode: 'middle' },
      { kind: 'align', mode: 'bottom' },
    ]);
    expect(alt('KeyH', { shiftKey: true })).toEqual({ kind: 'distribute', axis: 'horizontal' });
    expect(alt('KeyV', { shiftKey: true })).toEqual({ kind: 'distribute', axis: 'vertical' });
    expect(alt('KeyT', { shiftKey: true })).toEqual({ kind: 'tidy', mode: 'grid' });
    // Shift on the others, a missing Alt, or ⌘ or Ctrl with it, is something else.
    expect(alt('KeyA', { shiftKey: true })).toBeNull();
    expect(alt('KeyT')).toBeNull();
    expect(alt('KeyA', { metaKey: true })).toBeNull();
    expect(arrangeForKey(key('a', { code: 'KeyA' }), false)).toBeNull();
  });

  it('reads ⌘⌥G (Ctrl+Alt+G on Windows) as a section round the selection (5.3)', () => {
    expect(arrangeForKey(key('©', { code: 'KeyG', metaKey: true, altKey: true }), true)).toEqual({ kind: 'sectionAround' });
    expect(arrangeForKey(key('g', { code: 'KeyG', ctrlKey: true, altKey: true }), false)).toEqual({ kind: 'sectionAround' });
    expect(arrangeForKey(key('g', { code: 'KeyG', ctrlKey: true, altKey: true }), true)).toBeNull();
    expect(arrangeForKey(key('g', { code: 'KeyG', metaKey: true }), true)).toBeNull();
    expect(arrangeForKey(key('g', { code: 'KeyG', ctrlKey: true, altKey: true, shiftKey: true }), false)).toBeNull();
  });
});
