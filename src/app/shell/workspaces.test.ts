import { describe, expect, it } from 'vitest';
import { WORKSPACES, workspaceForShortcut } from './workspaces';

const key = (
  code: string,
  mods: Partial<Record<'altKey' | 'metaKey' | 'ctrlKey' | 'shiftKey', boolean>> = {},
  target: EventTarget | null = null,
) => ({ altKey: false, metaKey: false, ctrlKey: false, shiftKey: false, code, target, ...mods });

// Stand-ins for the focused element; the tests run without a DOM.
const element = (tagName: string, extra: { type?: string; isContentEditable?: boolean } = {}) =>
  ({ tagName, type: extra.type, isContentEditable: extra.isContentEditable ?? false }) as unknown as EventTarget;

describe('workspaces', () => {
  it('are the four from the design, in order', () => {
    expect(WORKSPACES.map((w) => w.label)).toEqual(['Storyboard', 'Production', "Bird's-eye", 'Call sheet']);
  });

  it('place every tile in a named grid area, numbered in order', () => {
    for (const workspace of WORKSPACES) {
      const areas = workspace.areas.replace(/"/g, ' ').split(/\s+/).filter(Boolean);
      for (const tile of workspace.tiles) expect(areas).toContain(tile.area);
      expect(workspace.tiles.map((t) => t.index)).toEqual(workspace.tiles.map((_, i) => i + 1));
    }
  });

  it('switch with Alt+1 to Alt+4 by key position, whatever character Option types', () => {
    expect(workspaceForShortcut(key('Digit1', { altKey: true }))?.id).toBe('storyboard');
    expect(workspaceForShortcut(key('Digit4', { altKey: true }))?.id).toBe('callsheet');
    expect(workspaceForShortcut(key('Digit5', { altKey: true }))).toBeUndefined();
    expect(workspaceForShortcut(key('Digit2'))).toBeUndefined();
    expect(workspaceForShortcut(key('Digit2', { altKey: true, metaKey: true }))).toBeUndefined();
  });

  it('step aside in text fields, where Option+number types a character (# on a British Mac)', () => {
    const alt3 = (target: EventTarget) => workspaceForShortcut(key('Digit3', { altKey: true }, target));
    expect(alt3(element('INPUT', { type: 'text' }))).toBeUndefined();
    expect(alt3(element('INPUT', { type: 'search' }))).toBeUndefined();
    expect(alt3(element('TEXTAREA'))).toBeUndefined();
    expect(alt3(element('DIV', { isContentEditable: true }))).toBeUndefined();
    expect(alt3(element('INPUT', { type: 'range' }))?.id).toBe('birdseye');
    expect(alt3(element('BUTTON'))?.id).toBe('birdseye');
  });
});
