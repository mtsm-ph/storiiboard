import { customFieldsOf, customValue, fieldNamesOf } from '../../core/model/customFields';
import { departmentName, departmentStates, departmentStatesText } from '../../core/model/departmentStatus';
import { loadSeen, NO_SEEN, type Seen } from '../../core/storage/seen';
import type { SbdRecord } from '../../core/model/record';
import { SHOT_STATUS_LABELS } from '../../core/model/shotStatus';
import { choiceLabel, HEIGHT_LABEL, MOVE_LABEL, pageLabel, SHOT_SIZE_LABEL, SUPPORT_LABEL, tStopLabel } from '../../core/model/storyboard';
import { headingOf } from '../storyboard/ScenesView';
import { exportName } from './names';
import type { ExportFormat } from './registry';
import { scenesIn, type ExportScope } from './scope';
import { t, tn } from '../../core/i18n';

// The shot list as CSV (1.24): one row per frame, the way a 1st AD prints it, in board order, with the project's custom
// fields as columns after the built-in ones. A report, not the lossless project export (that's Phase 2's JSON and
// CSV): RFC 4180 quoting, CRLF line ends and a byte-order mark, so Excel and Numbers read the accents right.

type Records = Readonly<Record<string, SbdRecord>>;

// The built-in columns, headed in the app's language with the same words the inspector uses.
const COLUMNS = [
  'field.scene',
  'field.heading',
  'field.length',
  'field.location',
  'field.shot',
  'field.size',
  'field.lensMm',
  'field.tStop',
  'field.support',
  'field.height',
  'field.move',
  'field.status',
  'field.action',
  'field.dialogue',
  'field.departments',
] as const;

/**
 * One cell: quoted when it holds a comma, a quote, a line end or edge spaces. A cell that starts like a formula
 * (`=`, `+`, `-`, `@`) gets a leading apostrophe, so a spreadsheet shows it rather than running it.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]|^\s|\s$/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function shotListCsv(records: Records, projectId: string, scope: ExportScope, seen: Seen = NO_SEEN): string {
  const scenes = scenesIn(records, projectId, scope);
  // Columns from the frames that go out: trashing a scene leaves its frames live, and a field only they use (or only
  // another scene's frames use) would be a column of blanks, or the Trash going out by its name.
  const custom = fieldNamesOf(scenes.flatMap((scene) => scene.shots.map((shot) => shot.record)));
  const rows: string[][] = [[...COLUMNS.map((key) => t(key)), ...custom]];
  for (const scene of scenes) {
    const location = scene.fields.locationId ? records[scene.fields.locationId] : undefined;
    const place = location && location.trashedAt === null && typeof location.props.name === 'string' ? location.props.name : '';
    for (const shot of scene.shots) {
      const f = shot.fields;
      const own = customFieldsOf(shot.record.props);
      rows.push([
        scene.fields.number,
        headingOf(scene.fields),
        scene.fields.pageEighths === null ? '' : pageLabel(scene.fields.pageEighths),
        place,
        f.number,
        f.size ? SHOT_SIZE_LABEL[f.size] : '',
        f.lensMm === null ? '' : String(f.lensMm),
        f.tStop === null ? '' : tStopLabel(f.tStop),
        choiceLabel(SUPPORT_LABEL, f.support),
        choiceLabel(HEIGHT_LABEL, f.height),
        choiceLabel(MOVE_LABEL, f.move),
        SHOT_STATUS_LABELS[f.status],
        f.action,
        f.dialogue,
        // Each department with anything set or seen (polish 6b), Priority first: "Camera: Priority, Done; Art: Working on it".
        departmentStates(f.departmentStatus, seen[shot.record.id] ?? [])
          .map(({ department }) => t('export.csv.department', { department: departmentName(department), states: departmentStatesText(f.departmentStatus, seen[shot.record.id] ?? [], department) }))
          .join('; '),
        // The column has the spelling most frames use; a frame that spells it `drone` still fills `Drone`.
        ...custom.map((name) => customValue(own, name)),
      ]);
    }
  }
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export const shotListCsvFormat: ExportFormat = {
  id: 'shot-list-csv',
  get label() {
    return t('export.csv.label');
  },
  get description() {
    return t('export.csv.description');
  },
  output: 'file',
  name: (title, scene) => exportName(title, scene, t('export.csv.fileWord'), 'csv'),
  run: async ({ records, projectId, scope, target, title, signal, file }) => {
    const frames = scenesIn(records, projectId, scope).reduce((n, s) => n + s.shots.length, 0);
    const scene = scope.kind === 'scene' ? (scenesIn(records, projectId, scope)[0]?.fields.number ?? null) : null;
    signal.throwIfAborted();
    await target.write(exportName(title, scene, t('export.csv.fileWord'), 'csv'), new TextEncoder().encode(shotListCsv(records, projectId, scope, await loadSeen(file))));
    return { what: tn('count.frames', frames) };
  },
};
