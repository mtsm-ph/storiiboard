import { backupFileName } from './backups';
import type { ProjectFile } from './driver';
import { fileStem } from './paths';

// Compact project (1.27, Kevin Nov 4: Settings → Storage, no automatic compaction). Space a deletion frees inside the
// file is reused for new work, but the file doesn't shrink, and space freed by builds before 1.21 can still hold old
// text. Compacting rewrites the file without it (the driver's compact: SQLite's VACUUM, in place, all or nothing).
// A backup of the file as it is comes first, every time, as one of the project's scheduled backups.

/** The file's size and how much of it is free space, from SQLite's own page counts. */
export async function fileSpace(file: ProjectFile): Promise<{ bytes: number; free: number }> {
  const [row] = await file.query(
    `SELECT p.page_count * s.page_size AS bytes, f.freelist_count * s.page_size AS free
      FROM pragma_page_count() p, pragma_page_size() s, pragma_freelist_count() f`,
  );
  return { bytes: Number(row?.bytes ?? 0), free: Number(row?.free ?? 0) };
}

/**
 * A scheduled backup's name for the file as it is now: this minute's, or the next free minute's when a backup made
 * earlier this minute already has it (that one holds an older state, and backups are never overwritten).
 */
async function freshBackupName(file: ProjectFile, at: Date): Promise<string> {
  const stem = fileStem(file.path);
  const taken = new Set((await file.listBackups()).map((backup) => backup.name));
  for (let minutes = 0; ; minutes += 1) {
    const name = backupFileName(stem, new Date(at.getTime() + minutes * 60_000));
    if (!taken.has(name)) return name;
  }
}

export interface Compacted {
  /** The backup made first. */
  backup: string;
  before: number;
  after: number;
}

/** Backs the project up, then compacts it. A failed backup compacts nothing. */
export async function compactProject(file: ProjectFile, now = new Date()): Promise<Compacted> {
  const before = (await fileSpace(file)).bytes;
  const backup = await freshBackupName(file, now);
  await file.backup('scheduled', backup);
  await file.compact();
  return { backup, before, after: (await fileSpace(file)).bytes };
}
