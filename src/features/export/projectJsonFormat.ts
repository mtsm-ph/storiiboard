import { t, type MessageKey } from '../../core/i18n';
import { MAX_IMPORT_CHARS, ProjectJsonChangedError, projectJsonBytes, projectJsonSize, type ProjectJsonContents } from '../../core/storage/projectJson';
import { exportName } from './names';
import type { ExportFormat } from './registry';

// The project as one JSON file that imports back as a new project (2.9, src/core/storage/projectJson.ts), in two
// choices (3.14, Kevin Nov 9): Project data, the default, leaves out the Trash and History, since they can hold
// deleted material and everyone's names; Full archive carries both. Each is the project, not a view of it, so the
// scene picked doesn't narrow it.

type Words = 'label' | 'description' | 'whole' | 'fileWord' | 'what' | 'tooLarge';

const WORDS: Readonly<Record<ProjectJsonContents, Readonly<Record<Words, MessageKey>>>> = {
  project_data: {
    label: 'export.json.label',
    description: 'export.json.description',
    whole: 'export.json.whole',
    fileWord: 'export.json.fileWord',
    what: 'export.json.what',
    tooLarge: 'export.json.tooLarge',
  },
  full_archive: {
    label: 'export.archive.label',
    description: 'export.archive.description',
    whole: 'export.wholeProject',
    fileWord: 'export.archive.fileWord',
    what: 'export.archive.what',
    tooLarge: 'export.archive.tooLarge',
  },
};

function jsonFormat(id: string, contents: ProjectJsonContents): ExportFormat {
  const words = WORDS[contents];
  return {
    id,
    get label() {
      return t(words.label);
    },
    get description() {
      return t(words.description);
    },
    get wholeNote() {
      return t(words.whole);
    },
    output: 'file',
    wholeProject: true,
    name: (title) => exportName(title, null, t(words.fileWord), 'json'),
    run: async ({ file, target, title, signal, progress }) => {
      signal.throwIfAborted();
      progress(0, 1, t('export.json.reading'));
      // Never a file that couldn't be imported back: said before anything is written.
      if ((await projectJsonSize(file, contents)) > MAX_IMPORT_CHARS) throw new Error(t(words.tooLarge));
      let bytes: Uint8Array;
      try {
        bytes = await projectJsonBytes(file, new Date(), undefined, signal, contents);
      } catch (error) {
        if (error instanceof ProjectJsonChangedError) throw new Error(t('export.json.changing'));
        throw error;
      }
      signal.throwIfAborted();
      // The estimate counts characters; the file is bytes (accents, escaped quotes), so the bytes themselves decide.
      if (bytes.length > MAX_IMPORT_CHARS) throw new Error(t(words.tooLarge));
      await target.write(exportName(title, null, t(words.fileWord), 'json'), bytes);
      return { what: t(words.what) };
    },
  };
}

/** Project data (JSON): the default, without the Trash and History. Its id is the one 2.9 gave the whole-project file. */
export const projectJsonFormat = jsonFormat('project-json', 'project_data');

/** Full archive (JSON): everything, the Trash and History included. */
export const fullArchiveFormat = jsonFormat('full-archive-json', 'full_archive');
