import { t } from '../../core/i18n';
import { projectJsonBytes } from '../../core/storage/projectJson';
import { exportName } from './names';
import type { ExportFormat } from './registry';

// Project data (JSON) (2.9): the whole project as one JSON file that imports back with nothing lost
// (src/core/storage/projectJson.ts). Unlike the other formats it's the project, not a view of it, so its History and
// Trash go too, whatever scene is picked.

export const projectJsonFormat: ExportFormat = {
  id: 'project-json',
  get label() {
    return t('export.json.label');
  },
  get description() {
    return t('export.json.description');
  },
  output: 'file',
  wholeProject: true,
  name: (title) => exportName(title, null, t('export.json.fileWord'), 'json'),
  run: async ({ file, target, title, signal, progress }) => {
    signal.throwIfAborted();
    progress(0, 1, t('export.json.reading'));
    const bytes = await projectJsonBytes(file);
    signal.throwIfAborted();
    await target.write(exportName(title, null, t('export.json.fileWord'), 'json'), bytes);
    return { what: t('export.json.what') };
  },
};
