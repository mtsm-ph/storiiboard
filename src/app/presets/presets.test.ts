import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../../core/i18n';
import { ALL_SHOWN } from '../../core/model/planLayers';
import type { JsonValue } from '../../core/model/record';
import { PRESET_FIELDS, presetsOf, presetSettingsProp, type PresetSettings } from '../../core/model/settingsPreset';
import { log, opsOfGroups, trashedRoots } from '../../core/ops/ops';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, openProject, type Project } from '../../core/storage/project';
import { importProjectJson, projectJsonBytes, readProjectJson } from '../../core/storage/projectJson';
import { loadSettings, saveSettings, SETTINGS_KEY, TRACKPAD_MODE_KEY, type Settings, type ThemePreference } from '../../core/storage/settings';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { layersStore, reloadLayersForTests, setPlanLayerStates } from '../../features/birdseye/plan/layersStore';
import { describeEdit, lineText } from '../../features/history/summary';
import { trashItems } from '../../features/trash/trash';
import { boardGridNow, setBoardGrid } from '../boardGrid';
import { canvasViewsNow, setCanvasView } from '../canvasView';
import { createProjectStore, type ProjectState } from '../projectStore';
import { createCustomWorkspace, deleteCustomWorkspace, replaceCustomWorkspaces, replaceDepartmentWorkspaces, workspaceStore } from '../shell/workspaceStore';
import { isCustomWorkspaceId, workspaceById } from '../shell/workspaces';
import { layoutStore } from '../shell/docking/layoutStore';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { ApplyView } from './PresetsTab';
import { presetDiff, presetLeftOut, readPreset } from './presetDiff';
import { applyPreset, applyToComputer, deletePreset, presetSettingsNow, renamePreset, savePreset } from './presets';
import type { StoreApi } from 'zustand/vanilla';
import { discardDrafts, hasDrafts, setDraft } from '../settings/drafts';

// Settings presets (6.5.8) in the app: saving one is an op in the open project holding only the listed fields and
// nothing personal; applying one writes this computer's settings through their setters, after keeping the settings
// from before as "Before [name]" in one op group, and never touches anything outside the list; renaming, replacing and
// deleting are ops undo takes back; History names each step; the project JSON carries presets out and back.

let kept: Map<string, string>;
let folder: TestFolder;
let project: Project;
let store: StoreApi<ProjectState>;

/** The theme's own setter, as the ThemeProvider's writes it. */
const setTheme = (theme: ThemePreference) => {
  saveSettings({ theme, themeChosen: true });
};

const records = () => store.getState().records;
const presets = () => presetsOf(records(), project.projectId);
const presetNamed = (name: string) => presets().find((p) => p.name === name);

beforeEach(async () => {
  setLocale('en');
  kept = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: (k: string, v: string) => void kept.set(k, v),
    removeItem: (k: string) => void kept.delete(k),
  });
  // Every store a preset reaches, back to a fresh computer's.
  setCanvasView('plan', 'paper');
  setCanvasView('board', 'paper');
  setBoardGrid({ boardGrid: false, boardGridSnap: false });
  replaceCustomWorkspaces([]);
  replaceDepartmentWorkspaces([]);
  setPlanLayerStates(null);
  kept.clear();
  reloadLayersForTests();
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  store = createProjectStore();
  await store.getState().open(project);
});

afterEach(async () => {
  await store.getState().close();
  folder.remove();
  vi.unstubAllGlobals();
  setLocale('en');
});

/** Everything a person's own that no preset may touch, as stored. */
function outsideTheList(): Record<string, string | undefined> {
  const settings = JSON.parse(kept.get(SETTINGS_KEY) ?? '{}') as Record<string, unknown>;
  const keys: (keyof Settings)[] = ['profile', 'projectSelves', 'projectRoles', 'language', 'weekStart', 'weatherUnits', 'planUnits', 'callSheetPaper', 'directionsApp', 'backups', 'backupsNextToProject', 'companies', 'syncNoted', 'sidebarHidden', 'tilesOffered'];
  // Every layout in the layout store that isn't a workspace of the person's own: built-in and department ones.
  const layouts = Object.entries(layoutStore.getState().layouts).filter(([id]) => !isCustomWorkspaceId(id));
  return { ...Object.fromEntries(keys.map((k) => [k, JSON.stringify(settings[k])])), trackpad: kept.get(TRACKPAD_MODE_KEY), layouts: JSON.stringify(layouts) };
}

/** A person with a name, a role, a self in this project, a company and a synced path: none of it may reach a preset. */
function personal(): void {
  saveSettings({
    profile: { name: 'Kevin Matos', initials: 'KM', role: 'dp', historyInitials: false },
    projectSelves: { [project.projectId]: 'person-7f3a9c' },
    projectRoles: { [project.projectId]: 'director-dp' },
    companies: [{ id: 'co-1', name: 'Bey County Pictures', address: '12 Main St', phone: '555-0100', email: 'kevin@example.com', website: '', logo: null, brandColors: [], brandFonts: [] }],
    syncNoted: ['C:/Users/robin/Dropbox/Bey County.sbd'],
    language: 'en',
    weekStart: 'monday',
    weatherUnits: 'us',
    planUnits: 'feet',
    callSheetPaper: 'a4',
    directionsApp: 'apple',
    backups: { recent: 20, days: 7 },
    backupsNextToProject: true,
  });
  kept.set(TRACKPAD_MODE_KEY, 'true');
}

/** Dark, Dark canvases, a grid, a workspace of one's own, Camera's workspace, Grip hidden and palettes on. */
function nightSettings(): void {
  setTheme('dark');
  setCanvasView('plan', 'dark');
  setCanvasView('board', 'dark');
  setBoardGrid({ boardGrid: true, boardGridSnap: true });
  createCustomWorkspace('Lighting day', workspaceById('production').defaultLayout());
  replaceDepartmentWorkspaces(['camera']);
  setPlanLayerStates({ ...ALL_SHOWN, grip: { show: 'hidden', locked: false } });
  saveSettings({ pdfScenePalettes: true });
}

describe('saving a preset', () => {
  it('writes one op holding only the listed fields, and nothing personal', async () => {
    personal();
    nightSettings();
    expect(await savePreset('Night', store)).toBe(true);
    const night = presetNamed('Night');
    expect(night?.record.parentId).toBe(project.projectId);
    const settings = night?.record.props.settings as Record<string, unknown>;
    expect(Object.keys(settings)).toEqual([...PRESET_FIELDS]);
    expect(settings).toMatchObject({ theme: 'dark', canvasViews: { plan: 'dark', board: 'dark' }, boardGrid: { boardGrid: true, boardGridSnap: true }, departmentWorkspaces: ['camera'], pdfScenePalettes: true });
    const json = JSON.stringify(night?.record.props);
    for (const word of ['Kevin', 'KM', '"dp"', 'director', 'person-7f3a9c', project.projectId, 'Bey County', 'Dropbox', 'C:/', '555-0100', 'example.com', 'co-1', '"feet"', '"monday"', '"apple"', '"a4"']) {
      // The regional choices as values, in quotes: a workspace's random id may hold "a4" as hex.
      expect(json.includes(word), word).toBe(false);
    }
    // One step, and the Saved sign moved.
    expect(store.getState().savedAt).not.toBeNull();
    const groups = await log(project.file);
    expect(groups.filter((g) => g.kind === 'edit').at(-1)?.opCount).toBe(1);
  });

  it('replaces one of the same name, case aside, and undo puts back what it held', async () => {
    await savePreset('Night', store);
    nightSettings();
    await savePreset('NIGHT', store);
    expect(presets()).toHaveLength(1);
    expect(presetNamed('NIGHT')?.record.props.settings).toMatchObject({ theme: 'dark' });
    await store.getState().undo();
    expect(presetNamed('Night')?.record.props.settings).toMatchObject({ theme: 'project' });
  });

  it('renames and deletes through ops, each undone', async () => {
    await savePreset('Night', store);
    const id = presetNamed('Night')?.id ?? '';
    await renamePreset(id, 'Night exteriors', store);
    expect(presets().map((p) => p.name)).toEqual(['Night exteriors']);
    await store.getState().undo();
    expect(presets().map((p) => p.name)).toEqual(['Night']);
    await deletePreset(id, store);
    expect(presets()).toEqual([]);
    expect(records()[id]?.trashedAt).not.toBeNull();
    // Never content: not in the Trash tile, not counted or deleted by Empty Trash.
    expect(trashItems(records(), project.projectId)).toEqual([]);
    expect(trashedRoots(Object.values(records()))).toEqual([]);
    await store.getState().undo();
    expect(presets().map((p) => p.name)).toEqual(['Night']);
  });
});

describe('applying a preset', () => {
  it('keeps the settings from before as "Before [name]", then writes the preset’s through the setters', async () => {
    personal();
    nightSettings();
    await savePreset('Night', store);
    // Back to a plain computer.
    setTheme('light');
    setCanvasView('plan', 'paper');
    setCanvasView('board', 'paper');
    setBoardGrid({ boardGrid: false, boardGridSnap: false });
    replaceCustomWorkspaces([]);
    replaceDepartmentWorkspaces([]);
    setPlanLayerStates(null);
    saveSettings({ pdfScenePalettes: false });
    const outside = outsideTheList();
    const plain = presetSettingsNow();
    const night = presetNamed('Night');
    if (!night) throw new Error('no preset');

    const groupsBefore = (await log(project.file)).length;
    expect(await applyPreset(night.id, setTheme, store)).toBe('Before Night');
    // One op group, for the Before preset; the settings change is no op.
    const groups = await log(project.file);
    expect(groups.length - groupsBefore).toBe(1);
    expect(groups.at(-1)?.opCount).toBe(1);
    expect(presetNamed('Before Night')?.record.props.settings).toEqual(presetSettingsProp(plain));

    expect(loadSettings().theme).toBe('dark');
    expect(canvasViewsNow()).toEqual({ plan: 'dark', board: 'dark' });
    expect(boardGridNow()).toEqual({ boardGrid: true, boardGridSnap: true });
    expect(workspaceStore.getState().customs.map((c) => c.name)).toEqual(['Lighting day']);
    expect(workspaceStore.getState().departments).toEqual(['camera']);
    expect(layersStore.getState().saved?.grip).toEqual({ show: 'hidden', locked: false });
    expect(loadSettings().pdfScenePalettes).toBe(true);
    // Nothing outside the list changed, byte for byte.
    expect(outsideTheList()).toEqual(outside);

    // Applying Before Night goes back; applying Night again replaces Before Night rather than adding one.
    const before = presetNamed('Before Night');
    expect(await applyPreset(before?.id ?? '', setTheme, store)).toBe('Before Before Night');
    expect(presetSettingsNow()).toEqual(plain);
    expect(outsideTheList()).toEqual(outside);
    await applyPreset(night.id, setTheme, store);
    expect(presets().map((p) => p.name)).toEqual(['Night', 'Before Night', 'Before Before Night']);
  });

  it('applies through the readers: a field any part of which it can’t read left exactly as it is, a newer field skipped and named', async () => {
    // This computer has a workspace of its own and a Dark board: an unreadable preset must take neither away.
    createCustomWorkspace('Lighting day', workspaceById('production').defaultLayout());
    setCanvasView('board', 'dark');
    await savePreset('Odd', store);
    const odd = presetNamed('Odd');
    if (!odd) throw new Error('no preset');
    await store.getState().apply([{ kind: 'update', id: odd.id, set: { settings: { theme: 'neon', canvasViews: { plan: 'dark', board: 7 }, pdfScenePalettes: 'yes', rulerUnits: 'picas', customWorkspaces: [{ id: 'custom-0000aaaa-1', name: 'Broken', layout: { root: 'x' } }] } } }]);
    const read = readPreset(presetNamed('Odd')?.record ?? odd.record);
    expect(read.settings).toEqual({});
    expect(presetLeftOut(read)).toEqual(['Left out, from a newer version: rulerUnits.', 'Left as they are, unreadable in the preset: Theme, Canvas view, Scene palettes in the storyboard PDF and Your workspaces.']);
    const theme = loadSettings().theme;
    await applyPreset(odd.id, setTheme, store);
    expect(loadSettings().theme).toBe(theme);
    // Never defaulted: the board stays Dark, the plan Paper, the workspace where it was.
    expect(canvasViewsNow()).toEqual({ plan: 'paper', board: 'dark' });
    expect(loadSettings().pdfScenePalettes).toBe(false);
    expect(workspaceStore.getState().customs.map((c) => c.name)).toEqual(['Lighting day']);
  });

  it('never deletes a workspace because one in the preset uses a tile this version lacks', async () => {
    createCustomWorkspace('Lighting day', workspaceById('production').defaultLayout());
    await savePreset('Newer', store);
    const newer = presetNamed('Newer');
    if (!newer) throw new Error('no preset');
    const layout = { root: { kind: 'stack', id: 's1', tiles: ['hologram'], active: 'hologram' }, maximized: null };
    await store.getState().apply([{ kind: 'update', id: newer.id, set: { settings: { customWorkspaces: [{ id: 'custom-0000aaaa-0001', name: 'From 7.0', layout }] } } }]);
    const read = readPreset(presetNamed('Newer')?.record ?? newer.record);
    expect(read.dropped).toEqual(['customWorkspaces']);
    await applyPreset(newer.id, setTheme, store);
    expect(workspaceStore.getState().customs.map((c) => c.name)).toEqual(['Lighting day']);
  });

  it('applies nothing and keeps nothing for a preset that is gone', async () => {
    expect(await applyPreset('nope', setTheme, store)).toBeNull();
    expect(presets()).toEqual([]);
  });

  it('writes only the fields a preset holds', () => {
    setCanvasView('board', 'dark');
    applyToComputer({ canvasViews: { plan: 'dark', board: 'paper' } }, setTheme);
    expect(canvasViewsNow()).toEqual({ plan: 'dark', board: 'paper' });
    expect(boardGridNow()).toEqual({ boardGrid: false, boardGridSnap: false });
  });
});

describe('what applying would change, in words', () => {
  const now = (): PresetSettings => presetSettingsNow();

  it('says each field that differs, and nothing for the rest', () => {
    const base = now();
    expect(presetDiff(base, base)).toEqual([]);
    expect(presetDiff({ ...base, theme: 'light' }, { theme: 'dark' })).toEqual(['Theme: Light → Dark']);
    expect(presetDiff(base, { canvasViews: { plan: 'dark', board: 'dark' } })).toEqual(['Canvas view, plans: Paper → Dark', 'Canvas view, boards: Paper → Dark']);
    expect(presetDiff(base, { boardGrid: { boardGrid: true, boardGridSnap: true } })).toEqual(['Dot grid on boards: Off → On', 'Snap to grid: Off → On']);
    expect(presetDiff(base, { departmentWorkspaces: ['camera', 'sound'] })).toEqual(['Department workspaces: none → Camera and Sound']);
    expect(presetDiff(base, { pdfScenePalettes: true })).toEqual(['Scene palettes in the storyboard PDF: Off → On']);
    // A field the preset doesn't hold is never a change.
    expect(presetDiff({ ...base, theme: 'dark' }, {})).toEqual([]);
  });

  it('counts the workspaces and names the preset’s', () => {
    const layout = workspaceById('storyboard').defaultLayout();
    const ws = (id: string, name: string) => ({ id: `custom-${id}-0000-4000-8000-000000000000`, name, layout, order: ['scenes'] });
    const mine = { ...now(), customWorkspaces: [ws('aaaaaaaa', 'Prep'), ws('bbbbbbbb', 'Wrap'), ws('cccccccc', 'Grade')] };
    expect(presetDiff(mine, { customWorkspaces: [ws('dddddddd', 'Lighting day'), ws('eeeeeeee', 'Scout')] })).toEqual(['Your workspaces: 3 now, 2 in the preset (Lighting day and Scout)']);
    expect(presetDiff(mine, { customWorkspaces: [] })).toEqual(['Your workspaces: 3 now, none in the preset']);
  });

  it('says each layer that differs, and when the layers follow the department', () => {
    const chosen = { ...ALL_SHOWN, grip: { show: 'hidden' as const, locked: false } };
    expect(presetDiff({ ...now(), planLayers: chosen }, { planLayers: ALL_SHOWN })).toEqual(['Plan layers: Grip hidden → shown']);
    expect(presetDiff({ ...now(), planLayers: ALL_SHOWN }, { planLayers: { ...ALL_SHOWN, camera: { show: 'dimmed', locked: true } } })).toEqual(['Plan layers: Camera shown → dimmed, locked']);
    expect(presetDiff({ ...now(), planLayers: null }, { planLayers: chosen })).toEqual(['Plan layers: following your department → as chosen']);
  });

  it('says it in Spanish too', () => {
    setLocale('es');
    expect(presetDiff({ ...now(), theme: 'light' }, { theme: 'dark', canvasViews: { plan: 'dark', board: 'paper' } })).toEqual(['Tema: Claro → Oscuro', 'Vista del lienzo, planos: Papel → Oscuro']);
  });
});

describe('presets in History and in the project JSON', () => {
  it('names saving, renaming, replacing, applying’s Before and deleting, in English and Spanish', async () => {
    await savePreset('Night', store);
    const id = presetNamed('Night')?.id ?? '';
    await renamePreset(id, 'Night exteriors', store);
    await savePreset('Night exteriors', store);
    await applyPreset(id, setTheme, store);
    await deletePreset(id, store);
    const edits = (await log(project.file)).filter((g) => g.kind === 'edit').slice(-5);
    const ops = await opsOfGroups(project.file, edits.map((g) => g.id));
    const lines = (locale: 'en' | 'es') => {
      setLocale(locale);
      return edits.map((g) => lineText(describeEdit(ops.filter((op) => op.groupId === g.id), new Set())));
    };
    expect(lines('en')).toEqual([
      'Saved settings preset Night',
      'Renamed settings preset Night to Night exteriors',
      'Replaced settings preset Night exteriors',
      'Saved settings preset Before Night exteriors',
      'Deleted settings preset Night exteriors',
    ]);
    expect(lines('es')).toEqual([
      'Se guardó el preajuste Night',
      'Se cambió el nombre del preajuste Night a Night exteriors',
      'Se reemplazó el preajuste Night exteriors',
      'Se guardó el preajuste Before Night exteriors',
      'Se eliminó el preajuste Night exteriors',
    ]);
  });

  it('go out and back through the project JSON with nothing lost, a deleted one included', async () => {
    nightSettings();
    await savePreset('Night', store);
    await savePreset('Scout', store);
    await deletePreset(presetNamed('Scout')?.id ?? '', store);
    const at = new Date('2026-11-16T12:00:00.000Z');
    const data = readProjectJson(new TextDecoder().decode(await projectJsonBytes(project.file, at)));
    const copy = folder.path('Bey County (presets).sbd');
    await importProjectJson(nodeDriver, copy, data, at);
    const imported = await openProject(copy, { driver: nodeDriver, backups: false });
    try {
      const query = 'SELECT id, type, parent_id, sort_key, props, trashed_at FROM records WHERE type = ? ORDER BY id';
      const rows = await imported.file.query(query, ['settings_preset']);
      expect(rows).toHaveLength(2);
      expect(rows).toEqual(await project.file.query(query, ['settings_preset']));
    } finally {
      await imported.close();
    }
  });
});

describe('your workspaces travel with their arrangement (round 3)', () => {
  /** A workspace of one's own made from the Storyboard's layout, then rearranged to Production's and saved. */
  function arranged(name: string): { id: string; layout: unknown } {
    const id = createCustomWorkspace(name, workspaceById('storyboard').defaultLayout());
    if (!id) throw new Error('no workspace');
    const layout = workspaceById('production').defaultLayout();
    layoutStore.getState().change(id, layout);
    layoutStore.getState().save(id);
    return { id, layout: structuredClone(layout) };
  }

  it('a preset with no workspaces, then its Before: the saved arrangement is back exactly', async () => {
    await savePreset('Empty', store);
    const { id, layout } = arranged('Lighting day');
    const outside = outsideTheList();
    await applyPreset(presetNamed('Empty')?.id ?? '', setTheme, store);
    expect(workspaceStore.getState().customs).toEqual([]);
    expect(layoutStore.getState().layouts[id as never]).toBeUndefined();
    // The Before holds it as arranged, not only the layout it was made from.
    const before = presetNamed('Before Empty');
    expect(before && readPreset(before.record).settings.customWorkspaces?.[0]?.layout).toEqual(layout);
    await applyPreset(before?.id ?? '', setTheme, store);
    expect(workspaceStore.getState().customs.map((c) => [c.id, c.name])).toEqual([[id, 'Lighting day']]);
    expect(layoutStore.getState().layouts[id as never]).toEqual({ current: layout, saved: layout });
    // Built-in and department layouts byte-identical throughout.
    expect(outsideTheList()).toEqual(outside);
  });

  it('saved on one computer and applied on a fresh one, gives the arranged layout', async () => {
    const { id, layout } = arranged('Lighting day');
    await savePreset('Night', store);
    // A fresh computer: none of the person's own workspaces, no layouts for them.
    replaceCustomWorkspaces([]);
    expect(layoutStore.getState().layouts[id as never]).toBeUndefined();
    await applyPreset(presetNamed('Night')?.id ?? '', setTheme, store);
    expect(workspaceStore.getState().customs.map((c) => c.name)).toEqual(['Lighting day']);
    expect(layoutStore.getState().layouts[id as never]).toEqual({ current: layout, saved: layout });
    expect(layoutStore.getState().past.filter((c) => c.workspace === id)).toEqual([]);
  });

  it('an arrangement never saved with Save layout: dragged only, it comes back through Before, still unsaved (round 4)', async () => {
    await savePreset('Empty', store);
    const made = workspaceById('storyboard').defaultLayout();
    const id = createCustomWorkspace('Lighting day', made);
    if (!id) throw new Error('no workspace');
    const dragged = workspaceById('production').defaultLayout();
    layoutStore.getState().change(id, dragged);
    await applyPreset(presetNamed('Empty')?.id ?? '', setTheme, store);
    expect(layoutStore.getState().layouts[id]).toBeUndefined();
    await applyPreset(presetNamed('Before Empty')?.id ?? '', setTheme, store);
    // What the person saw, and its saved layout behind it: Save layout's dot still shows.
    expect(layoutStore.getState().layouts[id]).toEqual({ current: dragged, saved: made });
    const entry = layoutStore.getState().layouts[id];
    expect(JSON.stringify(entry?.current)).not.toBe(JSON.stringify(entry?.saved));
  });

  it('a workspace whose saved layout differs from its current one round-trips both (round 4)', async () => {
    const id = createCustomWorkspace('Lighting day', workspaceById('storyboard').defaultLayout());
    if (!id) throw new Error('no workspace');
    const saved = workspaceById('production').defaultLayout();
    const current = workspaceById('assets').defaultLayout();
    layoutStore.getState().change(id, saved);
    layoutStore.getState().save(id);
    layoutStore.getState().change(id, current);
    await savePreset('Night', store);
    const night = presetNamed('Night');
    if (!night) throw new Error('no preset');
    const held = readPreset(night.record).settings.customWorkspaces?.[0];
    expect(held?.layout).toEqual(current);
    expect(held?.saved).toEqual(saved);
    // A fresh computer.
    replaceCustomWorkspaces([]);
    await applyPreset(presetNamed('Night')?.id ?? '', setTheme, store);
    expect(layoutStore.getState().layouts[id]).toEqual({ current, saved });
  });

  it('applying a preset that only adds another workspace leaves an existing one’s layout and layout undo untouched (round 4)', async () => {
    const first = createCustomWorkspace('Lighting day', workspaceById('storyboard').defaultLayout());
    if (!first) throw new Error('no workspace');
    layoutStore.getState().change(first, workspaceById('production').defaultLayout());
    const second = createCustomWorkspace('Scout', workspaceById('assets').defaultLayout());
    if (!second) throw new Error('no workspace');
    await savePreset('Both', store);
    deleteCustomWorkspace(second);
    const layoutsBefore = JSON.stringify(layoutStore.getState().layouts[first]);
    const undoBefore = JSON.stringify(layoutStore.getState().past.filter((c) => c.workspace === first));
    expect(JSON.parse(undoBefore)).toHaveLength(1);
    await applyPreset(presetNamed('Both')?.id ?? '', setTheme, store);
    expect(workspaceStore.getState().customs.map((c) => c.name)).toEqual(['Lighting day', 'Scout']);
    expect(JSON.stringify(layoutStore.getState().layouts[first])).toBe(layoutsBefore);
    expect(JSON.stringify(layoutStore.getState().past.filter((c) => c.workspace === first))).toBe(undoBefore);
  });

  it('never touches a department workspace’s layout: taken off by a preset and put back, it still has it', async () => {
    replaceDepartmentWorkspaces(['camera']);
    const camera = 'department-camera' as const;
    const layout = workspaceById('production').defaultLayout();
    layoutStore.getState().change(camera, layout);
    layoutStore.getState().save(camera);
    const builtIn = JSON.stringify(layoutStore.getState().layouts.storyboard);
    replaceDepartmentWorkspaces([]);
    await savePreset('No departments', store);
    replaceDepartmentWorkspaces(['camera']);
    await applyPreset(presetNamed('No departments')?.id ?? '', setTheme, store);
    expect(workspaceStore.getState().departments).toEqual([]);
    expect(layoutStore.getState().layouts[camera]).toEqual({ current: layout, saved: layout });
    replaceDepartmentWorkspaces(['camera']);
    expect(layoutStore.getState().layouts[camera]).toEqual({ current: layout, saved: layout });
    expect(JSON.stringify(layoutStore.getState().layouts.storyboard)).toBe(builtIn);
  });
});

describe('a preset from someone else, bounded before the preview (round 3)', () => {
  const deep = (levels: number): JsonValue => {
    let node: JsonValue = { kind: 'stack', id: 's', tiles: ['storyboard'], active: 'storyboard' };
    for (let i = 0; i < levels; i += 1) node = { kind: 'split', id: `p${String(i)}`, direction: 'row', children: [node, { kind: 'stack', id: `q${String(i)}`, tiles: ['inspector'], active: 'inspector' }], sizes: [0.5, 0.5] };
    return { root: node, maximized: null };
  };
  const junk: Record<string, JsonValue> = {
    'a 1 MB junk row': { theme: 'dark', planLayers: { grip: { show: 'hidden', locked: false }, junk: 'x'.repeat(1024 * 1024) } },
    'a 50,000-deep split': { customWorkspaces: [{ id: 'custom-0000aaaa-0002', name: 'Deep', layout: deep(50_000) }] },
    'a stack of 200,000 repeated tiles': { customWorkspaces: [{ id: 'custom-0000aaaa-0003', name: 'Wide', layout: { root: { kind: 'stack', id: 's', tiles: Array.from({ length: 200_000 }, () => 'storyboard'), active: 'storyboard' }, maximized: null } }] },
    'extra keys on nodes': { customWorkspaces: [{ id: 'custom-0000aaaa-0004', name: 'Extra', layout: { root: { kind: 'stack', id: 's', tiles: ['storyboard'], active: 'storyboard', html: '<img onerror>' }, maximized: null } }] },
  };

  for (const [what, settings] of Object.entries(junk)) {
    it(`${what}: nothing throws, nothing is written, and the Apply window renders`, async () => {
      createCustomWorkspace('Lighting day', workspaceById('production').defaultLayout());
      await savePreset('Junk', store);
      const preset = presetNamed('Junk');
      if (!preset) throw new Error('no preset');
      // Straight into the record, as a file from elsewhere would hold it.
      const record = { ...preset.record, props: { name: 'Junk', settings } };
      const before = presetSettingsNow();
      const outside = outsideTheList();
      const read = readPreset(record);
      expect(read.settings).toEqual({});
      applyToComputer(read.settings, setTheme);
      expect(presetSettingsNow()).toEqual(before);
      expect(outsideTheList()).toEqual(outside);
      const html = renderToString(createElement(ApplyView, { preset: { ...preset, record }, before: 'Before Junk', busy: false, onApply: () => undefined }));
      expect(html).toContain('Apply Junk');
      expect(html).toContain(read.tooLarge ? 'This preset is too large to read' : 'Left as they are, unreadable in the preset: Your workspaces.');
    });
  }
});

describe('a preset applied with changes waiting in Settings (Kevin, Nov 17)', () => {
  it('stays one action: the preset applies, its Before is kept, and what waited for Apply is discarded, never written', async () => {
    nightSettings();
    await savePreset('Night', store);
    setTheme('light');
    const night = presetNamed('Night');
    if (!night) throw new Error('no preset');
    // A change waiting in Settings → App: Weather units, not yet applied.
    const writes: string[] = [];
    setDraft('weatherUnits', 'us', 'region', (next: string) => {
      writes.push(next);
    });
    expect(hasDrafts()).toBe(true);
    // The Apply window says so before anything is applied.
    const html = renderToString(createElement(ApplyView, { preset: night, before: 'Before Night', busy: false, draftsWaiting: hasDrafts(), onApply: () => undefined }));
    expect(html).toContain('Changes waiting in Settings that you haven’t applied are discarded.');
    expect(await applyPreset(night.id, setTheme, store)).toBe('Before Night');
    expect(loadSettings().theme).toBe('dark');
    expect(presetNamed('Before Night')).toBeDefined();
    expect(hasDrafts()).toBe(false);
    expect(writes).toEqual([]);
    expect(loadSettings().weatherUnits).toBe('region');
  });

  it('keeps the draft when nothing was applied (a preset gone meanwhile)', async () => {
    setDraft('weatherUnits', 'us', 'region', () => undefined);
    expect(await applyPreset('nope', setTheme, store)).toBeNull();
    expect(hasDrafts()).toBe(true);
    discardDrafts();
  });

  it('says nothing of drafts in the Apply window while none waits', async () => {
    nightSettings();
    await savePreset('Night', store);
    setTheme('light');
    const night = presetNamed('Night');
    if (!night) throw new Error('no preset');
    const html = renderToString(createElement(ApplyView, { preset: night, before: 'Before Night', busy: false, draftsWaiting: hasDrafts(), onApply: () => undefined }));
    expect(html).not.toContain('Changes waiting in Settings');
  });
});
