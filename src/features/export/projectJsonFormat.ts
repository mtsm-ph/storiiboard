import { t } from '../../core/i18n';
import { MAX_IMPORT_CHARS, ProjectJsonChangedError, projectJsonBytes, projectJsonSize } from '../../core/storage/projectJson';
import { exportName } from './names';
import type { ExportFormat } from './registry';

// Project data (JSON) (2.9): the whole project as one JSON file that imports back as a new project
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
    // Never a file that couldn't be imported back: said before anything is written.
    if ((await projectJsonSize(file)) > MAX_IMPORT_CHARS) throw new Error(t('export.json.tooLarge'));
    let bytes: Uint8Array;
    try {
      bytes = await projectJsonBytes(file, new Date(), undefined, signal);
    } catch (error) {
      if (error instanceof ProjectJsonChangedError) throw new Error(t('export.json.changing'));
      throw error;
    }
    signal.throwIfAborted();
    await target.write(exportName(title, null, t('export.json.fileWord'), 'json'), bytes);
    return { what: t('export.json.what') };
  },
};
