import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BOARD_GRID_KEY, CANVAS_VIEW_KEY, DEFAULT_SETTINGS, loadSettings, SETTINGS_KEY, TRACKPAD_MODE_KEY, type Settings } from '../storage/settings';
import { ALL_SHOWN } from './planLayers';
import type { Props, SbdRecord } from './record';
import {
  beforePresetName,
  cleanLayout,
  cleanPresetName,
  deletePresetChanges,
  NEVER_IN_PRESET,
  nextPresetName,
  NOT_A_SETTING,
  PRESET_FIELDS,
  PRESET_SOURCES,
  presetNamed,
  presetSettingsOf,
  presetSettingsProp,
  presetsOf,
  renamePresetChanges,
  savePresetChanges,
  WORKED_OUT_NEVER_IN_PRESET,
  type PresetSettings,
} from './settingsPreset';

// What a settings preset holds (6.5.8): one list in the code, and every setting this computer keeps is in it or in the
// list of what never is, so a setting added later has to be put in one of them. A preset is read as untrusted input.

const root = join(__dirname, '..', '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(path);
    return /\.(tsx?|js)$/.test(name) && !/\.test\.tsx?$|\.d\.ts$/.test(name) ? [path] : [];
  });
}

const settingSources = Object.values(PRESET_SOURCES).flatMap((s) => ('setting' in s ? [s.setting] : []));
const ownKeySources = Object.values(PRESET_SOURCES).flatMap((s) => ('storageKey' in s ? [s.storageKey] : []));

describe('the two lists', () => {
  it('put every key of the settings object in exactly one of them', () => {
    const keys = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];
    // What the reader gives back has the same keys as the defaults: nothing read that the walk would miss.
    expect(Object.keys(loadSettings({ getItem: () => '{}' })).sort()).toEqual([...keys].sort());
    for (const key of keys) {
      const inPreset = settingSources.includes(key);
      const never = Object.hasOwn(NEVER_IN_PRESET, key);
      expect(inPreset !== never, `${key}: in a preset ${String(inPreset)}, never ${String(never)}`).toBe(true);
    }
  });

  it('put every storage key the app writes in a list: in a preset, never, or not a setting', () => {
    const found = new Set<string>();
    // The web companion and the MCP server too, once they have folders of their own. What this can't see: a key built
    // from parts ('storiiboard.' + name), which no code here does; such a key would need its own line in a list.
    const folders = ['src', 'public', 'web', 'mcp'].map((f) => join(root, f)).filter((dir) => existsSync(dir));
    for (const path of folders.flatMap(sourceFiles)) {
      // Up to the closing quote, whatever the key holds (`_`, digits, dots); a template's `${…}` ends it.
      for (const match of readFileSync(path, 'utf8').matchAll(/['"`](storiiboard\.[^'"`\s$]*)/g)) {
        // A key built from a name (`storiiboard.app-data.${name}`) is counted by its fixed start.
        found.add((match[1] ?? '').replace(/\.$/, ''));
      }
    }
    expect([...found]).toEqual(expect.arrayContaining([SETTINGS_KEY, CANVAS_VIEW_KEY, BOARD_GRID_KEY, TRACKPAD_MODE_KEY, 'storiiboard.layouts.2']));
    for (const key of found) {
      const places = [ownKeySources.includes(key), Object.hasOwn(NEVER_IN_PRESET, key), Object.hasOwn(NOT_A_SETTING, key)].filter(Boolean);
      expect(places.length, `${key} must be in exactly one list`).toBe(1);
    }
  });

  it('name nothing that isn’t a setting, and give every one in the never list its reason', () => {
    const settingKeys = Object.keys(DEFAULT_SETTINGS);
    for (const [key, reason] of Object.entries(NEVER_IN_PRESET)) {
      expect(settingKeys.includes(key) || key.startsWith('storiiboard.'), key).toBe(true);
      expect(reason.length).toBeGreaterThan(10);
    }
    expect([...PRESET_FIELDS].sort()).toEqual(Object.keys(PRESET_SOURCES).sort());
  });

  it('keep look and layout only: the never list is Kevin’s, trackpad mode among it', () => {
    for (const key of ['language', 'weekStart', 'weatherUnits', 'planUnits', 'callSheetPaper', 'directionsApp', 'backups', 'backupsNextToProject', 'profile', 'projectRoles', 'projectSelves', 'companies', 'syncNoted', 'tilesOffered', 'sidebarHidden', TRACKPAD_MODE_KEY]) {
      expect(Object.hasOwn(NEVER_IN_PRESET, key), key).toBe(true);
    }
    expect(settingSources.sort()).toEqual(['customWorkspaces', 'departmentWorkspaces', 'pdfScenePalettes', 'planLayers', 'theme', 'themeChosen']);
    expect(ownKeySources.sort()).toEqual([BOARD_GRID_KEY, CANVAS_VIEW_KEY].sort());
  });
});

describe('settings worked out, never stored (Kevin, Nov 18)', () => {
  it('keep the Measurement system out of every preset, read only from settings that are in the never list', () => {
    expect(Object.keys(WORKED_OUT_NEVER_IN_PRESET)).toEqual(['measurementSystem']);
    for (const [name, { from, reason }] of Object.entries(WORKED_OUT_NEVER_IN_PRESET)) {
      expect((PRESET_FIELDS as readonly string[]).includes(name), name).toBe(false);
      expect(Object.hasOwn(PRESET_SOURCES, name), name).toBe(false);
      // Never a key of its own: what's kept is what it's read from, and that never goes in a preset either.
      expect(Object.keys(DEFAULT_SETTINGS).includes(name), name).toBe(false);
      expect(from.length).toBeGreaterThan(0);
      for (const key of from) expect(Object.hasOwn(NEVER_IN_PRESET, key), key).toBe(true);
      expect(reason.length).toBeGreaterThan(10);
    }
    expect(WORKED_OUT_NEVER_IN_PRESET.measurementSystem?.from).toEqual(['weatherUnits', 'planUnits']);
  });
});

const layout = { root: { kind: 'stack', id: 's1', tiles: ['storyboard'], active: 'storyboard' }, maximized: null };
/** The tiles "this version" knows in these tests: the storyboard and numbered ones. */
const isTile = (id: string) => id === 'storyboard' || /^t\d+$/.test(id);
const full: PresetSettings = {
  theme: 'dark',
  themeChosen: true,
  canvasViews: { plan: 'dark', board: 'paper' },
  boardGrid: { boardGrid: true, boardGridSnap: false },
  customWorkspaces: [{ id: 'custom-1234abcd-0000', name: 'Lighting day', layout, order: ['storyboard'] }],
  departmentWorkspaces: ['camera', 'sound'],
  planLayers: { ...ALL_SHOWN, grip: { show: 'hidden', locked: false } },
  pdfScenePalettes: true,
};

describe('a preset read as untrusted input', () => {
  it('reads every field it knows through its reader', () => {
    const read = presetSettingsOf(JSON.parse(JSON.stringify(full)), isTile);
    expect(read.settings).toEqual(full);
    expect(read.skipped).toEqual([]);
    expect(read.dropped).toEqual([]);
    expect(read.tooLarge).toBe(false);
  });

  it('leaves a field any part of which it can’t read exactly as it is, and names it: never defaulted or emptied', () => {
    const read = presetSettingsOf(
      {
        theme: 'purple',
        themeChosen: 'yes',
        // One view it doesn't know: the whole field stays, never read as paper.
        canvasViews: { plan: 'dark', board: 7 },
        boardGrid: { boardGrid: true, boardGridSnap: 'yes' },
        // One workspace unusable (a newer version's tile): the whole list stays, so none is ever deleted for it.
        customWorkspaces: [full.customWorkspaces[0], { id: 'custom-1234abcd-0001', name: 'Scout', layout: { ...layout, root: { ...layout.root, tiles: ['hologram'], active: 'hologram' } } }],
        departmentWorkspaces: ['sound', 'catering'],
        planLayers: { ...ALL_SHOWN, grip: { show: 'invisible', locked: false } },
        pdfScenePalettes: 1,
      },
      isTile,
    );
    expect(read.settings).toEqual({});
    expect(read.dropped.sort()).toEqual([...PRESET_FIELDS].sort());
    // Each part alone is enough.
    expect(presetSettingsOf({ canvasViews: { plan: 'dark' } }).dropped).toEqual(['canvasViews']);
    expect(presetSettingsOf({ canvasViews: { plan: 'dark', board: 'paper', deck: 'dark' } }).dropped).toEqual(['canvasViews']);
    expect(presetSettingsOf({ boardGrid: 7 }).dropped).toEqual(['boardGrid']);
    expect(presetSettingsOf({ planLayers: 'hidden' }).dropped).toEqual(['planLayers']);
  });

  it('reads only the plan layer rows this version knows, never writing another', () => {
    const read = presetSettingsOf({ planLayers: { grip: { show: 'hidden', locked: true }, rigging: { show: 'dimmed', locked: true } } });
    expect(read.settings.planLayers).toEqual({ ...ALL_SHOWN, grip: { show: 'hidden', locked: true } });
    expect(Object.keys(read.settings.planLayers ?? {})).not.toContain('rigging');
  });

  it('skips a field from a newer version, naming it cleaned, and applies the rest', () => {
    const read = presetSettingsOf({ theme: 'light', rulerUnits: 'picas', '‮evil\u0000': 1 });
    expect(read.settings).toEqual({ theme: 'light' });
    expect(read.skipped).toEqual(['rulerUnits', 'evil']);
    // Thousands of them are named twenty at a time, the rest counted.
    const many = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`field${String(i)}`, i]));
    expect(presetSettingsOf(many).skipped).toHaveLength(21);
    expect(presetSettingsOf(many).skipped.at(-1)).toBe('+4980');
  });

  it('holds nothing when it isn’t an object, and keeps null layers as following the department', () => {
    expect(presetSettingsOf('dark')).toEqual({ settings: {}, skipped: [], dropped: [], tooLarge: false });
    expect(presetSettingsOf([full])).toEqual({ settings: {}, skipped: [], dropped: [], tooLarge: false });
    expect(presetSettingsOf({ planLayers: null }).settings).toEqual({ planLayers: null });
  });
});

describe('a preset bounded before anything is read (round 3)', () => {
  it('reads none of one over 512 KB: a 1 MB junk row', () => {
    const read = presetSettingsOf({ theme: 'dark', junk: 'x'.repeat(1024 * 1024) }, isTile);
    expect(read).toEqual({ settings: {}, skipped: [], dropped: [], tooLarge: true });
  });

  it('never recurses on untrusted depth: a 50,000-deep split, and one of 1,000 under the size limit', () => {
    const deep = (levels: number) => {
      let node: unknown = { kind: 'stack', id: 's', tiles: ['storyboard'], active: 'storyboard' };
      for (let i = 0; i < levels; i += 1) node = { kind: 'split', id: `p${String(i)}`, direction: 'row', children: [node, { kind: 'stack', id: `q${String(i)}`, tiles: [`t${String(i)}`], active: `t${String(i)}` }], sizes: [0.5, 0.5] };
      return { root: node, maximized: null };
    };
    const huge = { customWorkspaces: [{ id: 'custom-1234abcd-0002', name: 'Deep', layout: deep(50_000) }] };
    expect(() => presetSettingsOf(huge, isTile)).not.toThrow();
    expect(presetSettingsOf(huge, isTile).settings).toEqual({});
    const fifty = deep(50_000);
    expect(() => cleanLayout(fifty, isTile)).not.toThrow();
    expect(cleanLayout(fifty, isTile)).toBeNull();
    const thousand = { customWorkspaces: [{ id: 'custom-1234abcd-0003', name: 'Deep', layout: deep(1000) }] };
    expect(presetSettingsOf(thousand, isTile)).toMatchObject({ settings: {}, dropped: ['customWorkspaces'], tooLarge: false });
    // Within the limit, read: 15 splits deep.
    expect(cleanLayout(deep(15), isTile)).not.toBeNull();
    expect(cleanLayout(deep(16), isTile)).toBeNull();
  });

  it('reads no stack of 200,000 repeated tiles, no tile twice, and drops extra keys by refusing the node', () => {
    const tiles = Array.from({ length: 200_000 }, () => 'storyboard');
    expect(cleanLayout({ root: { kind: 'stack', id: 's', tiles, active: 'storyboard' }, maximized: null }, isTile)).toBeNull();
    expect(cleanLayout({ root: { kind: 'stack', id: 's', tiles: ['storyboard', 'storyboard'], active: 'storyboard' }, maximized: null }, isTile)).toBeNull();
    expect(cleanLayout({ root: { ...layout.root, onclick: 'x' }, maximized: null }, isTile)).toBeNull();
    expect(cleanLayout({ ...layout, extra: 1 }, isTile)).toBeNull();
    // Maximized names a stack (round 4): one there is read, a split's id or one not there is not.
    const two = { kind: 'split', id: 'sp', direction: 'row', children: [layout.root, { kind: 'stack', id: 's2', tiles: ['t1'], active: 't1' }], sizes: [0.5, 0.5] };
    expect(cleanLayout({ root: two, maximized: 's2' }, isTile)).not.toBeNull();
    expect(cleanLayout({ root: two, maximized: 'sp' }, isTile)).toBeNull();
    expect(cleanLayout({ root: two, maximized: 'gone' }, isTile)).toBeNull();
    // A workspace's saved layout is cleaned the same way: one unreadable leaves the list as it is.
    const ws = { id: 'custom-1234abcd-0009', name: 'Saved', layout };
    expect(presetSettingsOf({ customWorkspaces: [{ ...ws, saved: { root: two, maximized: null } }] }, isTile).settings.customWorkspaces?.[0]?.saved).toEqual({ root: two, maximized: null });
    expect(presetSettingsOf({ customWorkspaces: [{ ...ws, saved: { root: 'x' } }] }, isTile).dropped).toEqual(['customWorkspaces']);
    // A sound one comes back rebuilt, equal but never the same object.
    const clean = cleanLayout(layout, isTile);
    expect(clean).toEqual(layout);
    expect(clean?.root).not.toBe(layout.root);
  });

  it('is written with only the listed fields, in the list’s order', () => {
    // Handed more than the list (a caller's mistake): only the list is written.
    const more: PresetSettings & Record<string, unknown> = { ...full, language: 'es', profile: { name: 'Kevin' } };
    const prop = presetSettingsProp(more);
    expect(Object.keys(prop)).toEqual([...PRESET_FIELDS]);
  });
});

const at = '2026-11-16T12:00:00.000Z';
const rec = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, sortKey = 'a', trashedAt: string | null = null): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey,
  props,
  trashedAt,
  trashedBy: null,
  createdAt: at,
  updatedAt: at,
});
const records = (...list: SbdRecord[]) => Object.fromEntries(list.map((r) => [r.id, r]));

describe('presets as records', () => {
  const project = rec('p', 'project', null, { name: 'Bey County' });
  const night = rec('n', 'settings_preset', 'p', { name: 'Night', settings: {} }, 'b');
  const scout = rec('s', 'settings_preset', 'p', { name: 'Scout', settings: {} }, 'a');
  const gone = rec('g', 'settings_preset', 'p', { name: 'Gone', settings: {} }, 'c', at);
  const elsewhere = rec('x', 'settings_preset', 'other', { name: 'Other', settings: {} });
  const all = records(project, night, scout, gone, elsewhere);

  it('lists this project’s, not in the Trash, in the order made', () => {
    expect(presetsOf(all, 'p').map((p) => p.name)).toEqual(['Scout', 'Night']);
    expect(presetNamed(all, 'p', ' night ')?.id).toBe('n');
    expect(presetNamed(all, 'p', 'Gone')).toBeNull();
  });

  it('saves a new one last, or replaces the one of that name, in one op', () => {
    const made = savePresetChanges(all, 'p', '  Day‮  ', full);
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ kind: 'create', record: { type: 'settings_preset', parentId: 'p', props: { name: 'Day' } } });
    const key = made[0]?.kind === 'create' ? made[0].record.sortKey : '';
    expect(key > 'c').toBe(true);
    expect(savePresetChanges(all, 'p', 'NIGHT', full)).toEqual([{ kind: 'update', id: 'n', set: { name: 'NIGHT', settings: presetSettingsProp(full) } }]);
    expect(savePresetChanges(all, 'p', '   ', full)).toEqual([]);
  });

  it('renames only to a free name, and deletes as a trash op', () => {
    expect(renamePresetChanges(all, 'p', 'n', 'Night shoot')).toEqual([{ kind: 'update', id: 'n', set: { name: 'Night shoot' } }]);
    expect(renamePresetChanges(all, 'p', 'n', 'scout')).toEqual([]);
    expect(renamePresetChanges(all, 'p', 'n', '')).toEqual([]);
    expect(deletePresetChanges(all, 'p', 'n')).toEqual([{ kind: 'trash', id: 'n' }]);
    expect(deletePresetChanges(all, 'p', 'x')).toEqual([]);
  });

  it('names a "Before" to fit 60 characters, never the preset applied nor another preset’s Before (round 3)', () => {
    const words = (name: string) => `Before ${name}`;
    const before = (list: SbdRecord[], id: string) => beforePresetName(records(project, ...list), 'p', id, words);
    const preset = (id: string, name: string, key: string) => rec(id, 'settings_preset', 'p', { name, settings: {} }, key);
    expect(before([night], 'n')).toBe('Before Night');
    // A 60-character name: the Before words and its first 53 characters, 60 in all.
    const long = 'L'.repeat(53) + 'abcdefg';
    const a = preset('a', long, 'a');
    expect(before([a], 'a')).toBe(`Before ${'L'.repeat(53)}`);
    expect(Array.from(before([a], 'a'))).toHaveLength(60);
    // Two names alike in their first 53: the second made gets " 2", still 60, and the first keeps its own.
    const b = preset('b', `${'L'.repeat(53)}hijklmn`, 'b');
    expect(before([a, b], 'a')).toBe(`Before ${'L'.repeat(53)}`);
    expect(before([a, b], 'b')).toBe(`Before ${'L'.repeat(51)} 2`);
    expect(Array.from(before([a, b], 'b'))).toHaveLength(60);
    // A name its own Before would equal: numbered, so applying never overwrites the preset applied.
    const self = 'Before '.repeat(9).slice(0, 60);
    const c = preset('c', self, 'a');
    expect(words(self.slice(0, 53))).toBe(self);
    expect(before([c], 'c')).not.toBe(self);
    expect(before([c], 'c').endsWith(' 2')).toBe(true);
    // A Before preset applied keeps its own Before, never its source's.
    const kept = preset('k', 'Before Night', 'c');
    expect(before([night, kept], 'k')).toBe('Before Before Night');
    expect(before([night, kept], 'n')).toBe('Before Night');
  });

  it('names a new one with the first free number, and cuts a long name at 60 characters', () => {
    const numbered = records(project, rec('1', 'settings_preset', 'p', { name: 'Preset 1', settings: {} }));
    expect(nextPresetName(numbered, 'p', (n) => `Preset ${String(n)}`)).toBe('Preset 2');
    expect(Array.from(cleanPresetName('x'.repeat(90)))).toHaveLength(60);
  });
});
