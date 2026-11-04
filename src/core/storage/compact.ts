import { freshBackupName, type BackupSchedule } from './backups';
import type { ProjectFile } from './driver';

// Compact project (1.27, Kevin Nov 4: Settings → Storage, no automatic compaction). Space a deletion frees inside the
// file is reused for new work, but the file doesn't shrink, and space freed by builds before 1.21 can still hold old
// text. Compacting rewrites the file without it (the driver's compact: SQLite's VACUUM, in place, all or nothing).
// A backup of the file as it is comes first, as one of the project's scheduled backups, in turn with them.

/** The file's size and how much of it is free space, from SQLite's own page counts. */
export async function fileSpace(file: ProjectFile): Promise<{ bytes: number; free: number }> {
  const [row] = await file.query(
    `SELECT p.page_count * s.page_size AS bytes, f.freelist_count * s.page_size AS free
      FROM pragma_page_count() p, pragma_page_size() s, pragma_freelist_count() f`,
  );
  return { bytes: Number(row?.bytes ?? 0), free: Number(row?.free ?? 0) };
}

export interface Compacted {
  /** The backup made first. */
  backup: string;
  before: number;
  after: number;
}

/**
 * Backs the project up, then compacts it. A failed backup compacts nothing. With the project's backup schedule, the
 * two take their turn with its backups, so no copy of the file is being made while it's rewritten, and the schedule's
 * newest backup stands when nothing has changed since; without one (backups off), a new backup is made here.
 */
export async function compactProject(
  file: ProjectFile,
  { schedule = null, now = new Date() }: { schedule?: BackupSchedule | null; now?: Date } = {},
): Promise<Compacted> {
  const compact = async () => {
    const before = (await fileSpace(file)).bytes;
    await file.compact();
    return { before, after: (await fileSpace(file)).bytes };
  };
  if (schedule) {
    const { backup, result } = await schedule.backUpThen(compact);
    return { backup, ...result };
  }
  const backup = await freshBackupName(file, now);
  await file.backup('scheduled', backup);
  return { backup, ...(await compact()) };
}
