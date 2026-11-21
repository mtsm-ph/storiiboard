import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../../core/i18n';
import { loadSettings, SETTINGS_KEY } from '../../core/storage/settings';
import type { ask } from '../ask';
import { setPlanUnitsChoice } from '../planUnits';
import { applyDrafts, discardDrafts, draftOf, draftStore, hasDrafts, setDraft } from './drafts';
import { requestCloseSettings } from './settingsClose';
import { closeSettings, openSettings, settingsStore } from './settingsStore';

// Settings wait for Apply (Kevin, Nov 17): a change in the Settings window is a draft until Apply writes it through its
// own setter or Discard drops it; closing with one waiting asks, and closes only on Apply or Discard.

let kept: Map<string, string>;

beforeEach(() => {
  setLocale('en');
  kept = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: (k: string, v: string) => void kept.set(k, v),
    removeItem: (k: string) => void kept.delete(k),
  });
});

afterEach(() => {
  discardDrafts();
  closeSettings();
  vi.unstubAllGlobals();
});

/** A setting kept in a plain variable, and every write it took. */
function fakeSetting<T>(start: T) {
  const state = { value: start, writes: [] as T[] };
  return {
    state,
    write: (next: T) => {
      state.value = next;
      state.writes.push(next);
    },
  };
}

/** An asker that answers as told and remembers what it was asked. */
function answering(id: string) {
  const asked: string[] = [];
  const asker: typeof ask = (question) => {
    asked.push(question.title);
    return Promise.resolve(id);
  };
  return { asked, asker };
}

describe('drafts', () => {
  it('a change waits: shown in Settings, nothing written', () => {
    const units = fakeSetting('region');
    setDraft('weatherUnits', 'metric', units.state.value, units.write);
    expect(hasDrafts()).toBe(true);
    expect(draftOf('weatherUnits', units.state.value)).toBe('metric');
    expect(units.state.writes).toEqual([]);
  });

  it('Apply writes each draft through its own setter, once, and clears them', () => {
    const units = fakeSetting('region');
    const week = fakeSetting('region');
    setDraft('weatherUnits', 'metric', units.state.value, units.write);
    setDraft('weekStart', 'monday', week.state.value, week.write);
    applyDrafts();
    expect(units.state.writes).toEqual(['metric']);
    expect(week.state.writes).toEqual(['monday']);
    expect(hasDrafts()).toBe(false);
    applyDrafts();
    expect(units.state.writes).toEqual(['metric']);
  });

  it('Discard drops them: nothing written, Settings shows what is applied', () => {
    const units = fakeSetting('region');
    setDraft('weatherUnits', 'metric', units.state.value, units.write);
    discardDrafts();
    expect(hasDrafts()).toBe(false);
    expect(draftOf('weatherUnits', units.state.value)).toBe('region');
    expect(units.state.writes).toEqual([]);
  });

  it('a draft set back to what is applied goes, so nothing waits', () => {
    const units = fakeSetting('region');
    setDraft('weatherUnits', 'metric', units.state.value, units.write);
    setDraft('weatherUnits', 'region', units.state.value, units.write);
    expect(hasDrafts()).toBe(false);
  });

  it('a real setting: Plan units stays as it was in this computer’s settings until Apply', () => {
    expect(loadSettings().planUnits).toBe('region');
    setDraft('planUnits', 'feet', 'region', setPlanUnitsChoice);
    expect(loadSettings().planUnits).toBe('region');
    expect(kept.has(SETTINGS_KEY)).toBe(false);
    applyDrafts();
    expect(loadSettings().planUnits).toBe('feet');
    setPlanUnitsChoice('region');
  });

  it('closing the window drops what waits: a draft never outlives it', () => {
    openSettings('app');
    setDraft('weekStart', 'monday', 'region', () => undefined);
    closeSettings();
    expect(hasDrafts()).toBe(false);
  });
});

describe('closing Settings with changes waiting', () => {
  it('nothing waiting: closes at once, without asking', async () => {
    openSettings('app');
    const { asked, asker } = answering('apply');
    expect(await requestCloseSettings(() => true, asker)).toBe('closed');
    expect(asked).toEqual([]);
    expect(settingsStore.getState().open).toBe(false);
  });

  it('asks; Apply writes and closes', async () => {
    openSettings('app');
    const units = fakeSetting('region');
    setDraft('weatherUnits', 'us', units.state.value, units.write);
    const { asked, asker } = answering('apply');
    expect(await requestCloseSettings(() => true, asker)).toBe('apply');
    expect(asked).toEqual(['Apply your changes?']);
    expect(units.state.writes).toEqual(['us']);
    expect(settingsStore.getState().open).toBe(false);
  });

  it('asks; Discard writes nothing and closes', async () => {
    openSettings('app');
    const units = fakeSetting('region');
    setDraft('weatherUnits', 'us', units.state.value, units.write);
    const { asker } = answering('discard');
    expect(await requestCloseSettings(() => true, asker)).toBe('discard');
    expect(units.state.writes).toEqual([]);
    expect(hasDrafts()).toBe(false);
    expect(settingsStore.getState().open).toBe(false);
  });

  it('asks; Keep editing (or Escape on the question) leaves the window open with its changes still waiting', async () => {
    openSettings('app');
    const units = fakeSetting('region');
    setDraft('weatherUnits', 'us', units.state.value, units.write);
    const mount = settingsStore.getState().mount;
    expect(await requestCloseSettings(() => true, answering('keep').asker)).toBe('keep');
    expect(settingsStore.getState().open).toBe(true);
    expect(settingsStore.getState().mount).toBe(mount);
    expect(hasDrafts()).toBe(true);
    expect(units.state.writes).toEqual([]);
  });

  it('Keep editing after the engine closed the dialog by itself draws the window again, its changes kept', async () => {
    openSettings('app');
    setDraft('weatherUnits', 'us', 'region', () => undefined);
    const mount = settingsStore.getState().mount;
    expect(await requestCloseSettings(() => false, answering('keep').asker)).toBe('keep');
    expect(settingsStore.getState()).toMatchObject({ open: true, mount: mount + 1 });
    expect(hasDrafts()).toBe(true);
  });

  it('asks in Spanish too', async () => {
    setLocale('es');
    openSettings('app');
    setDraft('weatherUnits', 'us', 'region', () => undefined);
    const { asked, asker } = answering('keep');
    await requestCloseSettings(() => true, asker);
    expect(asked).toEqual(['¿Aplicar tus cambios?']);
    expect(Object.keys(draftStore.getState().drafts)).toEqual(['weatherUnits']);
  });
});
