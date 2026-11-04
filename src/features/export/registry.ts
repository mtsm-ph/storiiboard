import type { SbdRecord } from '../../core/model/record';
import type { ExportTarget } from '../../core/storage/exportFiles';
import type { ProjectFile } from '../../core/storage/driver';
import { pdfStoryboard } from './pdfStoryboardFormat';
import { pngFrames } from './pngFrames';
import type { ExportScope } from './scope';
import type { WatermarkUse } from './watermark';
import { shotListCsvFormat } from './shotListCsv';

// The export registry (1.24, docs/PLAN.md D): a format is one file plus one line below. Each says what it makes, for
// which scopes, and whether it writes one file or a folder of them; its `run` reads the records in scope (never the
// Trash) and writes through the target src/core/storage gives it.

export interface ExportContext {
  records: Readonly<Record<string, SbdRecord>>;
  projectId: string;
  /** The project's title, for names. */
  title: string;
  scope: ExportScope;
  file: ProjectFile;
  target: ExportTarget;
  /** Called as work goes, for a progress line: done so far, of all. */
  progress: (done: number, total: number) => void;
}

export interface ExportFormat {
  id: string;
  label: string;
  /** What it writes, in a sentence. */
  description: string;
  output: 'file' | 'folder';
  /** The watermark it carries, when Watermark Settings say so; none for a report. */
  watermark?: WatermarkUse;
  /** The file's name, or the new folder's, for this scope. */
  name: (title: string, sceneNumber: string | null) => string;
  /** Resolves to what it wrote, in words: "12 frames". */
  run: (context: ExportContext) => Promise<string>;
}

export const FORMATS: readonly ExportFormat[] = [pdfStoryboard, shotListCsvFormat, pngFrames];
