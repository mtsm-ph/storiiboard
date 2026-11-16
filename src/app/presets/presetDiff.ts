import { labels, list, t } from '../../core/i18n';
import { DEPARTMENT_LABELS, type Department } from '../../core/model/department';
import { ROW_ORDER, rowState, UNDERLAY_ROW, type LayerRow, type LayerState, type PlanLayerStates } from '../../core/model/planLayers';
import { presetSettingsOf, type PresetField, type PresetSettings, type ReadPreset } from '../../core/model/settingsPreset';
import type { SbdRecord } from '../../core/model/record';
import type { CanvasViewChoice, SavedCustomWorkspace, ThemePreference } from '../../core/storage/settings';
import { groupName } from '../../features/birdseye/plan/library';
import { usableCustomWorkspaces } from '../shell/workspaceStore';
import { TILES } from '../shell/workspaces';

// What applying a preset would change on this computer (6.5.8), in words, before anything changes: only what differs
// between the settings now and the preset's, field by field ("Theme: Light → Dark"). A field the preset doesn't hold, or
// one it holds unreadably, changes nothing and is never listed as a change.

/** Each preset field as a person names it, for the lines and for what was skipped. */
export const PRESET_FIELD_LABEL: Readonly<Record<PresetField, string>> = labels({
  theme: 'presets.field.theme',
  themeChosen: 'presets.field.theme',
  canvasViews: 'presets.field.canvasViews',
  boardGrid: 'presets.field.boardGrid',
  customWorkspaces: 'presets.field.customWorkspaces',
  departmentWorkspaces: 'presets.field.departmentWorkspaces',
  planLayers: 'presets.field.planLayers',
  pdfScenePalettes: 'presets.field.pdfScenePalettes',
});

const THEME_WORD: Readonly<Record<ThemePreference, string>> = labels({
  project: 'themeSwitch.project',
  system: 'themeSwitch.system',
  light: 'themeChooser.light',
  dark: 'themeChooser.dark',
});

const VIEW_WORD: Readonly<Record<CanvasViewChoice, string>> = labels({ paper: 'canvas.view.paper', dark: 'canvas.view.dark' });

const onOff = (on: boolean): string => t(on ? 'presets.diff.on' : 'presets.diff.off');
const change = (label: string, from: string, to: string): string => t('presets.diff.line', { label, from, to });

const rowName = (row: LayerRow): string => (row === UNDERLAY_ROW ? t('layers.underlay') : groupName(row));

const SHOW_WORD = labels({ shown: 'presets.diff.layerShown', dimmed: 'presets.diff.layerDimmed', hidden: 'presets.diff.layerHidden' });

/** A row's state in words: "hidden", "shown, locked". */
const stateWords = (state: LayerState): string => (state.locked ? t('presets.diff.layerLocked', { show: SHOW_WORD[state.show] }) : SHOW_WORD[state.show]);

/** The departments in the language's own list words ("Camera and Sound"), or none. */
const departmentsText = (departments: readonly Department[]): string => (departments.length === 0 ? t('presets.diff.none') : list(departments.map((d) => DEPARTMENT_LABELS[d])));

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function layerLines(now: PlanLayerStates | null, next: PlanLayerStates | null): string[] {
  const label = PRESET_FIELD_LABEL.planLayers;
  if (now === null && next === null) return [];
  if (now === null || next === null) {
    const follow = t('presets.diff.layersFollow');
    const chosen = t('presets.diff.layersChosen');
    return [change(label, now === null ? follow : chosen, next === null ? follow : chosen)];
  }
  return ROW_ORDER.flatMap((row) => {
    const a = rowState(now, row);
    const b = rowState(next, row);
    if (a.show === b.show && a.locked === b.locked) return [];
    return [t('presets.diff.layerLine', { label, layer: rowName(row), from: stateWords(a), to: stateWords(b) })];
  });
}

function workspaceLine(now: readonly SavedCustomWorkspace[], next: readonly SavedCustomWorkspace[]): string[] {
  const a = usableCustomWorkspaces(now);
  const b = usableCustomWorkspaces(next);
  if (sameJson(a, b)) return [];
  return [
    b.length === 0
      ? t('presets.diff.workspacesNone', { now: a.length })
      : t('presets.diff.workspaces', { now: a.length, preset: b.length, names: list(b.map((w) => w.name)) }),
  ];
}

/** Every difference between the settings now and a preset's, in words, in the list's order; empty when nothing would change. */
export function presetDiff(now: PresetSettings, preset: Partial<PresetSettings>): string[] {
  const lines: string[] = [];
  if (preset.theme !== undefined && preset.theme !== now.theme) lines.push(change(PRESET_FIELD_LABEL.theme, THEME_WORD[now.theme], THEME_WORD[preset.theme]));
  if (preset.canvasViews) {
    const { plan, board } = preset.canvasViews;
    if (plan !== now.canvasViews.plan) lines.push(change(t('presets.diff.canvasPlans'), VIEW_WORD[now.canvasViews.plan], VIEW_WORD[plan]));
    if (board !== now.canvasViews.board) lines.push(change(t('presets.diff.canvasBoards'), VIEW_WORD[now.canvasViews.board], VIEW_WORD[board]));
  }
  if (preset.boardGrid) {
    const { boardGrid, boardGridSnap } = preset.boardGrid;
    if (boardGrid !== now.boardGrid.boardGrid) lines.push(change(t('presets.diff.grid'), onOff(now.boardGrid.boardGrid), onOff(boardGrid)));
    if (boardGridSnap !== now.boardGrid.boardGridSnap) lines.push(change(t('presets.diff.snap'), onOff(now.boardGrid.boardGridSnap), onOff(boardGridSnap)));
  }
  if (preset.customWorkspaces) lines.push(...workspaceLine(now.customWorkspaces, preset.customWorkspaces));
  if (preset.departmentWorkspaces && !sameJson(preset.departmentWorkspaces, now.departmentWorkspaces)) {
    lines.push(change(PRESET_FIELD_LABEL.departmentWorkspaces, departmentsText(now.departmentWorkspaces), departmentsText(preset.departmentWorkspaces)));
  }
  if (preset.planLayers !== undefined) lines.push(...layerLines(now.planLayers, preset.planLayers));
  if (preset.pdfScenePalettes !== undefined && preset.pdfScenePalettes !== now.pdfScenePalettes) {
    lines.push(change(PRESET_FIELD_LABEL.pdfScenePalettes, onOff(now.pdfScenePalettes), onOff(preset.pdfScenePalettes)));
  }
  return lines;
}

/** A preset record read as this version applies it: through the readers, each workspace's layout through the shell's check. */
export function readPreset(record: SbdRecord): ReadPreset {
  const read = presetSettingsOf(record.props.settings, (id) => Object.hasOwn(TILES, id));
  const { customWorkspaces, ...rest } = read.settings;
  if (!customWorkspaces) return read;
  const usable = usableCustomWorkspaces(customWorkspaces);
  // One the shell can't lay out leaves the whole list as it is (round 3): applying never deletes a workspace for it.
  if (usable.length !== customWorkspaces.length) return { ...read, settings: rest, dropped: [...read.dropped, 'customWorkspaces'] };
  return { ...read, settings: { ...read.settings, customWorkspaces: usable } };
}

/** What a preset holds that wasn't applied, in words: a newer version's fields by name, unreadable ones by theirs. */
export function presetLeftOut(read: ReadPreset): string[] {
  if (read.tooLarge) return [t('presets.tooLarge')];
  const dropped = [...new Set(read.dropped.map((field) => PRESET_FIELD_LABEL[field]))];
  return [
    ...(read.skipped.length > 0 ? [t('presets.skipped', { fields: list(read.skipped) })] : []),
    ...(dropped.length > 0 ? [t('presets.dropped', { fields: list(dropped) })] : []),
  ];
}
