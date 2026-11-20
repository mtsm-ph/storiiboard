import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../core/i18n';
import { stepButtonName } from './undoRedoNames';

// The top bar's Undo and Redo (item 8): named by the step each would take, with this platform's keys in the tip, in
// English and Spanish; with nothing to take, "Nothing to undo" and disabled.

afterEach(() => {
  setLocale('en');
});

describe('the top bar’s Undo and Redo names', () => {
  it('name the step and the keys off a Mac', () => {
    expect(stepButtonName('undo', 'Moved wall', false)).toEqual({
      label: 'Undo: Moved wall',
      tip: 'Undo: Moved wall · Ctrl+Z',
      keys: 'Control+Z',
      enabled: true,
    });
    expect(stepButtonName('redo', 'Moved wall', false)).toEqual({
      label: 'Redo: Moved wall',
      tip: 'Redo: Moved wall · Ctrl+Y or Ctrl+Shift+Z',
      keys: 'Control+Y Control+Shift+Z',
      enabled: true,
    });
  });

  it('name the step and the keys on a Mac', () => {
    expect(stepButtonName('undo', 'Moved wall', true)).toMatchObject({ label: 'Undo: Moved wall', tip: 'Undo: Moved wall · ⌘Z', keys: 'Meta+Z' });
    expect(stepButtonName('redo', 'Moved wall', true)).toMatchObject({ label: 'Redo: Moved wall', tip: 'Redo: Moved wall · ⌘⇧Z', keys: 'Meta+Shift+Z' });
  });

  it('say there is nothing to take, disabled, still with the keys in the tip', () => {
    expect(stepButtonName('undo', null, false)).toEqual({ label: 'Nothing to undo', tip: 'Nothing to undo · Ctrl+Z', keys: 'Control+Z', enabled: false });
    expect(stepButtonName('redo', null, true)).toEqual({ label: 'Nothing to redo', tip: 'Nothing to redo · ⌘⇧Z', keys: 'Meta+Shift+Z', enabled: false });
  });

  it('speak Spanish', () => {
    setLocale('es');
    expect(stepButtonName('undo', 'Se movió el muro', false)).toMatchObject({ label: 'Deshacer: Se movió el muro', tip: 'Deshacer: Se movió el muro · Ctrl+Z' });
    expect(stepButtonName('redo', 'Se movió el muro', false).tip).toBe('Rehacer: Se movió el muro · Ctrl+Y o Ctrl+Mayús+Z');
    expect(stepButtonName('redo', 'Se movió el muro', true).tip).toBe('Rehacer: Se movió el muro · ⌘⇧Z');
    expect(stepButtonName('undo', null, true)).toMatchObject({ label: 'Nada que deshacer', tip: 'Nada que deshacer · ⌘Z', enabled: false });
    expect(stepButtonName('redo', null, false).label).toBe('Nada que rehacer');
  });
});
