import type { Migration } from '../migrate';

// Schema v10 (3.10, additive: approved Nov 7 and 9): notification read state, as docs/SBD_FORMAT.md planned it. The
// feed itself isn't stored: it's History's steps (later, suggestions and comments too). What's stored is each
// person's read state: everything up to a step (Mark all read), by its place in the log (`op_groups.seq`, which only
// grows: never a clock time, which another computer's clock could put anywhere), and items read one by one since. Not
// an op: reading can't be undone and isn't a step. migrate() backs the file up before this runs, as before every
// migration.

export const notifications: Migration = {
  version: 10,
  description: 'Notification read state: notification_cursors, notification_reads',
  statements: [
    {
      sql: `CREATE TABLE notification_cursors (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE,
        read_through_seq INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`,
    },
    {
      sql: `CREATE TABLE notification_reads (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        item_kind TEXT NOT NULL,
        item_id TEXT NOT NULL,
        read_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (user_id, item_kind, item_id)
      ) STRICT`,
    },
  ],
};
