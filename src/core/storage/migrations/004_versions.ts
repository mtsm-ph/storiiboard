import type { Migration } from '../migrate';

// Schema v4 (1.23, approved Nov 2): named versions. A version is a named point in History, not a copy: the last op
// group it includes, with a name and a note. Open version copies the project and restores the copy to that point.
// Kept until someone deletes one; Empty Trash leaves them, though a version opened later lacks what it deleted.

export const versions: Migration = {
  version: 4,
  description: 'Named versions: versions',
  statements: [
    {
      sql: `CREATE TABLE versions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        note TEXT,
        op_group_id TEXT NOT NULL REFERENCES op_groups (id),
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`,
    },
    { sql: 'CREATE INDEX versions_by_group ON versions (op_group_id)' },
  ],
};
