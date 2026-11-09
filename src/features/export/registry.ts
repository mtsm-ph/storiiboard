import type { SbdRecord } from '../../core/model/record';
import type { ExportTarget } from '../../core/storage/exportFiles';
import type { ProjectFile } from '../../core/storage/driver';
import { pdfStoryboard } from './pdfStoryboardFormat';
import { pngFrames } from './pngFrames';
import type { ExportScope } from './scope';
import type { WatermarkUse } from './watermark';
import { fullArchiveFormat, projectJsonFormat } from './projectJsonFormat';
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
  /** Called as work goes, for a progress line: done so far, of all, or what it's doing instead when it says. */
  progress: (done: number, total: number, doing?: string) => void;
  /** Aborted when the person stops the export: a format checks it between files and stops there. */
  signal: AbortSignal;
  /** Print each scene's palette in its heading (polish PP); formats without headings ignore it. */
  scenePalettes?: boolean;
}

export interface ExportFormatOptions {
  /** The format can print scene palettes, so Export offers the choice. */
  scenePalettes?: boolean;
}

export interface ExportFormat {
  id: string;
  label: string;
  /** What it writes, in a sentence. */
  description: string;
  output: 'file' | 'folder';
  /** The watermark it carries, when Watermark Settings say so; none for a report. */
  watermark?: WatermarkUse;
  /** The choices Export offers for it. */
  options?: ExportFormatOptions;
  /**
   * It's the project itself, not a view of it (Project data as JSON, 2.9): always all of it, History and Trash
   * included, so Export offers no choice of scenes.
   */
  wholeProject?: true;
  /** What a whole-project file holds, said under the choice (3.14: Project data and Full archive hold different things). */
  readonly wholeNote?: string;
  /** The file's name, or the new folder's, for this scope. */
  name: (title: string, sceneNumber: string | null) => string;
  /** Resolves to what it wrote. */
  run: (context: ExportContext) => Promise<ExportResult>;
}

export interface ExportResult {
  /** In words: "12 frames". */
  what: string;
  /** What went out short, for the person to see: frames whose picture the file no longer holds. */
  warning?: string;
}

export const FORMATS: readonly ExportFormat[] = [pdfStoryboard, shotListCsvFormat, pngFrames, projectJsonFormat, fullArchiveFormat];
