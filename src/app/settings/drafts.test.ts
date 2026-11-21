import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../../core/i18n';
import { loadSettings, SETTINGS_KEY } from '../../core/storage/settings';
import { createStore } from 'zustand/vanilla';
import type { ask } from '../ask';
import { noticeStore } from '../notice';
import { setPlanUnitsChoice } from '../planUnits';
import { projectStore } from '../projectStore';
import { applyDrafts, discardDrafts, draftOf, draftStore, dropProjectDraftsOnSwitch, hasDrafts, setDraft } from './drafts';
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
    void applyDrafts();
    expect(units.state.writes).toEqual(['metric']);
    expect(week.state.writes).toEqual(['monday']);
    expect(hasDrafts()).toBe(false);
    void applyDrafts();
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
    void applyDrafts();
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

describe('Apply never loses a draft (round 2)', () => {
  it('a setter that throws keeps its draft waiting and says why; the rest apply and clear', async () => {
    const week = fakeSetting('region');
    const directions = fakeSetting('google');
    setDraft('weekStart', 'monday', week.state.value, week.write);
    setDraft('language', 'es', 'en', () => {
      throw new Error('disk full');
    });
    setDraft('directionsApp', 'apple', directions.state.value, directions.write);
    expect(await applyDrafts()).toBe(false);
    expect(week.state.writes).toEqual(['monday']);
    expect(directions.state.writes).toEqual(['apple']);
    expect(Object.keys(draftStore.getState().drafts)).toEqual(['language']);
    expect(noticeStore.getState()).toMatchObject({ kind: 'warning', message: 'A change wasn’t applied, and still waits: disk full' });
  });

  it('an async setter is cleared once written; one that rejects stays waiting', async () => {
    let finish: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => {
      finish = resolve;
    });
    setDraft('slowSetting', 30, 50, () => slow);
    setDraft('refusedSetting', 20, 10, () => Promise.reject(new Error('refused')));
    const applying = applyDrafts();
    // Still being written: still waiting, never dropped before it lands.
    expect(Object.keys(draftStore.getState().drafts)).toEqual(['slowSetting', 'refusedSetting']);
    finish();
    expect(await applying).toBe(false);
    expect(Object.keys(draftStore.getState().drafts)).toEqual(['refusedSetting']);
    expect(draftOf('refusedSetting', 10)).toBe(20);
  });

  it('a draft changed again while its setter writes stays waiting, as changed', async () => {
    let finish: () => void = () => undefined;
    setDraft('slowSetting', 30, 50, () => new Promise<void>((resolve) => (finish = resolve)));
    const applying = applyDrafts();
    setDraft('slowSetting', 40, 50, () => undefined);
    finish();
    expect(await applying).toBe(true);
    expect(draftOf('slowSetting', 50)).toBe(40);
  });

  it('closing with Apply when one fails keeps the window open with it waiting', async () => {
    openSettings('app');
    setDraft('language', 'es', 'en', () => {
      throw new Error('disk full');
    });
    expect(await requestCloseSettings(() => true, answering('apply').asker)).toBe('keep');
    expect(settingsStore.getState().open).toBe(true);
    expect(hasDrafts()).toBe(true);
  });
});

describe('a project switch with drafts waiting (round 2)', () => {
  it('drops the drafts of the project left (Your role on this project) and keeps this computer’s', () => {
    const projects = createStore<{ project: { projectId: string } | null }>()(() => ({ project: { projectId: 'p1' } }));
    const stop = dropProjectDraftsOnSwitch(projects);
    setDraft('projectRole:p1', 'dp', null, () => undefined, 'p1');
    setDraft('weekStart', 'monday', 'region', () => undefined);
    // A change in the store that isn't another project keeps both.
    projects.setState((s) => ({ ...s }));
    expect(Object.keys(draftStore.getState().drafts)).toEqual(['projectRole:p1', 'weekStart']);
    // Open backup: a copy of the same project, but another file open in place.
    projects.setState({ project: { projectId: 'p1' } });
    expect(Object.keys(draftStore.getState().drafts)).toEqual(['weekStart']);
    setDraft('projectRole:p1', 'director', null, () => undefined, 'p1');
    projects.setState({ project: null });
    expect(Object.keys(draftStore.getState().drafts)).toEqual(['weekStart']);
    stop();
  });

  it('the app’s project store drops them too', () => {
    setDraft('projectRole:p1', 'dp', null, () => undefined, 'p1');
    projectStore.setState({ project: {} as NonNullable<ReturnType<typeof projectStore.getState>['project']> });
    expect(hasDrafts()).toBe(false);
    projectStore.setState({ project: null });
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
