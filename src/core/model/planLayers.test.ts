import { describe, expect, it } from 'vitest';
import { loadSettings, saveSettings } from '../storage/settings';
import { PLAN_LAYERS } from './plan';
import { ALL_SHOWN, keepUnknownRows, LAYER_ORDER, LAYER_ROWS, layerNote, layerPickable, myDepartmentStates, planLayerStatesOf, revealedStates, soloStates } from './planLayers';

// The layers' state (6.8) as this computer's settings keep it: read by an older settings file without the field, a
// newer one's values read as shown, and the small rules the Plan and Layers tiles share.

const memory = () => {
  const kept = new Map<string, string>();
  return { kept, storage: { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) } };
};

describe('the planLayers setting', () => {
  it('is null in settings from before 6.8, so the start follows the person’s department', () => {
    const { kept, storage } = memory();
    expect(loadSettings(storage).planLayers).toBeNull();
    kept.set('storiiboard.settings', JSON.stringify({ planUnits: 'feet' }));
    expect(loadSettings(storage).planLayers).toBeNull();
    expect(loadSettings(storage).planUnits).toBe('feet');
  });

  it('keeps what was chosen, each layer on its own', () => {
    const { storage } = memory();
    const chosen = { ...ALL_SHOWN, lighting: { show: 'hidden' as const, locked: false }, 'set-art': { show: 'dimmed' as const, locked: true } };
    saveSettings({ planLayers: chosen }, storage);
    expect(loadSettings(storage).planLayers).toEqual(chosen);
  });

  it('reads a layer missing or unreadable as shown and unlocked, and keeps a row it doesn’t know as stored', () => {
    const read = planLayerStatesOf({ camera: { show: 'dimmed', locked: true }, lighting: { show: 'ghosted', locked: 'yes' }, underlay: { show: 'hidden', opacity: 0.4 } });
    expect(read?.camera).toEqual({ show: 'dimmed', locked: true });
    expect(read?.lighting).toEqual({ show: 'shown', locked: false });
    expect(read?.grip).toEqual({ show: 'shown', locked: false });
    // A newer version's row (6.9's underlay, say): never read, never dropped.
    expect(Object.keys(read ?? {}).sort()).toEqual([...PLAN_LAYERS, 'underlay'].sort());
    expect((read as Record<string, unknown> | null)?.underlay).toEqual({ show: 'hidden', opacity: 0.4 });
    expect(planLayerStatesOf('hidden')).toBeNull();
    expect(planLayerStatesOf([])).toBeNull();
    expect(planLayerStatesOf(null)).toBeNull();
  });
});

describe('a newer version’s layer rows (6.8 review, L9)', () => {
  it('survive any setting saved by this version, and a layer change', () => {
    const { kept, storage } = memory();
    kept.set('storiiboard.settings', JSON.stringify({ planLayers: { ...ALL_SHOWN, camera: { show: 'hidden', locked: false }, underlay: { show: 'dimmed', locked: true, extra: 'x' } } }));
    // Another setting saved: the whole object is read and written again, the unknown row with it.
    saveSettings({ planUnits: 'feet' }, storage);
    const after = JSON.parse(kept.get('storiiboard.settings') ?? '{}') as { planLayers: Record<string, unknown> };
    expect(after.planLayers.underlay).toEqual({ show: 'dimmed', locked: true, extra: 'x' });
    expect(after.planLayers.camera).toEqual({ show: 'hidden', locked: false });
    // A change of the layers built afresh (Show all) carries the row too.
    const stored = loadSettings(storage).planLayers;
    const next = keepUnknownRows(stored, ALL_SHOWN) as Record<string, unknown>;
    expect(next.underlay).toEqual({ show: 'dimmed', locked: true, extra: 'x' });
    expect(next.camera).toEqual({ show: 'shown', locked: false });
  });

  it('is one list of the rows this version knows, the department layers', () => {
    expect([...LAYER_ROWS].sort()).toEqual([...PLAN_LAYERS].sort());
  });
});

describe('the layer rules', () => {
  it('order the layers as the call sheet orders their departments', () => {
    expect(LAYER_ORDER).toEqual(['camera', 'lighting', 'grip', 'set-art', 'sound', 'production', 'cast']);
  });

  it('pick only a drawn, unlocked layer’s items; an item with no layer always', () => {
    const states = { ...ALL_SHOWN, camera: { show: 'hidden' as const, locked: false }, cast: { show: 'dimmed' as const, locked: false }, grip: { show: 'shown' as const, locked: true } };
    expect(layerPickable(states, 'camera')).toBe(false);
    expect(layerPickable(states, 'cast')).toBe(true);
    expect(layerPickable(states, 'grip')).toBe(false);
    expect(layerPickable(states, null)).toBe(true);
    expect(layerNote(states)).toEqual({ hidden: 1, locked: 1 });
  });

  it('solo dims and locks every other layer, the solo layer keeping its own lock; revealing shows and unlocks only what needs it', () => {
    const states = { ...ALL_SHOWN, grip: { show: 'hidden' as const, locked: true }, camera: { show: 'dimmed' as const, locked: true } };
    const solo = soloStates(states, 'camera');
    expect(solo.camera).toEqual({ show: 'shown', locked: true });
    expect(solo.grip).toEqual({ show: 'dimmed', locked: true });
    expect(solo.lighting).toEqual({ show: 'dimmed', locked: true });
    expect(soloStates(ALL_SHOWN, 'cast').cast).toEqual({ show: 'shown', locked: false });
    const revealed = revealedStates(states, ['grip', 'lighting']);
    expect(revealed.changed).toEqual(['grip']);
    expect(revealed.did).toBe('both');
    expect(revealed.states.grip).toEqual({ show: 'shown', locked: false });
    expect(revealedStates(ALL_SHOWN, ['camera']).states).toBe(ALL_SHOWN);
  });

  it('says what revealing did: shown, unlocked, or both (L4)', () => {
    const hidden = { ...ALL_SHOWN, lighting: { show: 'hidden' as const, locked: false }, grip: { show: 'hidden' as const, locked: false } };
    expect(revealedStates(hidden, ['lighting', 'grip'])).toMatchObject({ changed: ['lighting', 'grip'], did: 'shown' });
    const locked = { ...ALL_SHOWN, cast: { show: 'dimmed' as const, locked: true } };
    expect(revealedStates(locked, ['cast'])).toMatchObject({ changed: ['cast'], did: 'unlocked' });
    expect(revealedStates(locked, ['cast']).states.cast).toEqual({ show: 'shown', locked: false });
    const mixed = { ...hidden, cast: { show: 'shown' as const, locked: true } };
    expect(revealedStates(mixed, ['lighting', 'cast'])).toMatchObject({ changed: ['lighting', 'cast'], did: 'both' });
  });

  it('start the director and the DP on every layer whatever Full view says; anyone else by their department (L10)', () => {
    expect(myDepartmentStates({ role: 'dp', fullView: false, departments: ['camera'] })).toBe(ALL_SHOWN);
    expect(myDepartmentStates({ role: 'director', fullView: false, departments: ['direction'] })).toBe(ALL_SHOWN);
    expect(myDepartmentStates({ role: 'director-dp', fullView: false, departments: ['camera', 'direction'] })).toBe(ALL_SHOWN);
    // Anyone else in camera (no role, or Other with Camera picked) starts on the camera layer.
    const operator = myDepartmentStates({ role: 'other', fullView: false, departments: ['camera'] });
    expect(operator.camera.show).toBe('shown');
    expect(operator.lighting.show).toBe('dimmed');
    // The same department gives the same object, so a reader keyed on it builds nothing again (L8).
    expect(myDepartmentStates({ fullView: false, departments: ['camera'] })).toBe(operator);
  });
});
