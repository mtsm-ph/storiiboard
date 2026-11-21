import type { StoreApi } from 'zustand/vanilla';
import { t } from '../../core/i18n';
import { keepUnknownRows } from '../../core/model/planLayers';
import type { SbdRecord } from '../../core/model/record';
import {
  beforePresetName,
  cleanPresetName,
  deletePresetChanges,
  presetsOf,
  renamePresetChanges,
  savePresetChanges,
  type PresetSettings,
} from '../../core/model/settingsPreset';
import { loadSettings, saveSettings, type ThemePreference } from '../../core/storage/settings';
import { setPlanLayerStates } from '../../features/birdseye/plan/layersStore';
import { boardGridNow, setBoardGrid } from '../boardGrid';
import { canvasViewsNow, setCanvasView } from '../canvasView';
import { projectStore, type ProjectState } from '../projectStore';
import { arrangedCustomWorkspaces, replaceCustomWorkspaces, replaceDepartmentWorkspaces, usableCustomWorkspaces } from '../shell/workspaceStore';
import { discardDrafts } from '../settings/drafts';
import { readPreset } from './presetDiff';

// Settings presets (6.5.8): saving, renaming, replacing and deleting one is an edit of the project, through ops, so it's
// in History and ⌘Z takes it back. Applying one changes this computer's settings, never an op, through the same setters
// the Settings window and the canvases use, so the theme repaints, the sidebar's workspaces change and open canvases
// switch view at once; it first keeps the settings as they were as a preset "Before [name]", which is an op group.

type Store = StoreApi<ProjectState>;

/** This computer's settings a preset holds, as they are now. */
export function presetSettingsNow(): PresetSettings {
  const settings = loadSettings();
  return {
    theme: settings.theme,
    themeChosen: settings.themeChosen,
    canvasViews: canvasViewsNow(),
    boardGrid: boardGridNow(),
    // As arranged (round 3): each one's layout from the layout store, so a preset and its "Before" carry it whole.
    customWorkspaces: arrangedCustomWorkspaces(),
    departmentWorkspaces: settings.departmentWorkspaces,
    // Only the rows this version knows: a newer version's rows stay on this computer, never in a preset.
    planLayers: settings.planLayers === null ? null : keepUnknownRows({}, settings.planLayers),
    pdfScenePalettes: settings.pdfScenePalettes,
  };
}

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * A preset's settings written to this computer: only the fields it holds, each through its own setter, and only where it
 * differs. Applying replaces each field whole, the lists of workspaces included. `setTheme` is the theme's own setter
 * (the ThemeProvider's), so the app repaints.
 */
export function applyToComputer(settings: Partial<PresetSettings>, setTheme: (theme: ThemePreference) => void): void {
  const now = presetSettingsNow();
  if (settings.theme !== undefined && settings.theme !== now.theme) setTheme(settings.theme);
  if (settings.canvasViews) {
    setCanvasView('plan', settings.canvasViews.plan);
    setCanvasView('board', settings.canvasViews.board);
  }
  if (settings.boardGrid) setBoardGrid(settings.boardGrid);
  if (settings.customWorkspaces && !sameJson(usableCustomWorkspaces(settings.customWorkspaces), usableCustomWorkspaces(now.customWorkspaces))) {
    replaceCustomWorkspaces(settings.customWorkspaces);
  }
  if (settings.departmentWorkspaces && !sameJson(settings.departmentWorkspaces, now.departmentWorkspaces)) replaceDepartmentWorkspaces(settings.departmentWorkspaces);
  if (settings.planLayers !== undefined && !sameJson(settings.planLayers, now.planLayers)) setPlanLayerStates(settings.planLayers);
  if (settings.pdfScenePalettes !== undefined && settings.pdfScenePalettes !== now.pdfScenePalettes) saveSettings({ pdfScenePalettes: settings.pdfScenePalettes });
}

/**
 * "Before Night": the name the settings from before applying a preset are kept under. Fixed when it's made, in the
 * language in use then ("Antes de Night" in Spanish), as any name a person types is: a stored value never changes with
 * the language, so a later apply in another language makes or replaces its own "Before" preset (Kevin, Nov 16: fine).
 */
export const beforeWords = (name: string): string => t('presets.beforeName', { name });

/** The name applying this preset of the open project keeps the settings from before under (beforePresetName). */
export const beforeName = (records: Readonly<Record<string, SbdRecord>>, projectId: string, presetId: string): string =>
  beforePresetName(records, projectId, presetId, beforeWords);

/** Saves this computer's settings now as a preset of the open project, or replaces the one of that name. Resolves to whether it was written. */
export async function savePreset(name: string, store: Store = projectStore): Promise<boolean> {
  const projectId = store.getState().project?.projectId;
  if (!projectId || cleanPresetName(name) === '') return false;
  const settings = presetSettingsNow();
  return store.getState().applyWith((records) => ({ changes: savePresetChanges(records, projectId, name, settings) }));
}

export async function renamePreset(id: string, name: string, store: Store = projectStore): Promise<boolean> {
  const projectId = store.getState().project?.projectId;
  if (!projectId) return false;
  return store.getState().applyWith((records) => ({ changes: renamePresetChanges(records, projectId, id, name) }));
}

export async function deletePreset(id: string, store: Store = projectStore): Promise<boolean> {
  const projectId = store.getState().project?.projectId;
  if (!projectId) return false;
  return store.getState().applyWith((records) => ({ changes: deletePresetChanges(records, projectId, id) }));
}

/**
 * Applies a preset of the open project: the settings now are kept first as "Before [name]" (replacing an earlier one of
 * that name), in one op group; once that is written, the preset's settings are written to this computer. Nothing is
 * applied when the Before preset couldn't be written, so there's always a way back. Resolves to the Before preset's
 * name, or null when nothing was applied.
 */
export async function applyPreset(id: string, setTheme: (theme: ThemePreference) => void, store: Store = projectStore): Promise<string | null> {
  const { project, records } = store.getState();
  if (!project) return null;
  const preset = presetsOf(records, project.projectId).find((p) => p.id === id);
  if (!preset) return null;
  const read = readPreset(preset.record);
  // Unreadable whole (too large, not JSON): nothing applies, so nothing needs keeping.
  if (read.tooLarge) return null;
  const settings = presetSettingsNow();
  const kept = { made: false, name: '' };
  const written = await store.getState().applyWith((now) => {
    // Gone meanwhile (deleted, undone): nothing is kept and nothing applied.
    if (!presetsOf(now, project.projectId).some((p) => p.id === id)) return { changes: [] };
    kept.name = beforeName(now, project.projectId, id);
    const changes = savePresetChanges(now, project.projectId, kept.name, settings);
    kept.made = changes.length > 0;
    return { changes };
  });
  if (!written || !kept.made) return null;
  applyToComputer(read.settings, setTheme);
  // Still one action (Kevin, Nov 17): the preset replaces whatever waited for Apply in Settings, so that is discarded,
  // never applied later over it. The Apply window says so first while anything waits. Nothing applied, nothing goes.
  discardDrafts();
  return kept.name;
}
