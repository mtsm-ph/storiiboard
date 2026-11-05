import type { Migration } from '../migrate';

// Schema v7 (polish 6b, part of the department status Kevin approved Nov 5): Seen. When someone opens a frame, the
// departments their role on the project stands for are marked as having seen it (src/core/storage/seen.ts). Seen is
// automatic, like a notification read, so it isn't an op: undo, redo and Restore to here never take it back, and it
// isn't in History. One row per frame and department, the first time. Per person comes with the web (Phase 9).

export const shotSeen: Migration = {
  version: 7,
  description: 'Seen: shot_seen',
  statements: [
    {
      sql: `CREATE TABLE shot_seen (
        id TEXT PRIMARY KEY,
        shot_id TEXT NOT NULL,
        department TEXT NOT NULL,
        seen_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (shot_id, department)
      ) STRICT`,
    },
  ],
};
