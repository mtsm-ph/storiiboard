import { customFieldNames, customFieldsOf, customValue } from '../../core/model/customFields';
import { DEPARTMENT_LABELS, type Department } from '../../core/model/department';
import type { SbdRecord } from '../../core/model/record';
import { SHOT_STATUS_LABELS } from '../../core/model/shotStatus';
import { pageLabel, SHOT_SIZE_LABEL, tStopLabel } from '../../core/model/storyboard';
import { headingOf } from '../storyboard/ScenesView';
import { exportName } from './names';
import type { ExportFormat } from './registry';
import { scenesIn, type ExportScope } from './scope';

// The shot list as CSV (1.24): one row per frame, the way a 1st AD prints it, in board order, with the project's custom
// fields as columns after the built-in ones. A report, not the lossless project export (that's Phase 2's JSON and
// CSV): RFC 4180 quoting, CRLF line ends and a byte-order mark, so Excel and Numbers read the accents right.

type Records = Readonly<Record<string, SbdRecord>>;

const COLUMNS = ['Scene', 'Heading', 'Length', 'Location', 'Shot', 'Size', 'Lens (mm)', 'T-stop', 'Support', 'Height', 'Move', 'Status', 'Action', 'Dialogue', 'Departments'];

/**
 * One cell: quoted when it holds a comma, a quote, a line end or edge spaces. A cell that starts like a formula
 * (`=`, `+`, `-`, `@`) gets a leading apostrophe, so a spreadsheet shows it rather than running it.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]|^\s|\s$/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function shotListCsv(records: Records, projectId: string, scope: ExportScope): string {
  const custom = customFieldNames(records);
  const rows: string[][] = [[...COLUMNS, ...custom]];
  for (const scene of scenesIn(records, projectId, scope)) {
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
        f.support,
        f.height,
        f.move,
        SHOT_STATUS_LABELS[f.status],
        f.action,
        f.dialogue,
        f.departments.map((d) => DEPARTMENT_LABELS[d as Department] as string | undefined ?? d).join(', '),
        // The column has the spelling most frames use; a frame that spells it `drone` still fills `Drone`.
        ...custom.map((name) => customValue(own, name)),
      ]);
    }
  }
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export const shotListCsvFormat: ExportFormat = {
  id: 'shot-list-csv',
  label: 'Shot list (CSV)',
  description: 'One row per frame, with its scene, specs, status and custom fields, for a spreadsheet.',
  output: 'file',
  name: (title, scene) => exportName(title, scene, 'shot list', 'csv'),
  run: async ({ records, projectId, scope, target, title, signal }) => {
    const frames = scenesIn(records, projectId, scope).reduce((n, s) => n + s.shots.length, 0);
    const scene = scope.kind === 'scene' ? (scenesIn(records, projectId, scope)[0]?.fields.number ?? null) : null;
    signal.throwIfAborted();
    await target.write(exportName(title, scene, 'shot list', 'csv'), new TextEncoder().encode(shotListCsv(records, projectId, scope)));
    return `${String(frames)} ${frames === 1 ? 'frame' : 'frames'}`;
  },
};
