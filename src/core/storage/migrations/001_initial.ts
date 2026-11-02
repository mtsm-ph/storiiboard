import type { Migration } from '../migrate';

// Schema v1, as documented in docs/SBD_FORMAT.md. STRICT tables make SQLite enforce the column types, and the
// json_valid checks keep a bad write from storing props that can't be read back. Kinds and states aren't CHECKed:
// SQLite can't change a CHECK without rebuilding the table, and later phases add op kinds.

export const initial: Migration = {
  version: 1,
  description: 'First schema: meta, records and ops',
  statements: [
    {
      sql: `CREATE TABLE meta (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`,
    },
    {
      // parent_id plus a fractional sort_key orders siblings, so a reorder rewrites one row instead of the parent.
      // The parent check waits for commit, so one op group can create a parent and its children in any order.
      sql: `CREATE TABLE records (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        parent_id TEXT REFERENCES records (id) DEFERRABLE INITIALLY DEFERRED,
        sort_key TEXT NOT NULL,
        props TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(props)),
        trashed_at TEXT,
        trashed_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`,
    },
    { sql: 'CREATE INDEX records_by_parent ON records (parent_id, sort_key)' },
    { sql: 'CREATE INDEX records_by_type ON records (type)' },
    {
      // seq gives the log its order, which UUIDs can't. before and after are null where there is no record on that
      // side (before a create), and once Empty Trash has removed a record's data.
      sql: `CREATE TABLE ops (
        id TEXT PRIMARY KEY,
        seq INTEGER NOT NULL UNIQUE,
        group_id TEXT NOT NULL,
        record_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        before TEXT CHECK (before IS NULL OR json_valid(before)),
        after TEXT CHECK (after IS NULL OR json_valid(after)),
        author TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`,
    },
    { sql: 'CREATE INDEX ops_by_group ON ops (group_id)' },
    { sql: 'CREATE INDEX ops_by_record ON ops (record_id, seq)' },
  ],
};
