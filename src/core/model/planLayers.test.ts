import { describe, expect, it } from 'vitest';
import { loadSettings, saveSettings } from '../storage/settings';
import { PLAN_LAYERS } from './plan';
import { ALL_SHOWN, LAYER_ORDER, layerNote, layerPickable, planLayerStatesOf, revealedStates, soloStates } from './planLayers';

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

  it('reads a layer missing or unreadable as shown and unlocked, and leaves out a layer it doesn’t know', () => {
    const read = planLayerStatesOf({ camera: { show: 'dimmed', locked: true }, lighting: { show: 'ghosted', locked: 'yes' }, underlay: { show: 'hidden' } });
    expect(read?.camera).toEqual({ show: 'dimmed', locked: true });
    expect(read?.lighting).toEqual({ show: 'shown', locked: false });
    expect(read?.grip).toEqual({ show: 'shown', locked: false });
    expect(Object.keys(read ?? {}).sort()).toEqual([...PLAN_LAYERS].sort());
    expect(planLayerStatesOf('hidden')).toBeNull();
    expect(planLayerStatesOf([])).toBeNull();
    expect(planLayerStatesOf(null)).toBeNull();
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

  it('solo keeps each layer’s lock; revealing shows and unlocks only what needs it', () => {
    const states = { ...ALL_SHOWN, grip: { show: 'hidden' as const, locked: true } };
    const solo = soloStates(states, 'camera');
    expect(solo.camera.show).toBe('shown');
    expect(solo.grip).toEqual({ show: 'dimmed', locked: true });
    const revealed = revealedStates(states, ['grip', 'camera']);
    expect(revealed.changed).toEqual(['grip']);
    expect(revealed.states.grip).toEqual({ show: 'shown', locked: false });
    expect(revealedStates(ALL_SHOWN, ['camera']).states).toBe(ALL_SHOWN);
  });
});
