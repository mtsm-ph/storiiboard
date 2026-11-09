import { describe, expect, it } from 'vitest';
import { tilesIn } from './docking/layout';
import { DEPARTMENTS } from '../../core/model/department';
import { ALL_WORKSPACES, DEPARTMENT_WORKSPACES, departmentOf, departmentWorkspaceId, TILES, WORKSPACES, workspaceById, workspaceForShortcut } from './workspaces';

const key = (
  code: string,
  mods: Partial<Record<'altKey' | 'metaKey' | 'ctrlKey' | 'shiftKey', boolean>> = {},
  target: EventTarget | null = null,
) => ({ altKey: false, metaKey: false, ctrlKey: false, shiftKey: false, code, target, ...mods });

// Stand-ins for the focused element; the tests run without a DOM.
const element = (tagName: string, extra: { type?: string; isContentEditable?: boolean } = {}) =>
  ({ tagName, type: extra.type, isContentEditable: extra.isContentEditable ?? false }) as unknown as EventTarget;

describe('workspaces', () => {
  it("are the six sidebar sections, in the sidebar's order (Settings is a window, polish B)", () => {
    expect(WORKSPACES.map((w) => w.label)).toEqual(['Storyboard', 'Assets', 'Team', 'Setup', 'Production', 'Moodboard']);
  });

  it('put Calendar in Production, and Notifications and Trash in none', () => {
    const holding = (tile: string) => WORKSPACES.filter((w) => tilesIn(w.defaultLayout()).includes(tile)).map((w) => w.id);
    expect(holding('calendar')).toEqual(['production']);
    expect(holding('notifications')).toEqual([]);
    expect(holding('trash')).toEqual([]);
  });

  it('lay out known tiles, each once, and hand out a fresh copy every time', () => {
    for (const workspace of ALL_WORKSPACES) {
      const tiles = tilesIn(workspace.defaultLayout());
      expect(tiles.every((tile) => tile in TILES)).toBe(true);
      expect(new Set(tiles).size).toBe(tiles.length);
      expect(workspace.defaultLayout()).not.toBe(workspace.defaultLayout());
    }
  });

  it('switch with Alt+1 to Alt+6 by key position, whatever character Option types', () => {
    expect(workspaceForShortcut(key('Digit1', { altKey: true }))?.id).toBe('storyboard');
    expect(workspaceForShortcut(key('Digit5', { altKey: true }))?.id).toBe('production');
    expect(workspaceForShortcut(key('Digit6', { altKey: true }))?.id).toBe('moodboard');
    expect(workspaceForShortcut(key('Digit7', { altKey: true }))).toBeUndefined();
    expect(workspaceForShortcut(key('Digit8', { altKey: true }))).toBeUndefined();
    expect(workspaceForShortcut(key('Digit2'))).toBeUndefined();
    expect(workspaceForShortcut(key('Digit2', { altKey: true, metaKey: true }))).toBeUndefined();
  });

  it('step aside in text fields, where Option+number types a character (# on a British Mac)', () => {
    const alt3 = (target: EventTarget) => workspaceForShortcut(key('Digit3', { altKey: true }, target));
    expect(alt3(element('INPUT', { type: 'text' }))).toBeUndefined();
    expect(alt3(element('INPUT', { type: 'search' }))).toBeUndefined();
    expect(alt3(element('TEXTAREA'))).toBeUndefined();
    expect(alt3(element('DIV', { isContentEditable: true }))).toBeUndefined();
    expect(alt3(element('INPUT', { type: 'range' }))?.id).toBe('team');
    expect(alt3(element('BUTTON'))?.id).toBe('team');
  });

  it('step aside inside a modal dialog, whatever the dialog', () => {
    const inDialog = (projectUndo: boolean) =>
      ({ tagName: 'BUTTON', isContentEditable: false, closest: () => ({ hasAttribute: () => projectUndo }) }) as unknown as EventTarget;
    expect(workspaceForShortcut(key('Digit3', { altKey: true }, inDialog(false)))).toBeUndefined();
    expect(workspaceForShortcut(key('Digit3', { altKey: true }, inDialog(true)))).toBeUndefined();
  });

  it('have one per department too (3.6a), named as the department, with its view between the scenes and the inspector', () => {
    expect(DEPARTMENT_WORKSPACES.map((w) => departmentOf(w.id))).toEqual([...DEPARTMENTS]);
    const camera = workspaceById(departmentWorkspaceId('camera'));
    expect(camera.label).toBe('Camera');
    expect(camera.phase).toBeNull();
    expect(tilesIn(camera.defaultLayout())).toEqual(['scenes', 'department', 'inspector']);
    // Ids never collide, sections and departments together, and a section belongs to no department.
    expect(new Set(ALL_WORKSPACES.map((w) => w.id)).size).toBe(ALL_WORKSPACES.length);
    expect(WORKSPACES.every((w) => departmentOf(w.id) === null)).toBe(true);
    expect(departmentOf('department-grip-electric')).toBe('grip-electric');
  });

  it('keep Alt+1 to Alt+6 for the sections alone', () => {
    const reached = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => workspaceForShortcut(key(`Digit${String(n)}`, { altKey: true }))?.id);
    expect(reached.filter((id) => id !== undefined)).toEqual(WORKSPACES.map((w) => w.id));
  });
});
